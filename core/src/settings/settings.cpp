// Settings store (T018). See mfbe/settings.hpp.
#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/settings.hpp>
#include <mfbe/unicode.hpp>

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
    bool_map
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
        enumeration("view.uiLanguage", {"system", "en", "ru"}),
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
        field("view.spellEnabled", Kind::boolean),
        field("view.spellHighlight", Kind::boolean),
        field("view.customDictionaryPath", Kind::string),
        field("view.fastMode", Kind::boolean),
        enumeration("other.defaultEncoding", supported_encodings()),
        field("other.keepEncoding", Kind::boolean),
        field("other.restorePosition", Kind::boolean),
        field("other.scriptsFolder", Kind::string),
        field("other.genresFolder", Kind::string),
        field("other.askOnNonClearImage", Kind::boolean),
        field("other.insertClearImages", Kind::boolean),
        enumeration("other.pasteImageFormat", {"jpeg", "png"}),
        integer("other.jpegQuality", 1, 100),
        field("other.nbspDisplayChar", Kind::string),
        field("words.showExclusionsInWordsDialog", Kind::boolean),
        field("session.windowGeometry", Kind::nullable_object),
        field("session.toolbars", Kind::bool_map),
        field("session.treeVisible", Kind::boolean),
        field("session.findHistory", Kind::string_array),
        field("session.replaceHistory", Kind::string_array),
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
          {"askOnNonClearImage", true},
          {"insertClearImages", false},
          {"pasteImageFormat", "jpeg"},
          {"jpegQuality", 90},
          {"nbspDisplayChar", "\u00B0"}}},
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
          {"replaceHistory", json::array()}}},
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
                   log::extras({{"path", file_.string()}, {"reason", e.what()}}));
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
