#include <mfbe/maxima_lookup_token_store.hpp>

#include <mfbe/atomic_file.hpp>
#include <mfbe/base64.hpp>
#include <mfbe/log.hpp>
#include <mfbe/store_lock.hpp>
#include <mfbe/utf8_paths.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cerrno>
#include <cstring>

#ifndef _WIN32
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace mfbe::lookup {

namespace {

using nlohmann::json;

constexpr const char* kTokenFileName = "maxima-lookup-token.json";
constexpr const char* kKeyFileName = "maxima-lookup.key";
constexpr const char* kSchemeName = "aes256gcm-keyfile";
constexpr int kRecordVersion = 1;

bool restrict_file_owner_only(const std::filesystem::path& path) {
#ifdef _WIN32
    (void)path;
    return true;
#else
    return ::chmod(path.c_str(), S_IRUSR | S_IWUSR) == 0;
#endif
}

bool write_owner_only_atomic(const std::filesystem::path& target, std::string_view bytes) {
    std::error_code ec;
    std::filesystem::create_directories(target.parent_path(), ec);
#ifndef _WIN32
    // Write to a 0600 temporary file before rename so neither key nor token file is ever briefly
    // group/world-readable on POSIX.
    const std::filesystem::path tmp =
        target.parent_path() / (platform::path_from_utf8(
                                    platform::utf8_from_path(target.filename()) + ".tmp"));
    int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC, S_IRUSR | S_IWUSR);
    if (fd < 0) {
        return false;
    }
    (void)::fchmod(fd, S_IRUSR | S_IWUSR);
    const char* ptr = bytes.data();
    std::size_t remaining = bytes.size();
    while (remaining > 0) {
        const ssize_t n = ::write(fd, ptr, remaining);
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            ::close(fd);
            ::unlink(tmp.c_str());
            return false;
        }
        ptr += n;
        remaining -= static_cast<std::size_t>(n);
    }
    if (::fsync(fd) != 0) {
        ::close(fd);
        ::unlink(tmp.c_str());
        return false;
    }
    if (::close(fd) != 0) {
        ::unlink(tmp.c_str());
        return false;
    }
    if (::rename(tmp.c_str(), target.c_str()) != 0) {
        ::unlink(tmp.c_str());
        return false;
    }
    return true;
#else
    try {
        atomic_file::write_atomic(target, bytes);
        return true;
    } catch (const atomic_file::WriteError&) {
        return false;
    }
#endif
}

bool read_key_file(const std::filesystem::path& key_path,
                   std::array<std::uint8_t, kLookupAesKeyBytes>& key_out) {
    try {
        const std::string raw = atomic_file::read_file(key_path);
        if (raw.size() != kLookupAesKeyBytes) {
            return false;
        }
        std::memcpy(key_out.data(), raw.data(), kLookupAesKeyBytes);
        return true;
    } catch (const atomic_file::WriteError&) {
        return false;
    }
}

bool load_or_create_key(const std::filesystem::path& key_path,
                        std::array<std::uint8_t, kLookupAesKeyBytes>& key_out) {
    std::error_code ec;
    if (std::filesystem::exists(key_path, ec)) {
        if (read_key_file(key_path, key_out)) {
            (void)restrict_file_owner_only(key_path);
            return true;
        }
        // Existing keyfile is corrupt/wrong length: generate a fresh key before writing the new
        // token so re-saving a valid token in Settings always recovers cleanly.
    }

    if (!aes256_gcm_random_bytes(key_out.data(), key_out.size())) {
        return false;
    }
    std::filesystem::create_directories(key_path.parent_path(), ec);

#ifndef _WIN32
    if (!std::filesystem::exists(key_path, ec)) {
        int fd = ::open(key_path.c_str(), O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR);
        if (fd >= 0) {
            const char* ptr = reinterpret_cast<const char*>(key_out.data());
            std::size_t rem = key_out.size();
            bool ok = true;
            while (rem > 0) {
                const ssize_t n = ::write(fd, ptr, rem);
                if (n < 0) {
                    if (errno == EINTR) {
                        continue;
                    }
                    ok = false;
                    break;
                }
                ptr += n;
                rem -= static_cast<std::size_t>(n);
            }
            if (ok && ::fsync(fd) != 0) {
                ok = false;
            }
            if (::close(fd) != 0) {
                ok = false;
            }
            if (ok) {
                return true;
            }
            ::unlink(key_path.c_str());
            return false;
        }
        if (errno == EEXIST) {
            return read_key_file(key_path, key_out);
        }
        return false;
    }
#endif
    return write_owner_only_atomic(
        key_path, std::string_view(reinterpret_cast<const char*>(key_out.data()), key_out.size()));
}

}  // namespace

MaximaLookupTokenStore::MaximaLookupTokenStore(std::filesystem::path data_dir)
    : data_dir_(std::move(data_dir)) {}

std::filesystem::path MaximaLookupTokenStore::token_file_path() const {
    return data_dir_ / kTokenFileName;
}

std::filesystem::path MaximaLookupTokenStore::key_file_path() const {
    return data_dir_ / kKeyFileName;
}

MaximaLookupTokenReadResult MaximaLookupTokenStore::load() const {
    MaximaLookupTokenReadResult result;
    const std::filesystem::path token_path = token_file_path();
    std::error_code ec;
    if (!std::filesystem::exists(token_path, ec)) {
        result.state = MaximaLookupTokenReadState::absent;
        return result;
    }

    result.state = MaximaLookupTokenReadState::unreadable;
    std::array<std::uint8_t, kLookupAesKeyBytes> key{};
    if (!read_key_file(key_file_path(), key)) {
        return result;
    }

    std::string raw;
    try {
        raw = atomic_file::read_file(token_path);
    } catch (const atomic_file::WriteError&) {
        return result;
    }

    json parsed = json::parse(raw, nullptr, false);
    if (!parsed.is_object()) {
        return result;
    }
    if (parsed.value("version", 0) != kRecordVersion ||
        parsed.value("scheme", std::string{}) != kSchemeName) {
        return result;
    }
    if (!parsed.contains("iv") || !parsed["iv"].is_string() || !parsed.contains("tag") ||
        !parsed["tag"].is_string() || !parsed.contains("ciphertext") ||
        !parsed["ciphertext"].is_string()) {
        return result;
    }

    const auto iv_dec = base64::decode(parsed["iv"].get<std::string>());
    const auto tag_dec = base64::decode(parsed["tag"].get<std::string>());
    const auto ct_dec = base64::decode(parsed["ciphertext"].get<std::string>());
    if (!iv_dec || iv_dec->size() != kLookupAesIvBytes || !tag_dec ||
        tag_dec->size() != kLookupAesTagBytes || !ct_dec) {
        return result;
    }

    std::array<std::uint8_t, kLookupAesIvBytes> iv{};
    std::array<std::uint8_t, kLookupAesTagBytes> tag{};
    std::memcpy(iv.data(), iv_dec->data(), kLookupAesIvBytes);
    std::memcpy(tag.data(), tag_dec->data(), kLookupAesTagBytes);

    std::string plaintext;
    if (!aes256_gcm_decrypt(key, iv, kLookupTokenAad, *ct_dec, tag, plaintext)) {
        return result;
    }

    result.state = MaximaLookupTokenReadState::ok;
    result.token = std::move(plaintext);
    return result;
}

bool MaximaLookupTokenStore::save(std::string_view plaintext_token) const {
    try {
        std::error_code ec;
        std::filesystem::create_directories(data_dir_, ec);
        store_lock::StoreLock lock(token_file_path());

        std::array<std::uint8_t, kLookupAesKeyBytes> key{};
        if (!load_or_create_key(key_file_path(), key)) {
            log::error("core", "maximaLookup.tokenWriteFailed",
                       "failed to prepare encryption key for Maxima Library token");
            return false;
        }

        std::array<std::uint8_t, kLookupAesIvBytes> iv{};
        if (!aes256_gcm_random_bytes(iv.data(), iv.size())) {
            log::error("core", "maximaLookup.tokenWriteFailed",
                       "failed to generate IV for Maxima Library token");
            return false;
        }

        std::string ciphertext;
        std::array<std::uint8_t, kLookupAesTagBytes> tag{};
        if (!aes256_gcm_encrypt(key, iv, kLookupTokenAad, plaintext_token, ciphertext, tag)) {
            log::error("core", "maximaLookup.tokenWriteFailed",
                       "failed to encrypt Maxima Library token");
            return false;
        }

        json record{
            {"version", kRecordVersion},
            {"scheme", kSchemeName},
            {"iv", base64::encode(
                       std::string_view(reinterpret_cast<const char*>(iv.data()), iv.size()))},
            {"tag", base64::encode(
                        std::string_view(reinterpret_cast<const char*>(tag.data()), tag.size()))},
            {"ciphertext", base64::encode(ciphertext)},
        };
        if (!write_owner_only_atomic(token_file_path(), record.dump(2) + "\n")) {
            log::error("core", "maximaLookup.tokenWriteFailed",
                       "failed to write encrypted Maxima Library token file");
            return false;
        }
        return true;
    } catch (const std::exception&) {
        log::error("core", "maximaLookup.tokenWriteFailed",
                   "unexpected error saving encrypted Maxima Library token");
        return false;
    }
}

bool MaximaLookupTokenStore::remove() const {
    std::error_code ec;
    const std::filesystem::path token_path = token_file_path();
    if (!std::filesystem::exists(token_path, ec)) {
        return true;
    }
    return std::filesystem::remove(token_path, ec);
}

}  // namespace mfbe::lookup
