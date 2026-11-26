#include <mfbe/maxima_lookup_token_store.hpp>

#include <limits>
#include <memory>
#include <openssl/evp.h>
#include <openssl/rand.h>

namespace mfbe::lookup {

namespace {

struct EvpCipherCtxDeleter {
    void operator()(EVP_CIPHER_CTX* ctx) const noexcept { EVP_CIPHER_CTX_free(ctx); }
};
using EvpCipherCtxPtr = std::unique_ptr<EVP_CIPHER_CTX, EvpCipherCtxDeleter>;

}  // namespace

bool aes256_gcm_random_bytes(std::uint8_t* out, std::size_t len) {
    if (len == 0) {
        return true;
    }
    if (out == nullptr || len > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return false;
    }
    return RAND_bytes(out, static_cast<int>(len)) == 1;
}

bool aes256_gcm_encrypt(const std::array<std::uint8_t, kLookupAesKeyBytes>& key,
                        const std::array<std::uint8_t, kLookupAesIvBytes>& iv, std::string_view aad,
                        std::string_view plaintext, std::string& ciphertext_out,
                        std::array<std::uint8_t, kLookupAesTagBytes>& tag_out) {
    ciphertext_out.clear();
    if (plaintext.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()) ||
        aad.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return false;
    }

    EvpCipherCtxPtr ctx(EVP_CIPHER_CTX_new());
    if (!ctx) {
        return false;
    }
    if (EVP_EncryptInit_ex(ctx.get(), EVP_aes_256_gcm(), nullptr, nullptr, nullptr) != 1) {
        return false;
    }
    if (EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(iv.size()),
                            nullptr) != 1) {
        return false;
    }
    if (EVP_EncryptInit_ex(ctx.get(), nullptr, nullptr, key.data(), iv.data()) != 1) {
        return false;
    }

    int len = 0;
    if (!aad.empty()) {
        if (EVP_EncryptUpdate(ctx.get(), nullptr, &len,
                              reinterpret_cast<const unsigned char*>(aad.data()),
                              static_cast<int>(aad.size())) != 1) {
            return false;
        }
    }

    std::string ct(plaintext.size(), '\0');
    int ct_len = 0;
    if (!plaintext.empty()) {
        if (EVP_EncryptUpdate(ctx.get(), reinterpret_cast<unsigned char*>(ct.data()), &ct_len,
                              reinterpret_cast<const unsigned char*>(plaintext.data()),
                              static_cast<int>(plaintext.size())) != 1) {
            return false;
        }
    }

    int final_len = 0;
    if (EVP_EncryptFinal_ex(ctx.get(), reinterpret_cast<unsigned char*>(ct.data()) + ct_len,
                            &final_len) != 1) {
        return false;
    }
    ct.resize(static_cast<std::size_t>(ct_len + final_len));

    if (EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_GET_TAG, static_cast<int>(tag_out.size()),
                            tag_out.data()) != 1) {
        return false;
    }

    ciphertext_out = std::move(ct);
    return true;
}

bool aes256_gcm_decrypt(const std::array<std::uint8_t, kLookupAesKeyBytes>& key,
                        const std::array<std::uint8_t, kLookupAesIvBytes>& iv, std::string_view aad,
                        std::string_view ciphertext,
                        const std::array<std::uint8_t, kLookupAesTagBytes>& tag,
                        std::string& plaintext_out) {
    plaintext_out.clear();
    if (ciphertext.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()) ||
        aad.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return false;
    }

    EvpCipherCtxPtr ctx(EVP_CIPHER_CTX_new());
    if (!ctx) {
        return false;
    }
    if (EVP_DecryptInit_ex(ctx.get(), EVP_aes_256_gcm(), nullptr, nullptr, nullptr) != 1) {
        return false;
    }
    if (EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(iv.size()),
                            nullptr) != 1) {
        return false;
    }
    if (EVP_DecryptInit_ex(ctx.get(), nullptr, nullptr, key.data(), iv.data()) != 1) {
        return false;
    }

    int len = 0;
    if (!aad.empty()) {
        if (EVP_DecryptUpdate(ctx.get(), nullptr, &len,
                              reinterpret_cast<const unsigned char*>(aad.data()),
                              static_cast<int>(aad.size())) != 1) {
            return false;
        }
    }

    std::string pt(ciphertext.size(), '\0');
    int pt_len = 0;
    if (!ciphertext.empty()) {
        if (EVP_DecryptUpdate(ctx.get(), reinterpret_cast<unsigned char*>(pt.data()), &pt_len,
                              reinterpret_cast<const unsigned char*>(ciphertext.data()),
                              static_cast<int>(ciphertext.size())) != 1) {
            return false;
        }
    }

    // OpenSSL requires setting the expected GCM tag before EVP_DecryptFinal_ex.
    std::array<std::uint8_t, kLookupAesTagBytes> expected_tag = tag;
    if (EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_SET_TAG, static_cast<int>(expected_tag.size()),
                            expected_tag.data()) != 1) {
        return false;
    }

    int final_len = 0;
    if (EVP_DecryptFinal_ex(ctx.get(), reinterpret_cast<unsigned char*>(pt.data()) + pt_len,
                            &final_len) != 1) {
        return false;
    }
    pt.resize(static_cast<std::size_t>(pt_len + final_len));
    plaintext_out = std::move(pt);
    return true;
}

}  // namespace mfbe::lookup
