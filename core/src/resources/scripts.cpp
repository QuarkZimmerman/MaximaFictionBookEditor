// Script package discovery (T101). See mfbe/scripts.hpp.
#include <mfbe/log.hpp>
#include <mfbe/scripts.hpp>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <set>
#include <system_error>

namespace mfbe::scripts {
namespace {

namespace fs = std::filesystem;
using nlohmann::json;

constexpr const char* kTreeGroup = "tree";
constexpr int kUngroupedOrder = -1;
constexpr int kUnnumberedOrder = 10000;

// UTF-8 <-> path conversions (`.string()` would use the ANSI code page on Windows).
std::string to_utf8(const fs::path& p) {
    const std::u8string u8 = p.u8string();
    return std::string(u8.begin(), u8.end());
}

fs::path from_utf8(std::string_view text) {
    return fs::path(std::u8string(reinterpret_cast<const char8_t*>(text.data()), text.size()));
}

std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

std::string trim(std::string s) {
    const auto not_space = [](unsigned char c) { return !std::isspace(c); };
    s.erase(s.begin(), std::find_if(s.begin(), s.end(), not_space));
    s.erase(std::find_if(s.rbegin(), s.rend(), not_space).base(), s.end());
    return s;
}

std::optional<std::string> read_text_file(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return std::nullopt;
    }
    std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    if (in.bad()) {
        return std::nullopt;
    }
    if (text.size() >= 3 && text.compare(0, 3, "\xEF\xBB\xBF") == 0) {
        text.erase(0, 3);
    }
    return text;
}

bool is_dir(const fs::path& p) {
    std::error_code ec;
    return fs::is_directory(p, ec);
}

bool is_file(const fs::path& p) {
    std::error_code ec;
    return fs::is_regular_file(p, ec);
}

std::vector<fs::directory_entry> sorted_entries(const fs::path& dir) {
    std::error_code ec;
    std::vector<fs::directory_entry> entries;
    for (fs::directory_iterator it(dir, ec), end; !ec && it != end; it.increment(ec)) {
        entries.push_back(*it);
    }
    std::sort(entries.begin(), entries.end(),
              [](const fs::directory_entry& a, const fs::directory_entry& b) {
                  return to_utf8(a.path().filename()) < to_utf8(b.path().filename());
              });
    return entries;
}

// Reads a {"en": "...", "ru": "..."} map (or a plain string, used for every language).
bool read_names(const json& value, Names& out) {
    if (value.is_string()) {
        out["en"] = value.get<std::string>();
        return true;
    }
    if (!value.is_object()) {
        return false;
    }
    bool ok = true;
    for (auto it = value.begin(); it != value.end(); ++it) {
        if (!it->is_string()) {
            ok = false;
            continue;
        }
        out[it.key()] = it->get<std::string>();
    }
    return ok;
}

// A relative file name inside the package: no absolute paths, backslashes or ".." segments.
bool is_safe_relative_file(std::string_view file) {
    if (file.empty() || file.front() == '/' || file.find('\\') != std::string_view::npos ||
        file.find('\0') != std::string_view::npos) {
        return false;
    }
    std::size_t pos = 0;
    while (pos <= file.size()) {
        const std::size_t slash = file.find('/', pos);
        const std::string_view segment = file.substr(
            pos, slash == std::string_view::npos ? std::string_view::npos : slash - pos);
        if (segment.empty() || segment == "." || segment == "..") {
            return false;
        }
        if (slash == std::string_view::npos) {
            break;
        }
        pos = slash + 1;
    }
    // Windows drive letters ("C:/...") are absolute too.
    return !(file.size() >= 2 && file[1] == ':');
}

std::size_t utf8_length(std::string_view text) {
    std::size_t count = 0;
    for (unsigned char c : text) {
        if ((c & 0xC0) != 0x80) {
            ++count;
        }
    }
    return count;
}

const std::set<std::string>& named_keys() {
    static const std::set<std::string> keys = {
        "enter",      "space",   "tab",        "escape",      "esc",    "delete",      "del",
        "backspace",  "insert",  "ins",        "home",        "end",    "pageup",      "pgup",
        "pagedown",   "pgdn",    "pgdown",     "arrowup",     "up",     "arrowdown",   "down",
        "arrowleft",  "left",    "arrowright", "right",       "pause",  "printscreen", "prtsc",
        "scrolllock", "numlock", "capslock",   "contextmenu", "return", "spacebar"};
    return keys;
}

bool is_valid_key_token(std::string_view raw) {
    const std::string token = trim(std::string(raw));
    if (token.empty()) {
        return false;
    }
    const std::string low = lower(token);
    if (token.size() == 1) {
        const auto c = static_cast<unsigned char>(token[0]);
        return std::isalnum(c) != 0 || (std::ispunct(c) != 0);
    }
    if (low.size() >= 2 && low[0] == 'f') {
        const std::string digits = low.substr(1);
        if (std::all_of(digits.begin(), digits.end(),
                        [](unsigned char c) { return std::isdigit(c) != 0; })) {
            const int n = std::stoi(digits);
            return n >= 1 && n <= 12;
        }
    }
    if (low.rfind("unicode:", 0) == 0) {
        const std::string hex = low.substr(8);
        return !hex.empty() && hex.size() <= 6 &&
               std::all_of(hex.begin(), hex.end(),
                           [](unsigned char c) { return std::isxdigit(c) != 0; });
    }
    if (named_keys().count(low) > 0) {
        return true;
    }
    // A single non-ASCII character (symbol insertion keys).
    return utf8_length(token) == 1;
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Pure helpers                                                                               */
/* ----------------------------------------------------------------------------------------- */

bool is_valid_hotkey_chord(std::string_view chord) {
    const std::string text = trim(std::string(chord));
    if (text.empty()) {
        return false;
    }
    // Split on '+' but keep a trailing '+' key ("Ctrl++").
    std::vector<std::string> parts;
    std::string current;
    for (std::size_t i = 0; i < text.size(); ++i) {
        const char ch = text[i];
        if (ch == '+' && !current.empty() && i + 1 < text.size()) {
            parts.push_back(current);
            current.clear();
        } else {
            current.push_back(ch);
        }
    }
    parts.push_back(current);
    static const std::map<std::string, std::string> kModifiers = {
        {"ctrl", "ctrl"},  {"control", "ctrl"}, {"ctl", "ctrl"},    {"alt", "alt"},
        {"option", "alt"}, {"opt", "alt"},      {"shift", "shift"}, {"meta", "meta"},
        {"cmd", "meta"},   {"command", "meta"}, {"win", "meta"},    {"super", "meta"},
        {"mod", "mod"}};
    std::set<std::string> seen;
    for (std::size_t i = 0; i < parts.size(); ++i) {
        const std::string part = lower(trim(parts[i]));
        const bool last = i + 1 == parts.size();
        const auto modifier = kModifiers.find(part);
        if (modifier != kModifiers.end() && !last) {
            if (!seen.insert(modifier->second).second) {
                return false;  // duplicate modifier
            }
            continue;
        }
        if (!last) {
            return false;
        }
        return is_valid_key_token(parts[i]);
    }
    return false;
}

bool is_valid_script_id(std::string_view id) {
    if (id.empty() || id.size() > 200) {
        return false;
    }
    for (unsigned char c : id) {
        if (c < 0x20 || c == 0x7F || c == '\\') {
            return false;
        }
    }
    if (id.front() == '/' || id.back() == '/' || id.find("//") != std::string_view::npos) {
        return false;
    }
    if (trim(std::string(id)) != id) {
        return false;
    }
    std::size_t pos = 0;
    while (pos <= id.size()) {
        const std::size_t slash = id.find('/', pos);
        const std::string_view segment =
            id.substr(pos, slash == std::string_view::npos ? std::string_view::npos : slash - pos);
        if (segment == "." || segment == "..") {
            return false;
        }
        if (slash == std::string_view::npos) {
            break;
        }
        pos = slash + 1;
    }
    return true;
}

std::string strip_order_prefix(const std::string& folder, std::optional<int>* order) {
    std::size_t i = 0;
    while (i < folder.size() && std::isdigit(static_cast<unsigned char>(folder[i])) != 0) {
        ++i;
    }
    if (i > 0 && i < 9 && i < folder.size() && folder[i] == '_' && i + 1 < folder.size()) {
        if (order != nullptr) {
            *order = std::stoi(folder.substr(0, i));
        }
        return folder.substr(i + 1);
    }
    if (order != nullptr) {
        order->reset();
    }
    return folder;
}

std::string url_encode_segment(std::string_view text) {
    static const char* kHex = "0123456789ABCDEF";
    std::string out;
    out.reserve(text.size() * 3);
    for (unsigned char c : text) {
        const bool unreserved =
            std::isalnum(c) != 0 || c == '-' || c == '_' || c == '.' || c == '~';
        if (unreserved) {
            out.push_back(static_cast<char>(c));
        } else {
            out.push_back('%');
            out.push_back(kHex[c >> 4]);
            out.push_back(kHex[c & 0x0F]);
        }
    }
    return out;
}

std::string package_url(const std::string& id, const std::string& file) {
    std::string url = "/scripts/" + url_encode_segment(id) + "/";
    std::size_t pos = 0;
    bool first = true;
    while (pos <= file.size()) {
        const std::size_t slash = file.find('/', pos);
        const std::string segment =
            file.substr(pos, slash == std::string::npos ? std::string::npos : slash - pos);
        if (!first) {
            url.push_back('/');
        }
        url += url_encode_segment(segment);
        first = false;
        if (slash == std::string::npos) {
            break;
        }
        pos = slash + 1;
    }
    return url;
}

fs::path resolve_package_file(const ScriptPackage& package, std::string_view file) {
    if (!is_safe_relative_file(file) || package.dir.empty()) {
        return {};
    }
    std::error_code ec;
    const fs::path base = fs::weakly_canonical(package.dir, ec);
    if (ec) {
        return {};
    }
    const fs::path candidate = fs::weakly_canonical(base / from_utf8(file), ec);
    if (ec) {
        return {};
    }
    const std::string base_str = base.generic_string();
    const std::string cand_str = candidate.generic_string();
    if (cand_str.size() <= base_str.size() || cand_str.compare(0, base_str.size(), base_str) != 0 ||
        cand_str[base_str.size()] != '/') {
        return {};
    }
    if (!is_file(candidate)) {
        return {};
    }
    return candidate;
}

std::vector<std::string> package_files(const ScriptPackage& package) {
    std::vector<std::string> files;
    std::error_code ec;
    for (fs::recursive_directory_iterator it(package.dir, ec), end; !ec && it != end;
         it.increment(ec)) {
        std::error_code file_ec;
        if (!it->is_regular_file(file_ec)) {
            continue;
        }
        const std::u8string rel = fs::relative(it->path(), package.dir, file_ec).generic_u8string();
        files.emplace_back(rel.begin(), rel.end());
    }
    std::sort(files.begin(), files.end());
    return files;
}

/* ----------------------------------------------------------------------------------------- */
/* Manifest                                                                                   */
/* ----------------------------------------------------------------------------------------- */

ParsedManifest parse_manifest(const json& manifest, const std::string& default_id,
                              const std::string& default_kind) {
    ParsedManifest parsed;
    auto error = [&](const std::string& reason, const std::string& detail) {
        parsed.errors.push_back(reason + ": " + detail);
    };
    auto warning = [&](const std::string& reason, const std::string& detail) {
        parsed.warnings.push_back(reason + ": " + detail);
    };
    if (!manifest.is_object()) {
        error("invalidManifest", "script.json must contain a JSON object");
        return parsed;
    }
    ScriptManifest m;

    const auto version = manifest.find("manifestVersion");
    if (version == manifest.end()) {
        error("manifestVersion", "required field is missing");
    } else if (!version->is_number_integer() || version->get<int>() != 1) {
        error("manifestVersion", "unsupported value (expected 1)");
    }

    const auto id = manifest.find("id");
    if (id == manifest.end() || id->is_null()) {
        m.id = default_id;
    } else if (!id->is_string()) {
        error("id", "expected a string");
    } else {
        m.id = id->get<std::string>();
    }
    if (!is_valid_script_id(m.id)) {
        error("id", "invalid id \"" + m.id + "\"");
    }

    const auto name = manifest.find("name");
    if (name == manifest.end()) {
        error("name", "required field is missing");
    } else if (!read_names(*name, m.name) && m.name.empty()) {
        error("name", "expected a map of language to text");
    } else if (m.name.count("en") == 0 || trim(m.name["en"]).empty()) {
        error("name", "the English name (\"en\") is required");
    }

    if (const auto description = manifest.find("description"); description != manifest.end()) {
        if (!read_names(*description, m.description)) {
            warning("description", "expected a map of language to text");
        }
    }
    if (const auto undo = manifest.find("undoLabel"); undo != manifest.end()) {
        if (!read_names(*undo, m.undoLabel)) {
            warning("undoLabel", "expected a map of language to text");
        }
    }

    const auto kind = manifest.find("kind");
    if (kind == manifest.end() || kind->is_null()) {
        m.kind = default_kind;
        warning("kind", "missing; assumed \"" + default_kind + "\"");
    } else if (!kind->is_string() ||
               (kind->get<std::string>() != "menu" && kind->get<std::string>() != "tree")) {
        error("kind", "expected \"menu\" or \"tree\"");
    } else {
        m.kind = kind->get<std::string>();
    }

    if (const auto entry = manifest.find("entry"); entry != manifest.end() && !entry->is_null()) {
        if (!entry->is_string() || !is_safe_relative_file(entry->get<std::string>())) {
            error("entry", "expected a relative file name inside the script folder");
        } else {
            m.entry = entry->get<std::string>();
        }
    }
    if (const auto icon = manifest.find("icon"); icon != manifest.end() && !icon->is_null()) {
        if (!icon->is_string() || !is_safe_relative_file(icon->get<std::string>())) {
            warning("icon", "expected a relative file name inside the script folder");
        } else {
            const std::string ext = lower(fs::path(icon->get<std::string>()).extension().string());
            if (ext != ".png" && ext != ".ico" && ext != ".svg") {
                warning("icon", "expected a PNG, ICO or SVG file");
            } else {
                m.icon = icon->get<std::string>();
            }
        }
    }
    if (const auto hotkey = manifest.find("defaultHotkey");
        hotkey != manifest.end() && !hotkey->is_null()) {
        if (!hotkey->is_string() || !is_valid_hotkey_chord(hotkey->get<std::string>())) {
            warning(
                "defaultHotkey",
                "invalid chord" + (hotkey->is_string() ? " \"" + hotkey->get<std::string>() + "\""
                                                       : std::string()));
        } else {
            m.defaultHotkey = trim(hotkey->get<std::string>());
        }
    }
    if (const auto needs = manifest.find("needsSelection");
        needs != manifest.end() && !needs->is_null()) {
        if (!needs->is_boolean()) {
            warning("needsSelection", "expected a boolean");
        } else {
            m.needsSelection = needs->get<bool>();
        }
    }
    if (const auto legacy = manifest.find("legacy");
        legacy != manifest.end() && !legacy->is_null()) {
        if (!legacy->is_object() || !legacy->contains("source") ||
            !(*legacy)["source"].is_string()) {
            warning("legacy", "expected an object with a \"source\" string");
        } else {
            LegacyInfo info;
            info.source = (*legacy)["source"].get<std::string>();
            if (legacy->contains("fbeVersion") && (*legacy)["fbeVersion"].is_string()) {
                info.fbeVersion = (*legacy)["fbeVersion"].get<std::string>();
            }
            m.legacy = std::move(info);
        }
    }

    if (parsed.errors.empty()) {
        parsed.manifest = std::move(m);
    }
    return parsed;
}

ParsedManifest parse_manifest_text(const std::string& text, const std::string& default_id,
                                   const std::string& default_kind) {
    json manifest;
    try {
        manifest = json::parse(text);
    } catch (const json::exception& e) {
        ParsedManifest parsed;
        parsed.errors.push_back(std::string("invalidJson: ") + e.what());
        return parsed;
    }
    return parse_manifest(manifest, default_id, default_kind);
}

/* ----------------------------------------------------------------------------------------- */
/* Catalog                                                                                    */
/* ----------------------------------------------------------------------------------------- */

const ScriptPackage* Catalog::find(const std::string& id) const {
    for (const Group& g : groups_) {
        for (const ScriptPackage& p : g.scripts) {
            if (p.id == id) {
                return &p;
            }
        }
    }
    return nullptr;
}

std::size_t Catalog::size() const {
    std::size_t n = 0;
    for (const Group& g : groups_) {
        n += g.scripts.size();
    }
    return n;
}

Group* Catalog::group(const std::string& id) {
    for (Group& g : groups_) {
        if (g.id == id) {
            return &g;
        }
    }
    return nullptr;
}

const Group* Catalog::group(const std::string& id) const {
    for (const Group& g : groups_) {
        if (g.id == id) {
            return &g;
        }
    }
    return nullptr;
}

Group& Catalog::add_group(Group group) {
    if (Group* existing = this->group(group.id)) {
        // Another layer contributes to the same group: keep the first names, fill gaps.
        for (const auto& [lang, text] : group.names) {
            existing->names.emplace(lang, text);
        }
        if (existing->icon.empty()) {
            existing->icon = group.icon;
        }
        return *existing;
    }
    groups_.push_back(std::move(group));
    return groups_.back();
}

bool Catalog::add_package(ScriptPackage package) {
    if (const ScriptPackage* existing = find(package.id)) {
        Issue issue;
        issue.path = package.dir;
        issue.id = package.id;
        issue.reason = "duplicateId";
        issue.severity = "warning";
        issue.message = "script id already provided by " + to_utf8(existing->dir) + " (" +
                        resources::to_string(existing->layer) + " layer); ignored";
        log::warning("core", "scripts.conflict",
                     "script id present in several layers; kept the first",
                     log::extras({{"id", package.id},
                                  {"kept", to_utf8(existing->dir)},
                                  {"ignored", to_utf8(package.dir)}}));
        issues_.push_back(std::move(issue));
        return false;
    }
    Group* g = group(package.group);
    if (g == nullptr) {
        Group created;
        created.id = package.group;
        std::optional<int> order;
        const std::string stripped = strip_order_prefix(package.group, &order);
        created.order = package.group.empty() ? kUngroupedOrder : order.value_or(kUnnumberedOrder);
        created.names["en"] = stripped;
        created.dir = package.dir.parent_path();
        g = &add_group(std::move(created));
    }
    g->scripts.push_back(std::move(package));
    return true;
}

void Catalog::set_folder(const std::string& key, fs::path path) {
    folders_[key] = std::move(path);
}

void Catalog::prune_empty_groups() {
    groups_.erase(std::remove_if(groups_.begin(), groups_.end(),
                                 [](const Group& g) { return g.scripts.empty(); }),
                  groups_.end());
}

namespace {

// Natural order of folder names: numeric prefix first, then the name.
bool folder_less(const fs::path& a, const fs::path& b) {
    std::optional<int> oa;
    std::optional<int> ob;
    const std::string fa = to_utf8(a.filename());
    const std::string fb = to_utf8(b.filename());
    const std::string na = strip_order_prefix(fa, &oa);
    const std::string nb = strip_order_prefix(fb, &ob);
    if (oa.has_value() != ob.has_value()) {
        return oa.has_value();  // numbered first
    }
    if (oa && ob && *oa != *ob) {
        return *oa < *ob;
    }
    if (na != nb) {
        return na < nb;
    }
    return fa < fb;
}

}  // namespace

void Catalog::sort() {
    std::stable_sort(groups_.begin(), groups_.end(), [](const Group& a, const Group& b) {
        // tree commands last (they never appear in the Scripts menu).
        const bool tree_a = a.id == kTreeGroup;
        const bool tree_b = b.id == kTreeGroup;
        if (tree_a != tree_b) {
            return tree_b;
        }
        if (a.order != b.order) {
            return a.order < b.order;
        }
        return a.id < b.id;
    });
    for (Group& g : groups_) {
        std::stable_sort(g.scripts.begin(), g.scripts.end(),
                         [](const ScriptPackage& a, const ScriptPackage& b) {
                             return folder_less(a.dir, b.dir);
                         });
    }
}

json Catalog::package_to_json(const ScriptPackage& p) {
    const ScriptManifest& m = p.manifest;
    json j{{"manifestVersion", m.manifestVersion},
           {"id", p.id},
           {"name", json(m.name)},
           {"kind", m.kind},
           {"entry", m.entry},
           {"needsSelection", m.needsSelection},
           {"group", p.group},
           {"dir", to_utf8(p.dir)},
           {"folder", to_utf8(p.dir.filename())},
           {"source", resources::to_string(p.layer)},
           {"entryUrl", package_url(p.id, m.entry)},
           {"warnings", json(p.warnings)}};
    if (!m.description.empty()) {
        j["description"] = json(m.description);
    }
    if (!m.undoLabel.empty()) {
        j["undoLabel"] = json(m.undoLabel);
    }
    if (!m.icon.empty()) {
        j["icon"] = m.icon;
        j["iconUrl"] = package_url(p.id, m.icon);
    }
    if (!m.defaultHotkey.empty()) {
        j["defaultHotkey"] = m.defaultHotkey;
    }
    if (m.legacy) {
        json legacy{{"source", m.legacy->source}};
        if (!m.legacy->fbeVersion.empty()) {
            legacy["fbeVersion"] = m.legacy->fbeVersion;
        }
        j["legacy"] = std::move(legacy);
    }
    return j;
}

json Catalog::to_json() const {
    json groups = json::array();
    for (const Group& g : groups_) {
        json scripts = json::array();
        for (const ScriptPackage& p : g.scripts) {
            scripts.push_back(package_to_json(p));
        }
        json jg{{"id", g.id},
                {"order", g.order},
                {"names", json(g.names)},
                {"dir", to_utf8(g.dir)},
                {"scripts", std::move(scripts)}};
        if (!g.icon.empty()) {
            jg["icon"] = g.icon;
        }
        groups.push_back(std::move(jg));
    }
    json issues = json::array();
    for (const Issue& i : issues_) {
        json ji{{"path", to_utf8(i.path)},
                {"reason", i.reason},
                {"message", i.message},
                {"severity", i.severity}};
        if (!i.id.empty()) {
            ji["id"] = i.id;
        }
        issues.push_back(std::move(ji));
    }
    json folders = json::object();
    for (const auto& [key, path] : folders_) {
        folders[key] = to_utf8(path);
    }
    return json{{"groups", std::move(groups)}, {"issues", std::move(issues)}, {"folders", folders}};
}

/* ----------------------------------------------------------------------------------------- */
/* Loader                                                                                     */
/* ----------------------------------------------------------------------------------------- */

namespace {

void load_group_json(const fs::path& dir, Group& group, Catalog& catalog) {
    const fs::path file = dir / "group.json";
    if (!is_file(file)) {
        return;
    }
    const auto text = read_text_file(file);
    json j;
    try {
        if (!text) {
            throw std::runtime_error("unreadable");
        }
        j = json::parse(*text);
    } catch (const std::exception& e) {
        Issue issue;
        issue.path = file;
        issue.reason = "invalidGroupJson";
        issue.severity = "warning";
        issue.message = e.what();
        log::warning("core", "scripts.invalidManifest", "group.json could not be parsed",
                     log::extras({{"path", to_utf8(file)}, {"reason", e.what()}}));
        catalog.add_issue(std::move(issue));
        return;
    }
    if (!j.is_object()) {
        return;
    }
    Names names;
    if (j.contains("names")) {
        read_names(j["names"], names);
    } else if (j.contains("name")) {
        read_names(j["name"], names);
    }
    for (const auto& [lang, value] : names) {
        if (!trim(value).empty()) {
            group.names[lang] = value;
        }
    }
    if (j.contains("icon") && j["icon"].is_string() &&
        is_safe_relative_file(j["icon"].get<std::string>()) &&
        is_file(dir / from_utf8(j["icon"].get<std::string>()))) {
        group.icon = j["icon"].get<std::string>();
    }
}

void load_package(const fs::path& dir, const std::string& group_id, resources::LayerName layer,
                  Catalog& catalog) {
    const fs::path manifest_file = dir / "script.json";
    const std::string folder = to_utf8(dir.filename());
    const std::string default_id = group_id.empty() ? folder : group_id + "/" + folder;
    const std::string default_kind = group_id == kTreeGroup ? "tree" : "menu";
    const auto text = read_text_file(manifest_file);
    ParsedManifest parsed;
    if (!text) {
        parsed.errors.push_back("unreadable: script.json could not be read");
    } else {
        parsed = parse_manifest_text(*text, default_id, default_kind);
    }
    if (!parsed.manifest) {
        std::string message;
        for (const std::string& e : parsed.errors) {
            message += (message.empty() ? "" : "; ") + e;
        }
        Issue issue;
        issue.path = dir;
        issue.reason = parsed.errors.size() == 1 && parsed.errors[0].rfind("invalidJson", 0) == 0
                           ? "invalidJson"
                           : "invalidManifest";
        issue.message = message;
        log::warning("core", "scripts.invalidManifest", "script package skipped",
                     log::extras({{"path", to_utf8(dir)}, {"reason", message}}));
        catalog.add_issue(std::move(issue));
        return;
    }
    ScriptPackage package;
    package.manifest = std::move(*parsed.manifest);
    package.id = package.manifest.id;
    package.dir = dir;
    package.group = group_id;
    package.layer = layer;
    for (const std::string& w : parsed.warnings) {
        package.warnings.push_back(w);
    }
    if (!is_file(dir / from_utf8(package.manifest.entry))) {
        Issue issue;
        issue.path = dir;
        issue.id = package.id;
        issue.reason = "entryMissing";
        issue.message = "entry module \"" + package.manifest.entry + "\" not found";
        log::warning("core", "scripts.invalidManifest", "script entry module missing",
                     log::extras({{"path", to_utf8(dir)}, {"entry", package.manifest.entry}}));
        catalog.add_issue(std::move(issue));
        return;
    }
    if (!package.manifest.icon.empty() && !is_file(dir / from_utf8(package.manifest.icon))) {
        package.warnings.push_back("iconMissing: icon \"" + package.manifest.icon + "\" not found");
        package.manifest.icon.clear();
    }
    for (const std::string& w : package.warnings) {
        Issue issue;
        issue.path = dir;
        issue.id = package.id;
        const auto colon = w.find(':');
        issue.reason = colon == std::string::npos ? w : w.substr(0, colon);
        issue.message = colon == std::string::npos ? "" : trim(w.substr(colon + 1));
        issue.severity = "warning";
        catalog.add_issue(std::move(issue));
    }
    catalog.add_package(std::move(package));
}

void load_root(const fs::path& root, resources::LayerName layer, Catalog& catalog) {
    for (const fs::directory_entry& entry : sorted_entries(root)) {
        if (!is_dir(entry.path())) {
            continue;  // group icons and stray files are ignored
        }
        if (is_file(entry.path() / "script.json")) {
            load_package(entry.path(), "", layer, catalog);
            continue;
        }
        Group group;
        group.id = to_utf8(entry.path().filename());
        std::optional<int> order;
        const std::string stripped = strip_order_prefix(group.id, &order);
        group.order = order.value_or(kUnnumberedOrder);
        group.names["en"] = stripped;
        group.dir = entry.path();
        load_group_json(entry.path(), group, catalog);
        const std::string group_id = group.id;
        catalog.add_group(std::move(group));
        for (const fs::directory_entry& sub : sorted_entries(entry.path())) {
            if (!is_dir(sub.path())) {
                continue;
            }
            if (!is_file(sub.path() / "script.json")) {
                Issue issue;
                issue.path = sub.path();
                issue.reason = "missingManifest";
                issue.severity = "warning";
                issue.message = "script folder without script.json ignored";
                log::warning("core", "scripts.invalidManifest",
                             "script folder without script.json ignored",
                             log::extras({{"path", to_utf8(sub.path())}}));
                catalog.add_issue(std::move(issue));
                continue;
            }
            load_package(sub.path(), group_id, layer, catalog);
        }
    }
}

const char* folder_key(resources::LayerName layer) {
    switch (layer) {
        case resources::LayerName::bundled:
            return "bundled";
        case resources::LayerName::user:
            return "user";
        case resources::LayerName::settings:
            return "custom";
        case resources::LayerName::portable:
            return "portable";
    }
    return "bundled";
}

}  // namespace

Catalog load_catalog(const resources::ResourceLayers& layers) {
    Catalog catalog;
    const auto all = layers.layers(resources::Kind::scripts);
    std::vector<const resources::Layer*> order;
    for (const auto& l : all) {
        if (l.layer == resources::LayerName::bundled) {
            order.push_back(&l);
        }
    }
    for (const auto& l : all) {
        if (l.layer != resources::LayerName::bundled) {
            order.push_back(&l);
        }
    }
    for (const resources::Layer* layer : order) {
        if (layer->path.empty()) {
            continue;
        }
        // The user folder is always reported (it is where "Open scripts folder" leads).
        if (layer->exists || layer->layer == resources::LayerName::user) {
            catalog.set_folder(folder_key(layer->layer), layer->path);
        }
        if (!layer->exists) {
            continue;
        }
        load_root(layer->path, layer->layer, catalog);
    }
    // Groups that ended up empty (only invalid packages) would show as empty sub-menus.
    catalog.prune_empty_groups();
    catalog.sort();
    return catalog;
}

}  // namespace mfbe::scripts
