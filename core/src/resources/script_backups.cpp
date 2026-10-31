// Script backups (feature 007, T116). See script_backups.h.
#include "resources/script_backups.h"

#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/utf8_paths.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <ctime>
#include <system_error>

namespace mfbe::scripts::backups {
namespace {

namespace fs = std::filesystem;
using nlohmann::json;

constexpr const char* kFolder = "script-backups";
constexpr const char* kMetaFile = "backup.json";
constexpr const char* kPartialSuffix = ".partial";
constexpr std::size_t kStampLength = 16;  // yyyymmddThhmmssZ

std::tm utc_of(std::chrono::system_clock::time_point at) {
    const std::time_t t = std::chrono::system_clock::to_time_t(at);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    return tm;
}

std::string iso_of(std::chrono::system_clock::time_point at) {
    const std::tm tm = utc_of(at);
    char buf[80];
    std::snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ", tm.tm_year + 1900,
                  tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec);
    return buf;
}

// The `-N` of a backup id (0 without one); the id is valid.
long suffix_of(const std::string& backup_id) {
    return backup_id.size() > kStampLength ? std::stol(backup_id.substr(kStampLength + 1)) : 0;
}

// Newest first: the later second, then the higher suffix within one second.
bool newer(const Backup& a, const Backup& b) {
    const std::string sa = a.backup_id.substr(0, kStampLength);
    const std::string sb = b.backup_id.substr(0, kStampLength);
    if (sa != sb) {
        return sa > sb;
    }
    return suffix_of(a.backup_id) > suffix_of(b.backup_id);
}

bool is_present(const fs::path& p) {
    std::error_code ec;
    return fs::exists(fs::symlink_status(p, ec));
}

// The backup in `dir` when its backup.json names `id`.
std::optional<Backup> read_backup(const fs::path& dir, const std::string& id) {
    const std::string backup_id = platform::utf8_from_path(dir.filename());
    if (!is_valid_backup_id(backup_id)) {
        return std::nullopt;
    }
    std::error_code ec;
    if (!fs::is_directory(fs::symlink_status(dir, ec))) {
        return std::nullopt;
    }
    json meta;
    try {
        meta = json::parse(atomic_file::read_file(dir / kMetaFile));
    } catch (const std::exception&) {
        return std::nullopt;
    }
    if (!meta.is_object() || meta.value("id", "") != id) {
        return std::nullopt;
    }
    Backup backup;
    backup.id = id;
    backup.backup_id = backup_id;
    backup.origin = meta.value("origin", "");
    backup.source_dir = meta.value("sourceDir", "");
    backup.created_at = meta.value("createdAt", "");
    backup.reason = meta.value("reason", "");
    backup.dir = dir;
    return backup;
}

}  // namespace

fs::path root(const fs::path& data_dir) {
    return data_dir / kFolder;
}

fs::path folder_of(const fs::path& data_dir, const std::string& id) {
    return root(data_dir) / platform::path_from_utf8(url_encode_segment(id));
}

std::string stamp_of(std::chrono::system_clock::time_point at) {
    const std::tm tm = utc_of(at);
    char buf[80];
    std::snprintf(buf, sizeof(buf), "%04d%02d%02dT%02d%02d%02dZ", tm.tm_year + 1900, tm.tm_mon + 1,
                  tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec);
    return buf;
}

bool is_valid_backup_id(std::string_view backup_id) {
    if (backup_id.size() < kStampLength) {
        return false;
    }
    for (std::size_t i = 0; i < kStampLength; ++i) {
        const char c = backup_id[i];
        const bool ok = i == 8    ? c == 'T'
                        : i == 15 ? c == 'Z'
                                  : std::isdigit(static_cast<unsigned char>(c)) != 0;
        if (!ok) {
            return false;
        }
    }
    if (backup_id.size() == kStampLength) {
        return true;
    }
    const std::string_view suffix = backup_id.substr(kStampLength);
    if (suffix.size() < 2 || suffix.size() > 7 || suffix[0] != '-' || suffix[1] == '0') {
        return false;
    }
    return std::all_of(suffix.begin() + 1, suffix.end(),
                       [](char c) { return std::isdigit(static_cast<unsigned char>(c)) != 0; });
}

Backup create(const fs::path& data_dir, const ScriptPackage& package, const std::string& reason,
              std::chrono::system_clock::time_point at) {
    const fs::path folder = folder_of(data_dir, package.id);
    std::error_code ec;
    fs::create_directories(folder, ec);
    if (ec) {
        throw WriteFailure(platform::utf8_from_path(folder), platform::utf8_error_message(ec));
    }
    // The first free name of this second.
    const std::string stamp = stamp_of(at);
    std::string backup_id = stamp;
    for (int n = 1; is_present(folder / platform::path_from_utf8(backup_id)); ++n) {
        backup_id = stamp + "-" + std::to_string(n);
    }
    const fs::path partial = folder / platform::path_from_utf8(backup_id + kPartialSuffix);
    const auto fail = [&](const fs::path& path, const std::string& why) {
        std::error_code ignored;
        fs::remove_all(partial, ignored);
        throw WriteFailure(platform::utf8_from_path(path), why);
    };
    fs::remove_all(partial, ec);  // a leftover of an interrupted backup
    ec.clear();
    fs::create_directories(partial, ec);
    if (ec) {
        fail(partial, platform::utf8_error_message(ec));
    }
    // The script's files as they are (a package's own top-level backup.json would give way to
    // the record - no package ships one).
    for (fs::recursive_directory_iterator it(package.dir, ec), end; !ec && it != end;
         it.increment(ec)) {
        std::error_code file_ec;
        if (!it->is_regular_file(file_ec)) {
            continue;
        }
        const fs::path relative = fs::relative(it->path(), package.dir, file_ec);
        const fs::path target = partial / relative;
        fs::create_directories(target.parent_path(), file_ec);
        if (!file_ec) {
            fs::copy_file(it->path(), target, fs::copy_options::overwrite_existing, file_ec);
        }
        if (file_ec) {
            fail(it->path(), platform::utf8_error_message(file_ec));
        }
    }
    if (ec) {
        fail(package.dir, platform::utf8_error_message(ec));
    }
    Backup backup;
    backup.id = package.id;
    backup.backup_id = backup_id;
    backup.origin = origin_of(package);
    backup.source_dir = platform::utf8_from_path(package.dir);
    backup.created_at = iso_of(at);
    backup.reason = reason;
    const json meta{{"id", backup.id},
                    {"origin", backup.origin},
                    {"sourceDir", backup.source_dir},
                    {"createdAt", backup.created_at},
                    {"reason", backup.reason}};
    try {
        atomic_file::write_atomic(partial / kMetaFile, meta.dump(2) + "\n");
    } catch (const atomic_file::WriteError& e) {
        fail(partial / kMetaFile, e.reason);
    }
    backup.dir = folder / platform::path_from_utf8(backup_id);
    fs::rename(partial, backup.dir, ec);
    if (ec) {
        fail(backup.dir, platform::utf8_error_message(ec));
    }
    return backup;
}

std::vector<Backup> list(const fs::path& data_dir, const std::string& id) {
    std::vector<Backup> backups;
    std::error_code ec;
    for (fs::directory_iterator it(folder_of(data_dir, id), ec), end; !ec && it != end;
         it.increment(ec)) {
        if (auto backup = read_backup(it->path(), id)) {
            backups.push_back(std::move(*backup));
        }
    }
    std::sort(backups.begin(), backups.end(), newer);
    return backups;
}

std::optional<Backup> find(const fs::path& data_dir, const std::string& id,
                           const std::string& backup_id) {
    if (!is_valid_backup_id(backup_id)) {
        return std::nullopt;
    }
    return read_backup(folder_of(data_dir, id) / platform::path_from_utf8(backup_id), id);
}

std::vector<PackageFile> files_of(const Backup& backup) {
    std::vector<PackageFile> files;
    std::error_code ec;
    for (fs::recursive_directory_iterator it(backup.dir, ec), end; !ec && it != end;
         it.increment(ec)) {
        std::error_code file_ec;
        if (!it->is_regular_file(file_ec)) {
            continue;
        }
        const std::string path =
            platform::utf8_from_path_generic(fs::relative(it->path(), backup.dir, file_ec));
        if (path == kMetaFile) {
            continue;
        }
        PackageFile file;
        file.path = path;
        try {
            file.content = atomic_file::read_file(it->path());
        } catch (const atomic_file::WriteError& e) {
            throw WriteFailure(e.path, e.reason);
        }
        files.push_back(std::move(file));
    }
    if (ec) {
        throw WriteFailure(platform::utf8_from_path(backup.dir), platform::utf8_error_message(ec));
    }
    std::sort(files.begin(), files.end(),
              [](const PackageFile& a, const PackageFile& b) { return a.path < b.path; });
    return files;
}

void remove(const Backup& backup) {
    std::error_code ec;
    fs::remove_all(backup.dir, ec);
    if (ec) {
        log::warning("core", "scripts.backupRemoveFailed", "cannot remove a backup",
                     log::extras({{"path", platform::utf8_from_path(backup.dir)},
                                  {"reason", platform::utf8_error_message(ec)}}));
    }
}

}  // namespace mfbe::scripts::backups
