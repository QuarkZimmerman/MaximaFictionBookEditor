// Settings store (T018). See mfbe/settings.hpp.
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
    bool_map,
    string_list_map,    // object whose values are arrays of strings (toolbar layouts)
    optional_timestamp  // "YYYY-MM-DDTHH:MM:SS[.sss]Z" or absent: no default, null removes it
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
        field("words.showExclusionsInWordsDialog", Kind::boolean),
        // {x, y, width, height, maximized?: boolean} | null - the normal bounds plus the
        // maximised state, written by the shell at quit; replaced as a whole, not validated.
        field("session.windowGeometry", Kind::nullable_object),
        field("session.toolbars", Kind::bool_map),
        field("session.treeVisible", Kind::boolean),
        field("session.findHistory", Kind::string_array),
        field("session.replaceHistory", Kind::string_array),
        // Toolbar layouts by toolbar ("commands", "scripts"): ordered button ids and "-"; ids
        // the UI does not know are kept as stored and dropped by the UI when it loads them.
        field("session.toolbarLayouts", Kind::string_list_map),
        field("session.lastFileDialogFolder", Kind::string),
        // When the last version check got an answer (feature 003); absent until one did.
        field("session.lastVersionCheck", Kind::optional_timestamp),
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
    const auto number = [&s](std::size_t from) { return std::stoi(s.substr(from, 2)); };
    const int month = number(5);
    const int day = number(8);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 && number(11) <= 23 &&
           number(14) <= 59 && number(17) <= 60;
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
    }
    return "invalid";
}

void log_invalid(const Invalid& invalid) {
    log::warning("core", "settings.invalidValue", "invalid setting replaced by its default",
                 log::extras({{"field", invalid.field}, {"reason", invalid.reason}}));
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
          {"versionCheck", "monthly"}}},
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
          {"findHistory", json::array()},
          {"replaceHistory", json::array()},
          {"toolbarLayouts", json::object()},
          {"lastFileDialogFolder", ""}}},
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
        const bool missing = value->is_null() && field.kind != Kind::nullable_object;
        if (missing) {
            *value = *default_value;
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
    for (const char* section : {"view", "other", "words", "session"}) {
        auto it = patch.find(section);
        if (it != patch.end() && !it->is_null() && !it->is_object()) {
            throw SettingsError(section, "expected an object");
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
        if (it->is_object() && (def == nullptr || def->is_object() || def->is_null()) &&
            it.key() != "windowGeometry") {
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
    } catch (const std::exception& e) {
        log::error("core", "settings.unreadable", "settings.json could not be read; defaults used",
                   log::extras({{"path", platform::utf8_from_path(file_)}, {"reason", e.what()}}));
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
