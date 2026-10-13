// Base64 encoder / streaming decoder. See mfbe/base64.hpp.
#include <mfbe/base64.hpp>

#include <array>

namespace mfbe::base64 {
namespace {

constexpr char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

constexpr std::array<signed char, 256> make_reverse() {
    std::array<signed char, 256> table{};
    for (auto& v : table) {
        v = -1;
    }
    for (int i = 0; i < 64; ++i) {
        table[static_cast<unsigned char>(kAlphabet[i])] = static_cast<signed char>(i);
    }
    // Whitespace: -2 (skipped); padding: -3.
    table[static_cast<unsigned char>(' ')] = -2;
    table[static_cast<unsigned char>('\n')] = -2;
    table[static_cast<unsigned char>('\r')] = -2;
    table[static_cast<unsigned char>('\t')] = -2;
    table[static_cast<unsigned char>('\f')] = -2;
    table[static_cast<unsigned char>('\v')] = -2;
    table[static_cast<unsigned char>('=')] = -3;
    return table;
}

constexpr std::array<signed char, 256> kReverse = make_reverse();

}  // namespace

std::string encode(std::string_view bytes) {
    std::string out;
    out.reserve((bytes.size() + 2) / 3 * 4);
    std::size_t i = 0;
    while (i + 2 < bytes.size()) {
        const unsigned v = (static_cast<unsigned char>(bytes[i]) << 16) |
                           (static_cast<unsigned char>(bytes[i + 1]) << 8) |
                           static_cast<unsigned char>(bytes[i + 2]);
        out.push_back(kAlphabet[(v >> 18) & 0x3F]);
        out.push_back(kAlphabet[(v >> 12) & 0x3F]);
        out.push_back(kAlphabet[(v >> 6) & 0x3F]);
        out.push_back(kAlphabet[v & 0x3F]);
        i += 3;
    }
    if (i + 1 == bytes.size()) {
        const unsigned v = static_cast<unsigned char>(bytes[i]) << 16;
        out.push_back(kAlphabet[(v >> 18) & 0x3F]);
        out.push_back(kAlphabet[(v >> 12) & 0x3F]);
        out += "==";
    } else if (i + 2 == bytes.size()) {
        const unsigned v = (static_cast<unsigned char>(bytes[i]) << 16) |
                           (static_cast<unsigned char>(bytes[i + 1]) << 8);
        out.push_back(kAlphabet[(v >> 18) & 0x3F]);
        out.push_back(kAlphabet[(v >> 12) & 0x3F]);
        out.push_back(kAlphabet[(v >> 6) & 0x3F]);
        out.push_back('=');
    }
    return out;
}

std::string encode_wrapped(std::string_view bytes, std::size_t columns, std::string_view newline) {
    const std::string flat = encode(bytes);
    if (columns == 0 || flat.size() <= columns) {
        return flat;
    }
    std::string out;
    out.reserve(flat.size() + (flat.size() / columns + 1) * newline.size());
    for (std::size_t pos = 0; pos < flat.size(); pos += columns) {
        if (pos != 0) {
            out += newline;
        }
        out.append(flat, pos, columns);
    }
    return out;
}

std::optional<std::string> decode(std::string_view text) {
    Decoder decoder;
    if (!decoder.feed(text) || !decoder.finish()) {
        return std::nullopt;
    }
    return decoder.take();
}

bool Decoder::feed(std::string_view chunk) {
    if (failed_) {
        return false;
    }
    out_.reserve(out_.size() + chunk.size() / 4 * 3);
    for (const char ch : chunk) {
        const signed char v = kReverse[static_cast<unsigned char>(ch)];
        if (v == -2) {
            continue;  // whitespace
        }
        if (v == -3) {
            // Padding is only valid after 2 or 3 characters of the final group.
            if (bits_ == 12 || bits_ == 18) {
                ++padding_;
                if (bits_ == 12 && padding_ > 2) {
                    failed_ = true;
                    return false;
                }
                if (bits_ == 18 && padding_ > 1) {
                    failed_ = true;
                    return false;
                }
                continue;
            }
            failed_ = true;
            return false;
        }
        if (v < 0 || padding_ > 0) {
            failed_ = true;  // invalid character, or data after padding
            return false;
        }
        acc_ = (acc_ << 6) | static_cast<unsigned>(v);
        bits_ += 6;
        if (bits_ == 24) {
            out_.push_back(static_cast<char>((acc_ >> 16) & 0xFF));
            out_.push_back(static_cast<char>((acc_ >> 8) & 0xFF));
            out_.push_back(static_cast<char>(acc_ & 0xFF));
            acc_ = 0;
            bits_ = 0;
            padding_ = 0;
        }
    }
    return true;
}

bool Decoder::finish() {
    if (failed_) {
        return false;
    }
    if (bits_ == 6) {
        failed_ = true;  // a single dangling character cannot encode a byte
        return false;
    }
    if (bits_ == 12) {
        out_.push_back(static_cast<char>((acc_ >> 4) & 0xFF));
    } else if (bits_ == 18) {
        out_.push_back(static_cast<char>((acc_ >> 10) & 0xFF));
        out_.push_back(static_cast<char>((acc_ >> 2) & 0xFF));
    }
    acc_ = 0;
    bits_ = 0;
    padding_ = 0;
    return true;
}

std::string Decoder::take() {
    std::string result;
    result.swap(out_);
    return result;
}

void Decoder::reset() {
    out_.clear();
    out_.shrink_to_fit();
    acc_ = 0;
    bits_ = 0;
    padding_ = 0;
    failed_ = false;
}

}  // namespace mfbe::base64
