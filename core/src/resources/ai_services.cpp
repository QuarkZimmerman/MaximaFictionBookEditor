// The AI service list (feature 005). See mfbe/ai_services.hpp.
#include <mfbe/ai_address.hpp>
#include <mfbe/ai_services.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/unicode.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <map>
#include <system_error>
#include <utility>

namespace mfbe::ai {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;

constexpr std::size_t kMaxNameLength = 100;
constexpr std::size_t kMaxModelLength = 256;
constexpr std::size_t kMaxKeyLength = 4096;
constexpr std::size_t kMaxIdLength = 64;

// `^[a-z0-9][a-z0-9._-]{0,63}$`
bool is_service_id(const std::string& id) {
    if (id.empty() || id.size() > kMaxIdLength) {
        return false;
    }
    const auto tail_char = [](unsigned char c) {
        return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-';
    };
    const auto first = static_cast<unsigned char>(id.front());
    return ((first >= 'a' && first <= 'z') || (first >= '0' && first <= '9')) &&
           std::all_of(id.begin() + 1, id.end(), tail_char);
}

std::string trimmed(const std::string& s) {
    const auto begin = s.find_first_not_of(" \t\r\n");
    if (begin == std::string::npos) {
        return "";
    }
    const auto end = s.find_last_not_of(" \t\r\n");
    return s.substr(begin, end - begin + 1);
}

// A string of min_chars..max_chars code points without control characters (valid UTF-8).
bool is_text(const std::string& s, std::size_t min_chars, std::size_t max_chars) {
    if (!unicode::is_valid_utf8(s) || has_control_characters(s)) {
        return false;
    }
    const std::size_t length = unicode::length(s);
    return length >= min_chars && length <= max_chars;
}
bool is_text(const json& v, std::size_t min_chars, std::size_t max_chars) {
    return v.is_string() && is_text(v.get<std::string>(), min_chars, max_chars);
}

// An absolute http(s) URL for the terms link (mfbe/ai_address.hpp's looser web-page rule).
bool is_terms_url(const json& v) {
    return v.is_string() && ai::is_http_url(v.get<std::string>());
}

struct Parser {
    const fs::path& file;
    Layer layer;
    ParsedFile out;

    void issue(std::string reason, std::optional<int> index = std::nullopt,
               std::optional<std::string> field = std::nullopt) {
        out.issues.push_back(ServiceIssue{file, index, std::move(reason), std::move(field)});
    }

    // One optional member of the wrong type or value: reported, dropped, the entry kept.
    void bad_field(int index, const char* field) { issue("badField", index, field); }

    void parse_entry(const json& item, int index, std::map<std::string, bool>& seen) {
        if (!item.is_object()) {
            issue("notObject", index);
            return;
        }
        ServiceEntry entry;
        entry.source = layer;
        // id
        const auto id_it = item.find("id");
        if (id_it == item.end() || !id_it->is_string()) {
            issue("missingField", index, "id");
            return;
        }
        entry.id = id_it->get<std::string>();
        if (!is_service_id(entry.id)) {
            issue("badId", index);
            return;
        }
        if (seen.count(entry.id) != 0) {
            issue("duplicateId", index);
            return;
        }
        // hidden: a user layer's hide directive needs nothing but the id; the bundled list
        // hides nothing.
        const auto hidden_it = item.find("hidden");
        if (hidden_it != item.end()) {
            if (layer == Layer::bundled || !hidden_it->is_boolean()) {
                bad_field(index, "hidden");
            } else {
                entry.hidden = hidden_it->get<bool>();
            }
        }
        if (entry.hidden) {
            seen[entry.id] = true;
            out.entries.push_back(std::move(entry));
            return;
        }
        // The required members.
        const auto name_it = item.find("name");
        if (name_it == item.end() || !name_it->is_string() ||
            !is_text(trimmed(name_it->get<std::string>()), 1, kMaxNameLength)) {
            issue("missingField", index, "name");
            return;
        }
        entry.name = name_it->get<std::string>();
        const auto address_it = item.find("address");
        if (address_it == item.end() || !address_it->is_string()) {
            issue("missingField", index, "address");
            return;
        }
        const auto parsed = parse_address(address_it->get<std::string>());
        if (!parsed) {
            issue("badAddress", index);
            return;
        }
        entry.address = address_it->get<std::string>();
        entry.base = parsed->base;
        entry.host = parsed->host;
        entry.local = parsed->local;
        entry.plain_http = parsed->plain_http;
        const auto model_it = item.find("model");
        if (model_it == item.end() || !is_text(*model_it, 1, kMaxModelLength)) {
            issue("missingField", index, "model");
            return;
        }
        entry.model = model_it->get<std::string>();
        // The optional members.
        if (const auto it = item.find("keyRequired"); it != item.end()) {
            if (it->is_boolean()) {
                entry.key_required = it->get<bool>();
            } else {
                bad_field(index, "keyRequired");
            }
        }
        if (const auto it = item.find("key"); it != item.end()) {
            if (layer == Layer::bundled || !is_text(*it, 0, kMaxKeyLength)) {
                bad_field(index, "key");
            } else {
                entry.key = it->get<std::string>();
            }
        }
        if (const auto it = item.find("tools"); it != item.end()) {
            if (it->is_boolean()) {
                entry.tools = it->get<bool>();
            } else {
                bad_field(index, "tools");
            }
        }
        if (const auto it = item.find("termsUrl"); it != item.end()) {
            if (is_terms_url(*it)) {
                entry.terms_url = it->get<std::string>();
            } else {
                bad_field(index, "termsUrl");
            }
        }
        if (const auto it = item.find("limits"); it != item.end()) {
            parse_limits(*it, index, entry.limits);
        }
        if (const auto it = item.find("contextLength"); it != item.end()) {
            if (it->is_number_integer() && it->get<std::int64_t>() >= 1) {
                entry.context_length = it->get<std::int64_t>();
            } else {
                bad_field(index, "contextLength");
            }
        }
        seen[entry.id] = true;
        out.entries.push_back(std::move(entry));
    }

    // {en, ru?, uk?} or one string (= en); a missing language falls back to `en`; a language
    // that is not a string is reported and falls back too.
    void parse_limits(const json& value, int index, ServiceLimits& limits) {
        if (value.is_string()) {
            limits.en = value.get<std::string>();
            limits.ru = limits.en;
            limits.uk = limits.en;
            return;
        }
        if (!value.is_object()) {
            bad_field(index, "limits");
            return;
        }
        // A language that is absent, or not a string (reported), falls back to `en`.
        const auto language = [&](const char* lang) -> std::optional<std::string> {
            const auto it = value.find(lang);
            if (it == value.end()) {
                return std::nullopt;
            }
            if (!it->is_string()) {
                issue("badField", index, std::string("limits.") + lang);
                return std::nullopt;
            }
            return it->get<std::string>();
        };
        limits.en = language("en").value_or("");
        limits.ru = language("ru").value_or(limits.en);
        limits.uk = language("uk").value_or(limits.en);
    }
};

// Reads a file's bytes; nullopt (with the issue) when it cannot be read - a missing file, a
// permission problem, a directory in its place (the stream's own failure on some platforms).
std::optional<std::string> read_list_file(const fs::path& file, std::vector<ServiceIssue>& issues) {
    try {
        return atomic_file::read_file(file);
    } catch (const std::exception&) {
        issues.push_back(ServiceIssue{file, std::nullopt, "unreadable", std::nullopt});
        return std::nullopt;
    }
}

bool path_exists(const fs::path& path) {
    std::error_code ec;
    return !path.empty() && fs::exists(path, ec);
}

void log_issue(const ServiceIssue& issue) {
    std::map<std::string, std::string> extra{{"path", platform::utf8_from_path(issue.file)}};
    if (issue.index) {
        extra["index"] = std::to_string(*issue.index);
    }
    if (issue.field) {
        extra["field"] = *issue.field;
    }
    log::warning("core", "aiServices." + issue.reason, "AI service list issue",
                 log::extras(std::move(extra)));
}

}  // namespace

const char* to_string(Layer layer) {
    switch (layer) {
        case Layer::bundled:
            return "bundled";
        case Layer::user:
            return "user";
        case Layer::portable:
            return "portable";
    }
    return "bundled";
}

json ServiceEntry::to_json() const {
    json j{{"id", id},
           {"name", name},
           {"address", address},
           {"model", model},
           {"keyRequired", key_required},
           {"hasKey", has_key()},
           {"tools", tools},
           {"limits", {{"en", limits.en}, {"ru", limits.ru}, {"uk", limits.uk}}},
           {"source", to_string(source)},
           {"replaced", replaced},
           {"local", local},
           {"plainHttp", plain_http}};
    if (terms_url) {
        j["termsUrl"] = *terms_url;
    }
    if (context_length) {
        j["contextLength"] = *context_length;
    }
    return j;
}

json ServiceIssue::to_json() const {
    json j{{"file", platform::utf8_from_path(file)}, {"reason", reason}};
    if (index) {
        j["index"] = *index;
    }
    if (field) {
        j["field"] = *field;
    }
    return j;
}

UserLayer UserLayer::of(const platform::Dirs& dirs) {
    UserLayer layer;
    layer.user = dirs.data / kServicesFileName;
    // A portable folder the editor can write to is `data` itself (resource-formats §1a); only
    // a read-only one is a layer of its own.
    if (dirs.portable && *dirs.portable != dirs.data) {
        layer.portable = *dirs.portable / kServicesFileName;
    }
    return layer;
}

ParsedFile parse_services_file(const fs::path& file, std::string_view bytes, Layer layer) {
    Parser parser{file, layer, {}};
    if (bytes.size() >= 3 && static_cast<unsigned char>(bytes[0]) == 0xEF &&
        static_cast<unsigned char>(bytes[1]) == 0xBB &&
        static_cast<unsigned char>(bytes[2]) == 0xBF) {
        bytes.remove_prefix(3);  // a UTF-8 BOM is accepted and skipped
    }
    const json root = json::parse(bytes, nullptr, false);
    if (root.is_discarded()) {
        parser.issue("invalidJson");
        return std::move(parser.out);
    }
    if (!root.is_object()) {
        parser.issue("notObject");
        return std::move(parser.out);
    }
    const auto version = root.find("version");
    if (version == root.end() || !version->is_number_integer() || version->get<int>() != 1) {
        parser.issue("badVersion");
        return std::move(parser.out);
    }
    const auto services = root.find("services");
    if (services == root.end() || !services->is_array()) {
        parser.issue("missingField", std::nullopt, "services");
        return std::move(parser.out);
    }
    std::map<std::string, bool> seen;
    int index = 0;
    for (const auto& item : *services) {
        parser.parse_entry(item, index++, seen);
    }
    return std::move(parser.out);
}

const ServiceEntry* ServiceList::find(std::string_view id) const {
    for (const auto& entry : services) {
        if (entry.id == id) {
            return &entry;
        }
    }
    return nullptr;
}

json ServiceList::to_json() const {
    json result{{"services", json::array()},
                {"hidden", hidden},
                {"files",
                 {{"bundled", platform::utf8_from_path(files.bundled)},
                  {"user", platform::utf8_from_path(files.user)},
                  {"userExists", files.user_exists}}},
                {"issues", json::array()}};
    for (const auto& entry : services) {
        result["services"].push_back(entry.to_json());
    }
    if (files.portable) {
        result["files"]["portable"] = platform::utf8_from_path(*files.portable);
    }
    for (const auto& issue : issues) {
        result["issues"].push_back(issue.to_json());
    }
    return result;
}

ServiceList ServiceList::load(const fs::path& bundled_path, const UserLayer& layer) {
    ServiceList list;
    list.files.bundled = bundled_path;
    list.files.user = layer.user;
    list.files.user_exists = path_exists(layer.user);

    // The bundled file.
    std::vector<ServiceEntry> bundled;
    if (const auto bytes = read_list_file(bundled_path, list.issues)) {
        ParsedFile parsed = parse_services_file(bundled_path, *bytes, Layer::bundled);
        bundled = std::move(parsed.entries);
        list.issues.insert(list.issues.end(), parsed.issues.begin(), parsed.issues.end());
    }

    // The one user layer: the data folder's file when it exists, else the read-only portable
    // file when it exists, else none.
    std::vector<ServiceEntry> user;
    std::optional<std::pair<fs::path, Layer>> user_file;
    if (list.files.user_exists) {
        user_file = {layer.user, Layer::user};
    } else if (layer.portable && path_exists(*layer.portable)) {
        user_file = {*layer.portable, Layer::portable};
        list.files.portable = *layer.portable;
    }
    if (user_file) {
        if (const auto bytes = read_list_file(user_file->first, list.issues)) {
            ParsedFile parsed = parse_services_file(user_file->first, *bytes, user_file->second);
            user = std::move(parsed.entries);
            list.issues.insert(list.issues.end(), parsed.issues.begin(), parsed.issues.end());
        }
    }

    // Union by id: bundled order, a user entry replaces or hides the bundled one, user-only
    // entries follow in user-file order (a user-only hide directive is simply absent).
    std::map<std::string, std::size_t> user_by_id;
    for (std::size_t i = 0; i < user.size(); ++i) {
        user_by_id[user[i].id] = i;
    }
    std::vector<bool> consumed(user.size(), false);
    for (auto& entry : bundled) {
        const auto it = user_by_id.find(entry.id);
        if (it == user_by_id.end()) {
            list.services.push_back(std::move(entry));
            continue;
        }
        consumed[it->second] = true;
        ServiceEntry& replacement = user[it->second];
        if (replacement.hidden) {
            list.hidden.push_back(entry.id);
            continue;
        }
        replacement.replaced = true;
        list.services.push_back(std::move(replacement));
    }
    for (std::size_t i = 0; i < user.size(); ++i) {
        if (!consumed[i] && !user[i].hidden) {
            list.services.push_back(std::move(user[i]));
        }
    }

    for (const auto& issue : list.issues) {
        log_issue(issue);
    }
    return list;
}

UserCopy create_user_copy(const fs::path& bundled_path, const fs::path& user_path) {
    UserCopy result;
    result.path = user_path;
    if (path_exists(user_path)) {
        result.created = false;
        return result;
    }
    const std::string bytes = atomic_file::read_file(bundled_path);  // throws WriteError
    std::error_code ec;
    fs::create_directories(user_path.parent_path(), ec);
    atomic_file::write_atomic(user_path, bytes);  // throws WriteError
    result.created = true;
    return result;
}

}  // namespace mfbe::ai
