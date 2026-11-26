#include <mfbe/maxima_lookup_token_store.hpp>

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <bcrypt.h>
#include <limits>
#include <vector>
#include <windows.h>

namespace mfbe::lookup {

namespace {

struct AlgHandleGuard {
    BCRYPT_ALG_HANDLE handle = nullptr;
    ~AlgHandleGuard() {
        if (handle != nullptr) {
            BCryptCloseAlgorithmProvider(handle, 0);
        }
    }
};

struct KeyHandleGuard {
    BCRYPT_KEY_HANDLE handle = nullptr;
    ~KeyHandleGuard() {
        if (handle != nullptr) {
            BCryptDestroyKey(handle);
        }
    }
};

bool open_aes_gcm_key(const std::array<std::uint8_t, kLookupAesKeyBytes>& key, AlgHandleGuard& alg,
                      KeyHandleGuard& hkey, std::vector<UCHAR>& key_object) {
    if (!BCRYPT_SUCCESS(
            BCryptOpenAlgorithmProvider(&alg.handle, BCRYPT_AES_ALGORITHM, nullptr, 0))) {
        return false;
    }
    if (!BCRYPT_SUCCESS(
            BCryptSetProperty(alg.handle, BCRYPT_CHAINING_MODE,
                              reinterpret_cast<PUCHAR>(const_cast<wchar_t*>(BCRYPT_CHAIN_MODE_GCM)),
                              static_cast<ULONG>(sizeof(BCRYPT_CHAIN_MODE_GCM)), 0))) {
        return false;
    }
    DWORD obj_len = 0;
    DWORD cb_data = 0;
    if (!BCRYPT_SUCCESS(BCryptGetProperty(alg.handle, BCRYPT_OBJECT_LENGTH,
                                          reinterpret_cast<PUCHAR>(&obj_len), sizeof(obj_len),
                                          &cb_data, 0)) ||
        obj_len == 0) {
        return false;
    }
    key_object.resize(obj_len);
    std::array<std::uint8_t, kLookupAesKeyBytes> key_copy = key;
    if (!BCRYPT_SUCCESS(BCryptGenerateSymmetricKey(alg.handle, &hkey.handle, key_object.data(),
                                                   obj_len, key_copy.data(),
                                                   static_cast<ULONG>(key_copy.size()), 0))) {
        return false;
    }
    return true;
}

}  // namespace

bool aes256_gcm_random_bytes(std::uint8_t* out, std::size_t len) {
    if (len == 0) {
        return true;
    }
    if (out == nullptr || len > static_cast<std::size_t>(std::numeric_limits<ULONG>::max())) {
        return false;
    }
    return BCRYPT_SUCCESS(
        BCryptGenRandom(nullptr, out, static_cast<ULONG>(len), BCRYPT_USE_SYSTEM_PREFERRED_RNG));
}

bool aes256_gcm_encrypt(const std::array<std::uint8_t, kLookupAesKeyBytes>& key,
                        const std::array<std::uint8_t, kLookupAesIvBytes>& iv, std::string_view aad,
                        std::string_view plaintext, std::string& ciphertext_out,
                        std::array<std::uint8_t, kLookupAesTagBytes>& tag_out) {
    ciphertext_out.clear();
    if (plaintext.size() > static_cast<std::size_t>(std::numeric_limits<ULONG>::max()) ||
        aad.size() > static_cast<std::size_t>(std::numeric_limits<ULONG>::max())) {
        return false;
    }

    AlgHandleGuard alg;
    KeyHandleGuard hkey;
    std::vector<UCHAR> key_object;
    if (!open_aes_gcm_key(key, alg, hkey, key_object)) {
        return false;
    }

    std::array<std::uint8_t, kLookupAesIvBytes> iv_copy = iv;
    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO auth_info;
    BCRYPT_INIT_AUTH_MODE_INFO(auth_info);
    auth_info.pbNonce = iv_copy.data();
    auth_info.cbNonce = static_cast<ULONG>(iv_copy.size());
    auth_info.pbAuthData =
        aad.empty() ? nullptr : reinterpret_cast<PUCHAR>(const_cast<char*>(aad.data()));
    auth_info.cbAuthData = static_cast<ULONG>(aad.size());
    auth_info.pbTag = tag_out.data();
    auth_info.cbTag = static_cast<ULONG>(tag_out.size());

    std::string ct(plaintext.size(), '\0');
    UCHAR dummy = 0;
    PUCHAR in_ptr =
        plaintext.empty() ? &dummy : reinterpret_cast<PUCHAR>(const_cast<char*>(plaintext.data()));
    PUCHAR out_ptr = ct.empty() ? &dummy : reinterpret_cast<PUCHAR>(ct.data());
    ULONG cb_result = 0;
    const NTSTATUS status =
        BCryptEncrypt(hkey.handle, in_ptr, static_cast<ULONG>(plaintext.size()), &auth_info,
                      nullptr, 0, out_ptr, static_cast<ULONG>(ct.size()), &cb_result, 0);
    if (!BCRYPT_SUCCESS(status)) {
        return false;
    }
    ct.resize(cb_result);
    ciphertext_out = std::move(ct);
    return true;
}

bool aes256_gcm_decrypt(const std::array<std::uint8_t, kLookupAesKeyBytes>& key,
                        const std::array<std::uint8_t, kLookupAesIvBytes>& iv, std::string_view aad,
                        std::string_view ciphertext,
                        const std::array<std::uint8_t, kLookupAesTagBytes>& tag,
                        std::string& plaintext_out) {
    plaintext_out.clear();
    if (ciphertext.size() > static_cast<std::size_t>(std::numeric_limits<ULONG>::max()) ||
        aad.size() > static_cast<std::size_t>(std::numeric_limits<ULONG>::max())) {
        return false;
    }

    AlgHandleGuard alg;
    KeyHandleGuard hkey;
    std::vector<UCHAR> key_object;
    if (!open_aes_gcm_key(key, alg, hkey, key_object)) {
        return false;
    }

    std::array<std::uint8_t, kLookupAesIvBytes> iv_copy = iv;
    std::array<std::uint8_t, kLookupAesTagBytes> tag_copy = tag;
    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO auth_info;
    BCRYPT_INIT_AUTH_MODE_INFO(auth_info);
    auth_info.pbNonce = iv_copy.data();
    auth_info.cbNonce = static_cast<ULONG>(iv_copy.size());
    auth_info.pbAuthData =
        aad.empty() ? nullptr : reinterpret_cast<PUCHAR>(const_cast<char*>(aad.data()));
    auth_info.cbAuthData = static_cast<ULONG>(aad.size());
    auth_info.pbTag = tag_copy.data();
    auth_info.cbTag = static_cast<ULONG>(tag_copy.size());

    std::string pt(ciphertext.size(), '\0');
    UCHAR dummy = 0;
    PUCHAR in_ptr = ciphertext.empty()
                        ? &dummy
                        : reinterpret_cast<PUCHAR>(const_cast<char*>(ciphertext.data()));
    PUCHAR out_ptr = pt.empty() ? &dummy : reinterpret_cast<PUCHAR>(pt.data());
    ULONG cb_result = 0;
    const NTSTATUS status =
        BCryptDecrypt(hkey.handle, in_ptr, static_cast<ULONG>(ciphertext.size()), &auth_info,
                      nullptr, 0, out_ptr, static_cast<ULONG>(pt.size()), &cb_result, 0);
    if (!BCRYPT_SUCCESS(status)) {
        return false;
    }
    pt.resize(cb_result);
    plaintext_out = std::move(pt);
    return true;
}

}  // namespace mfbe::lookup
