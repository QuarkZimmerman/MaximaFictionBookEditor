// Settings store (T018). See mfbe/settings.hpp.
#include "util/sha256.hpp"

#include <mfbe/ai_address.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/settings.hpp>
#include <mfbe/unicode.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <functional>
#include <system_error>

namespace mfbe::settings {
namespace {

using json = nlohmann::json;

constexpr std::size_t kMaxHistory = 20;

// ---------------------------------------------------------------- schema -------------------

enum class Kind {
    boolean,
    integer,
    string,
    enumeration,
    color,
    string_array,
    nullable_object,
    window_geometry,  // {x, y, width, height: integers, maximized?: boolean} | null
    bool_map,
    string_list_map,     // object whose values are arrays of strings (toolbar layouts)
    optional_timestamp,  // "YYYY-MM-DDTHH:MM:SS[.sss]Z" or absent: no default, null removes it
    // Feature 005 (rpc-api §3.7, resource-formats §B):
    text,             // a string without control characters, min..max characters (max < 0: any)
    address,          // "" or a service address (mfbe/ai_address.hpp: absolute http(s) URL ...)
    verified_record,  // {fingerprint: "" | 64 lower-case hex, model <= 256 chars, at: "" | UTC}
    agreement_list    // [{service, host, at}] - replaced whole; malformed elements dropped on load
};

struct Field {
    std::string path;  // dotted
    Kind kind;
    int min;
    int max;
    std::vector<std::string> values;  // enumeration
};

Field field(const char* path, Kind kind) {
    return Field{path, kind, 0, -1, {}};
}
Field integer(const char* path, int min, int max) {
    return Field{path, Kind::integer, min, max, {}};
}
Field enumeration(const char* path, std::vector<std::string> values) {
    return Field{path, Kind::enumeration, 0, -1, std::move(values)};
}
// A string of min_chars..max_chars code points without control characters.
Field text(const char* path, int min_chars, int max_chars) {
    return Field{path, Kind::text, min_chars, max_chars, {}};
}

constexpr int kMaxKeyLength = 4096;
constexpr int kMaxModelLength = 256;
constexpr int kMaxAgreementServiceLength = 2100;  // "custom:" + an address of 2048 characters

const std::vector<Field>& schema() {
    static const std::vector<Field> fields = {
        integer("schemaVersion", 1, 1),
        enumeration("view.uiLanguage", {"system", "en", "ru", "uk"}),
        enumeration("view.theme", {"system", "light", "dark"}),
        field("view.bodyFont", Kind::string),
        integer("view.bodyFontSize", 6, 96),
        field("view.bodyTextColor", Kind::color),
        field("view.bodyBackground", Kind::color),
        field("view.sourceFont", Kind::string),
        field("view.sourceWrap", Kind::boolean),
        field("view.sourceSyntaxHighlight", Kind::boolean),
        field("view.sourceShowEol", Kind::boolean),
        field("view.sourceShowWhitespace", Kind::boolean),
        field("view.sourceLineNumbers", Kind::boolean),
        field("view.sourceMatchTags", Kind::boolean),
        field("view.sourceTagCompletion", Kind::boolean),
        field("view.spellEnabled", Kind::boolean),
        field("view.spellHighlight", Kind::boolean),
        field("view.customDictionaryPath", Kind::string),
        field("view.fastMode", Kind::boolean),
        enumeration("other.defaultEncoding", supported_encodings()),
        field("other.keepEncoding", Kind::boolean),
        field("other.restorePosition", Kind::boolean),
        field("other.scriptsFolder", Kind::string),
        field("other.genresFolder", Kind::string),
        field("other.dictionariesFolder", Kind::string),
        field("other.templateFolder", Kind::string),
        field("other.askOnNonClearImage", Kind::boolean),
        field("other.insertClearImages", Kind::boolean),
        enumeration("other.pasteImageFormat", {"jpeg", "png"}),
        integer("other.jpegQuality", 1, 100),
        // The original's choices: the plain non-breaking space (no marker), □, ▫ and ◦; any
        // other stored value (0.0.1's "°" default) reads as the default.
        enumeration("other.nbspDisplayChar", {"\u00A0", "\u25A1", "\u25AB", "\u25E6"}),
        // How often the editor checks for a new version at start-up (feature 003).
        enumeration("other.versionCheck", {"everyStart", "daily", "weekly", "monthly", "never"}),
        // Keyboard layout switched when a document is opened (feature 004, FR-090): the
        // shell's layout identifier (a platform string, not enumerated) and the name the system
        // gave it when it was picked, shown as "<name> (not installed)" when no longer listed.
        field("other.switchKeyboardLayout", Kind::boolean),
        field("other.keyboardLayoutId", Kind::string),
        field("other.keyboardLayoutName", Kind::string),
        field("words.showExclusionsInWordsDialog", Kind::boolean),
        // {x, y, width, height, maximized?: boolean} | null - the normal bounds plus the
        // maximised state, written by the shell at quit; replaced as a whole.
        field("session.windowGeometry", Kind::window_geometry),
        field("session.toolbars", Kind::bool_map),
        field("session.treeVisible", Kind::boolean),
        // Width of the Document Tree pane in CSS pixels (feature 004, FR-003); an out-of-range
        // or non-integer value is replaced by the default, never clamped - the UI clamps what it
        // applies to the window without rewriting the setting.
        integer("session.treeWidth", 100, 10000),
        field("session.findHistory", Kind::string_array),
        field("session.replaceHistory", Kind::string_array),
        // Toolbar layouts by toolbar ("commands", "scripts"): ordered button ids and "-"; ids
        // the UI does not know are kept as stored and dropped by the UI when it loads them.
        field("session.toolbarLayouts", Kind::string_list_map),
        field("session.lastFileDialogFolder", Kind::string),
        // When the last version check got an answer (feature 003); absent until one did.
        field("session.lastVersionCheck", Kind::optional_timestamp),
        // Width of the AI panel in CSS pixels (feature 005, FR-040): as session.treeWidth,
        // defaulted and never clamped.
        integer("session.aiPanelWidth", 100, 10000),
        // Whether the AI panel is shown (feature 005, FR-040 as amended 2026-10-23): written
        // by the UI like session.treeVisible; open at the first start.
        field("session.aiPanelVisible", Kind::boolean),
        // The AI assistant (feature 005, rpc-api §3.7 / resource-formats §B): the mode
        // ("disabled" by default - FR-001, requester 2026-10-23: the assistant works only after
        // the user has chosen a service), the chosen free entry, the custom triple, the
        // verification record the UI writes with the triple (kept only while its fingerprint
        // matches, see apply_fingerprint_invariant) and the first-use agreements.
        enumeration("ai.mode", {"free", "custom", "disabled"}),
        text("ai.freeServiceId", 1, -1),
        field("ai.custom.address", Kind::address),
        text("ai.custom.key", 0, kMaxKeyLength),
        text("ai.custom.model", 0, kMaxModelLength),
        field("ai.customVerified", Kind::verified_record),
        field("ai.agreements", Kind::agreement_list),
    };
    return fields;
}

std::vector<std::string> split_path(const std::string& dotted) {
    std::vector<std::string> parts;
    std::string current;
    for (char c : dotted) {
        if (c == '.') {
            parts.push_back(current);
            current.clear();
        } else {
            current.push_back(c);
        }
    }
    parts.push_back(current);
    return parts;
}

const json* find_path(const json& root, const std::string& dotted) {
    const json* node = &root;
    for (const auto& part : split_path(dotted)) {
        if (!node->is_object()) {
            return nullptr;
        }
        auto it = node->find(part);
        if (it == node->end()) {
            return nullptr;
        }
        node = &*it;
    }
    return node;
}

json* find_or_create_path(json& root, const std::string& dotted) {
    json* node = &root;
    for (const auto& part : split_path(dotted)) {
        if (!node->is_object()) {
            *node = json::object();
        }
        node = &(*node)[part];
    }
    return node;
}

void erase_path(json& root, const std::string& dotted) {
    const auto parts = split_path(dotted);
    json* node = &root;
    for (std::size_t i = 0; i + 1 < parts.size(); ++i) {
        if (!node->is_object()) {
            return;
        }
        auto it = node->find(parts[i]);
        if (it == node->end()) {
            return;
        }
        node = &*it;
    }
    if (node->is_object()) {
        node->erase(parts.back());
    }
}

bool is_color(const json& v) {
    if (!v.is_string()) {
        return false;
    }
    const std::string s = v.get<std::string>();
    if (s.size() != 7 || s[0] != '#') {
        return false;
    }
    return std::all_of(s.begin() + 1, s.end(),
                       [](unsigned char c) { return std::isxdigit(c) != 0; });
}

// "YYYY-MM-DDTHH:MM:SSZ", optionally with three fractional digits before the "Z" (the form
// JavaScript's Date.toISOString() writes).
bool is_utc_timestamp(const std::string& s) {
    if (s.size() != 20 && s.size() != 24) {
        return false;
    }
    const auto digits = [&s](std::size_t from, std::size_t count) {
        return std::all_of(s.begin() + static_cast<std::ptrdiff_t>(from),
                           s.begin() + static_cast<std::ptrdiff_t>(from + count),
                           [](unsigned char c) { return std::isdigit(c) != 0; });
    };
    const bool shape = digits(0, 4) && s[4] == '-' && digits(5, 2) && s[7] == '-' && digits(8, 2) &&
                       s[10] == 'T' && digits(11, 2) && s[13] == ':' && digits(14, 2) &&
                       s[16] == ':' && digits(17, 2) && s.back() == 'Z' &&
                       (s.size() == 20 || (s[19] == '.' && digits(20, 3)));
    if (!shape) {
        return false;
    }
    const auto number = [&s](std::size_t from, std::size_t count) {
        return std::stoi(s.substr(from, count));
    };
    const int year = number(0, 4);
    const int month = number(5, 2);
    const int day = number(8, 2);
    if (month < 1 || month > 12 || day < 1) {
        return false;
    }
    const bool leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    static constexpr int kDays[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    const int days = month == 2 && leap ? 29 : kDays[month - 1];
    return day <= days && number(11, 2) <= 23 && number(14, 2) <= 59 && number(17, 2) <= 60;
}

bool is_window_geometry(const json& v) {
    if (!v.is_object()) {
        return false;
    }
    for (const char* key : {"x", "y", "width", "height"}) {
        auto it = v.find(key);
        if (it == v.end() || !it->is_number_integer()) {
            return false;
        }
    }
    auto maximized = v.find("maximized");
    return maximized == v.end() || maximized->is_boolean();
}

// ---- feature 005 shapes (rpc-api §3.7) ----

// A string without control characters of min_chars..max_chars code points (max < 0: no cap).
std::string check_text(const json& value, int min_chars, int max_chars) {
    if (!value.is_string()) {
        return "expected a string";
    }
    const std::string s = value.get<std::string>();
    if (!unicode::is_valid_utf8(s)) {
        return "invalid UTF-8";
    }
    if (ai::has_control_characters(s)) {
        return "control characters are not allowed";
    }
    const std::size_t length = unicode::length(s);
    if (length < static_cast<std::size_t>(min_chars)) {
        return min_chars == 1 ? "expected a non-empty string"
                              : "expected at least " + std::to_string(min_chars) + " characters";
    }
    if (max_chars >= 0 && length > static_cast<std::size_t>(max_chars)) {
        return "expected at most " + std::to_string(max_chars) + " characters";
    }
    return "";
}

bool is_fingerprint(const std::string& s) {
    return s.empty() || (s.size() == 64 && std::all_of(s.begin(), s.end(), [](unsigned char c) {
                             return std::isdigit(c) != 0 || (c >= 'a' && c <= 'f');
                         }));
}

// The string member `key` of `object` (nullptr when absent or not a string).
const json* string_member(const json& object, const char* key) {
    auto it = object.find(key);
    return it != object.end() && it->is_string() ? &*it : nullptr;
}

// {fingerprint: "" | 64 lower-case hex, model: <= 256 chars without control characters,
// at: "" | ISO 8601 UTC} - exactly these three members.
bool is_verified_record(const json& v) {
    if (!v.is_object() || v.size() != 3) {
        return false;
    }
    const json* fingerprint = string_member(v, "fingerprint");
    const json* model = string_member(v, "model");
    const json* at = string_member(v, "at");
    return fingerprint != nullptr && is_fingerprint(fingerprint->get<std::string>()) &&
           model != nullptr && check_text(*model, 0, kMaxModelLength).empty() && at != nullptr &&
           (at->get<std::string>().empty() || is_utc_timestamp(at->get<std::string>()));
}

// {service: non-empty, <= 2100 chars, no control characters; host: <= 2048 chars, no
// whitespace or control characters; at: ISO 8601 UTC} - exactly these three members.
bool is_agreement(const json& v) {
    if (!v.is_object() || v.size() != 3) {
        return false;
    }
    const json* service = string_member(v, "service");
    const json* host = string_member(v, "host");
    const json* at = string_member(v, "at");
    if (service == nullptr || host == nullptr || at == nullptr) {
        return false;
    }
    const std::string host_text = host->get<std::string>();
    return check_text(*service, 1, kMaxAgreementServiceLength).empty() &&
           unicode::is_valid_utf8(host_text) && !ai::has_whitespace_or_control(host_text) &&
           unicode::length(host_text) <= ai::kMaxAddressLength &&
           is_utc_timestamp(at->get<std::string>());
}

// Returns an empty string when valid, otherwise the reason.
std::string check_value(const Field& field, const json& value) {
    switch (field.kind) {
        case Kind::boolean:
            return value.is_boolean() ? "" : "expected a boolean";
        case Kind::integer: {
            if (!value.is_number_integer()) {
                return "expected an integer";
            }
            const auto v = value.get<long long>();
            if (field.max >= field.min && (v < field.min || v > field.max)) {
                return "expected an integer between " + std::to_string(field.min) + " and " +
                       std::to_string(field.max);
            }
            return "";
        }
        case Kind::string:
            if (!value.is_string()) {
                return "expected a string";
            }
            return unicode::is_valid_utf8(value.get<std::string>()) ? "" : "invalid UTF-8";
        case Kind::enumeration: {
            if (!value.is_string()) {
                return "expected a string";
            }
            const std::string s = value.get<std::string>();
            if (std::find(field.values.begin(), field.values.end(), s) == field.values.end()) {
                return "unsupported value";
            }
            return "";
        }
        case Kind::color:
            return is_color(value) ? "" : "expected a colour like #rrggbb";
        case Kind::string_array: {
            if (!value.is_array()) {
                return "expected an array of strings";
            }
            for (const auto& item : value) {
                if (!item.is_string()) {
                    return "expected an array of strings";
                }
            }
            return "";
        }
        case Kind::nullable_object:
            return (value.is_null() || value.is_object()) ? "" : "expected an object or null";
        case Kind::window_geometry:
            return (value.is_null() || is_window_geometry(value))
                       ? ""
                       : "expected {x, y, width, height, maximized?} or null";
        case Kind::bool_map: {
            if (!value.is_object()) {
                return "expected an object";
            }
            for (auto it = value.begin(); it != value.end(); ++it) {
                if (!it->is_boolean()) {
                    return "expected boolean values";
                }
            }
            return "";
        }
        case Kind::string_list_map: {
            if (!value.is_object()) {
                return "expected an object";
            }
            for (auto it = value.begin(); it != value.end(); ++it) {
                if (it->is_null()) {
                    continue;  // a patch resetting one toolbar
                }
                if (!it->is_array()) {
                    return "expected arrays of strings";
                }
                for (const auto& item : *it) {
                    if (!item.is_string()) {
                        return "expected arrays of strings";
                    }
                }
            }
            return "";
        }
        case Kind::optional_timestamp:
            return (value.is_string() && is_utc_timestamp(value.get<std::string>()))
                       ? ""
                       : "expected an ISO 8601 UTC timestamp like 2026-10-17T12:34:56Z";
        case Kind::text:
            return check_text(value, field.min, field.max);
        case Kind::address: {
            if (!value.is_string()) {
                return "expected a string";
            }
            const std::string s = value.get<std::string>();
            return (s.empty() || ai::parse_address(s).has_value())
                       ? ""
                       : "expected an empty string or an absolute http(s) URL with a host and "
                         "without query, fragment or user information";
        }
        case Kind::verified_record:
            return is_verified_record(value) ? "" : "expected {fingerprint, model, at}";
        case Kind::agreement_list: {
            if (!value.is_array()) {
                return "expected an array of {service, host, at}";
            }
            for (const auto& item : value) {
                if (!is_agreement(item)) {
                    return "expected an array of {service, host, at}";
                }
            }
            return "";
        }
    }
    return "invalid";
}

void log_invalid(const Invalid& invalid) {
    log::warning("core", "settings.invalidValue", "invalid setting replaced by its default",
                 log::extras({{"field", invalid.field}, {"reason", invalid.reason}}));
}

std::string string_at(const json& settings, const char* dotted) {
    const json* v = find_path(settings, dotted);
    return (v != nullptr && v->is_string()) ? v->get<std::string>() : std::string();
}

// The invariant of rpc-api §3.7: `ai.customVerified.fingerprint` is "" or the SHA-256 of the
// current stored triple. A non-empty fingerprint that differs resets the record to its default
// - no error and no log line: this is the normal effect of an edit (FR-009 "red again the
// moment the user edits"), of a hand edit of settings.json, or of a client-written record that
// does not belong to the triple of its own patch (nobody can make the status green without the
// service having answered). Runs on a sanitized document (the record has its three strings).
void apply_fingerprint_invariant(json& settings) {
    json* record = find_or_create_path(settings, "ai.customVerified");
    const json* stored = string_member(*record, "fingerprint");
    if (stored == nullptr || stored->get<std::string>().empty()) {
        return;
    }
    const std::string expected = util::ai_fingerprint(string_at(settings, "ai.custom.address"),
                                                      string_at(settings, "ai.custom.key"),
                                                      string_at(settings, "ai.custom.model"));
    if (stored->get<std::string>() != expected) {
        *record = *find_path(defaults(), "ai.customVerified");
    }
}

// The exception class of a parse failure for the log - never the text that failed to parse
// (`e.what()` of nlohmann's parse_error quotes the last bytes read, which may be the key).
std::string exception_class(const std::exception& e) {
    if (dynamic_cast<const json::parse_error*>(&e) != nullptr) {
        return "parse_error";
    }
    if (dynamic_cast<const json::exception*>(&e) != nullptr) {
        return "json_exception";
    }
    if (dynamic_cast<const atomic_file::WriteError*>(&e) != nullptr) {
        return "read_error";
    }
    return "exception";
}

}  // namespace

// ---------------------------------------------------------------- defaults -----------------

const std::vector<std::string>& supported_encodings() {
    static const std::vector<std::string> encodings = {
        "utf-8",      "utf-16",     "windows-1251", "windows-1252", "iso-8859-1",
        "iso-8859-2", "iso-8859-5", "iso-8859-15",  "koi8-r"};
    return encodings;
}

json defaults() {
    return json{
        {"schemaVersion", kSchemaVersion},
        {"view",
         {{"uiLanguage", "system"},
          {"theme", "system"},
          {"bodyFont", ""},
          {"bodyFontSize", 14},
          {"bodyTextColor", "#000000"},
          {"bodyBackground", "#ffffff"},
          {"sourceFont", ""},
          {"sourceWrap", true},
          {"sourceSyntaxHighlight", true},
          {"sourceShowEol", false},
          {"sourceShowWhitespace", false},
          {"sourceLineNumbers", true},
          {"sourceMatchTags", true},
          {"sourceTagCompletion", true},
          {"spellEnabled", true},
          {"spellHighlight", true},
          {"customDictionaryPath", ""},
          {"fastMode", false}}},
        {"other",
         {{"defaultEncoding", "utf-8"},
          {"keepEncoding", false},
          {"restorePosition", true},
          {"scriptsFolder", ""},
          {"genresFolder", ""},
          {"dictionariesFolder", ""},
          {"templateFolder", ""},
          {"askOnNonClearImage", true},
          {"insertClearImages", false},
          {"pasteImageFormat", "jpeg"},
          {"jpegQuality", 90},
          {"nbspDisplayChar", "\u00A0"},
          {"versionCheck", "monthly"},
          {"switchKeyboardLayout", false},
          {"keyboardLayoutId", ""},
          {"keyboardLayoutName", ""}}},
        {"words", {{"showExclusionsInWordsDialog", false}}},
        {"session",
         {{"windowGeometry", nullptr},
          {"toolbars",
           {{"commands", true},
            {"scripts", true},
            {"links", true},
            {"table", true},
            {"status", true}}},
          {"treeVisible", true},
          {"treeWidth", 260},
          {"findHistory", json::array()},
          {"replaceHistory", json::array()},
          {"toolbarLayouts", json::object()},
          {"lastFileDialogFolder", ""},
          {"aiPanelWidth", 360},
          {"aiPanelVisible", true}}},
        {"ai",
         {{"mode", "disabled"},
          {"freeServiceId", "ovhcloud"},
          {"custom", {{"address", "https://api.openai.com/v1"}, {"key", ""}, {"model", ""}}},
          {"customVerified", {{"fingerprint", ""}, {"model", ""}, {"at", ""}}},
          {"agreements", json::array()}}},
    };
}

// ---------------------------------------------------------------- validation ---------------

std::vector<Invalid> sanitize(json& settings) {
    std::vector<Invalid> invalid;
    if (!settings.is_object()) {
        invalid.push_back({"", "settings root is not an object"});
        settings = defaults();
        return invalid;
    }
    const json def = defaults();
    for (const auto& field : schema()) {
        const json* default_value = find_path(def, field.path);
        json* value = find_or_create_path(settings, field.path);
        if (field.kind == Kind::optional_timestamp) {
            // No default: a missing or null value leaves the key out, an invalid one is removed.
            const std::string reason = value->is_null() ? "" : check_value(field, *value);
            if (!reason.empty()) {
                invalid.push_back({field.path, reason});
            }
            if (value->is_null() || !reason.empty()) {
                erase_path(settings, field.path);
            }
            continue;
        }
        const bool missing = value->is_null() && field.kind != Kind::nullable_object &&
                             field.kind != Kind::window_geometry;
        if (missing) {
            *value = *default_value;
            continue;
        }
        if (field.kind == Kind::agreement_list && value->is_array()) {
            // Malformed elements are dropped on load; the well-formed ones stay (reported once
            // by the field name).
            json kept = json::array();
            for (const auto& item : *value) {
                if (is_agreement(item)) {
                    kept.push_back(item);
                }
            }
            if (kept.size() != value->size()) {
                invalid.push_back({field.path, "malformed agreements dropped"});
                *value = std::move(kept);
            }
            continue;
        }
        const std::string reason = check_value(field, *value);
        if (!reason.empty()) {
            invalid.push_back({field.path, reason});
            *value = *default_value;
            continue;
        }
        if (field.kind == Kind::string_array && value->size() > kMaxHistory) {
            value->erase(value->begin() + static_cast<std::ptrdiff_t>(kMaxHistory), value->end());
        }
        if (field.kind == Kind::bool_map) {
            // Fill missing toolbar flags with defaults.
            for (auto it = default_value->begin(); it != default_value->end(); ++it) {
                if (!value->contains(it.key())) {
                    (*value)[it.key()] = it.value();
                }
            }
        }
    }
    (*find_or_create_path(settings, "schemaVersion")) = kSchemaVersion;
    apply_fingerprint_invariant(settings);
    return invalid;
}

void validate_patch(const json& patch) {
    if (!patch.is_object()) {
        throw SettingsError("", "patch must be an object");
    }
    for (const auto& field : schema()) {
        const json* value = find_path(patch, field.path);
        if (value == nullptr || value->is_null()) {
            continue;  // absent or reset-to-default
        }
        const std::string reason = check_value(field, *value);
        if (!reason.empty()) {
            throw SettingsError(field.path, reason);
        }
    }
    // Sections must stay objects.
    for (const char* section : {"view", "other", "words", "session", "ai"}) {
        auto it = patch.find(section);
        if (it != patch.end() && !it->is_null() && !it->is_object()) {
            throw SettingsError(section, "expected an object");
        }
    }
    // So must every nested group a known key lives in ("ai.custom").
    for (const auto& field : schema()) {
        const auto parts = split_path(field.path);
        std::string prefix;
        for (std::size_t i = 0; i + 1 < parts.size(); ++i) {
            prefix += (i == 0 ? "" : ".") + parts[i];
            const json* node = find_path(patch, prefix);
            if (node == nullptr) {
                break;
            }
            if (!node->is_null() && !node->is_object()) {
                throw SettingsError(prefix, "expected an object");
            }
        }
    }
}

void merge_patch(json& target, const json& patch, const json& defaults_node) {
    if (!patch.is_object()) {
        target = patch;
        return;
    }
    if (!target.is_object()) {
        target = json::object();
    }
    for (auto it = patch.begin(); it != patch.end(); ++it) {
        const json* def = defaults_node.is_object() && defaults_node.contains(it.key())
                              ? &defaults_node[it.key()]
                              : nullptr;
        if (it->is_null()) {
            if (def != nullptr) {
                target[it.key()] = *def;
            } else {
                target.erase(it.key());
            }
            continue;
        }
        // Objects merge member-wise except the two records that are always written whole: the
        // window placement and the AI verification record.
        if (it->is_object() && (def == nullptr || def->is_object() || def->is_null()) &&
            it.key() != "windowGeometry" && it.key() != "customVerified") {
            json& child = target[it.key()];
            merge_patch(child, *it, def != nullptr ? *def : json());
        } else {
            target[it.key()] = *it;
        }
    }
}

// ---------------------------------------------------------------- store --------------------

SettingsStore::SettingsStore(std::filesystem::path file)
    : file_(std::move(file)), settings_(defaults()) {}

void SettingsStore::load() {
    settings_ = defaults();
    std::error_code ec;
    if (!std::filesystem::exists(file_, ec)) {
        return;
    }
    json parsed;
    try {
        parsed = json::parse(atomic_file::read_file(file_), nullptr, true, true);
    } catch (const json::parse_error& e) {
        // The exception class and the byte position only - never the text around it (the file
        // may hold the AI key; review D5, R10.2).
        log::error("core", "settings.unreadable", "settings.json could not be read; defaults used",
                   log::extras({{"path", platform::utf8_from_path(file_)},
                                {"exception", exception_class(e)},
                                {"position", std::to_string(e.byte)}}));
        return;
    } catch (const std::exception& e) {
        log::error("core", "settings.unreadable", "settings.json could not be read; defaults used",
                   log::extras({{"path", platform::utf8_from_path(file_)},
                                {"exception", exception_class(e)}}));
        return;
    }
    settings_ = std::move(parsed);
    for (const auto& invalid : sanitize(settings_)) {
        log_invalid(invalid);
    }
}

bool SettingsStore::save() const {
    try {
        std::error_code ec;
        std::filesystem::create_directories(file_.parent_path(), ec);
        atomic_file::write_atomic(file_, settings_.dump(2) + "\n");
        return true;
    } catch (const atomic_file::WriteError& e) {
        log::error("core", "settings.writeFailed", "settings.json could not be written",
                   log::extras({{"path", e.path}, {"reason", e.reason}}));
        return false;
    }
}

ApplyResult SettingsStore::apply_patch(const json& patch) {
    validate_patch(patch);
    const std::string old_language = get_string("view.uiLanguage", "system");
    json updated = settings_;
    merge_patch(updated, patch, defaults());
    for (const auto& invalid : sanitize(updated)) {
        // Only reachable through nested invalid structure not covered by validate_patch.
        throw SettingsError(invalid.field, invalid.reason);
    }
    settings_ = std::move(updated);
    save();
    ApplyResult result;
    result.settings = settings_;
    result.restartRequired = get_string("view.uiLanguage", "system") != old_language;
    return result;
}

std::string SettingsStore::get_string(const std::string& dotted_path,
                                      const std::string& fallback) const {
    const json* v = find_path(settings_, dotted_path);
    return (v != nullptr && v->is_string()) ? v->get<std::string>() : fallback;
}

bool SettingsStore::get_bool(const std::string& dotted_path, bool fallback) const {
    const json* v = find_path(settings_, dotted_path);
    return (v != nullptr && v->is_boolean()) ? v->get<bool>() : fallback;
}

int SettingsStore::get_int(const std::string& dotted_path, int fallback) const {
    const json* v = find_path(settings_, dotted_path);
    return (v != nullptr && v->is_number_integer()) ? v->get<int>() : fallback;
}

}  // namespace mfbe::settings
