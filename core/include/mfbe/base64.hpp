// Base64 (RFC 4648) for <binary> payloads: streaming decoder fed from SAX character chunks
// (whitespace anywhere, padding optional), and an encoder that wraps at 76 columns (T041/T043).
#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace mfbe::base64 {

// Encodes without line breaks.
std::string encode(std::string_view bytes);

// Encodes with `newline` after every `columns` characters (no trailing newline).
std::string encode_wrapped(std::string_view bytes, std::size_t columns = 76,
                           std::string_view newline = "\n");

// Decodes a complete text (whitespace ignored, '=' padding optional). nullopt when invalid.
std::optional<std::string> decode(std::string_view text);

// Incremental decoder: feed() any number of chunks, then finish().
class Decoder {
public:
    // Returns false (and stays failed) once an invalid character or misplaced padding is seen.
    bool feed(std::string_view chunk);
    // Completes the pending group; false when the input was invalid or truncated to a single
    // dangling character.
    bool finish();
    bool failed() const { return failed_; }
    std::size_t decoded_size() const { return out_.size(); }
    // Takes the decoded bytes (valid after finish()).
    std::string take();
    void reset();

private:
    std::string out_;
    unsigned int acc_ = 0;  // pending bits
    int bits_ = 0;          // number of pending bits (0, 6, 12, 18)
    int padding_ = 0;       // '=' seen
    bool failed_ = false;
};

}  // namespace mfbe::base64
