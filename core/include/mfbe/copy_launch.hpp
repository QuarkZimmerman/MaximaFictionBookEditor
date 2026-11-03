// What a start of the editor does when other copies run (feature 008, research R1, R3, R6;
// data-model §3; contracts/cli.md §3). Pure functions: the shell calls them before any engine or
// core starts. They live in the core library beside the copy registry, whose records they read.
#pragma once

#include <mfbe/copy_registry.hpp>

#include <chrono>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::copies {

// The request a start hands to a running copy through the engine's relay (data-model §3).
struct OpenRequest {
    std::string kind = "open";  // "open" | "activate"
    std::string request_id;
    std::vector<std::string> paths;  // absolute, UTF-8
    std::string origin = "outside";  // "outside" | "startup"
    std::string target = "ask";      // "ask" | "untouched"
};

// The relay switch, without its leading dashes.
inline constexpr std::string_view kRequestSwitch = "mfbe-request";

// base64url (no padding) of the request's UTF-8 JSON.
std::string encode_request(const OpenRequest& request);
// The decoded request, or nothing for a malformed payload, a kind other than open/activate, an
// empty or relative path.
std::optional<OpenRequest> decode_request(std::string_view payload);
// Reads only `--mfbe-request=<payload>` from a relayed command line and ignores every other
// switch and argument (the engine adds its own, research R1).
std::optional<OpenRequest> parse_relayed_request(const std::vector<std::string>& argv);
// A fresh request id (time and process based; unique among the copies of one user).
std::string new_request_id();

// Where a start with books goes (research R3).
struct Target {
    bool relay = false;          // false: start a new copy with the books
    int slot = 0;                // the receiving copy's slot when relaying
    std::string kind = "open";   // "open" | "activate" (the first book is open in that copy)
    std::string target = "ask";  // "ask" | "untouched"
};
// `others` are the live records of the other copies; `first_book_id` the identity of the first
// book (empty when unknown). Only copies whose heartbeat is under five seconds old are chosen.
Target choose_target(const std::vector<Record>& others, const std::string& first_book_id,
                     std::chrono::system_clock::time_point now);

// The work area of the screen the new window opens on.
struct WorkArea {
    int x = 0;
    int y = 0;
    int w = 0;
    int h = 0;
};
// A new copy's window (research R6): 32 px right and down of the last-active window, back to the
// work area's corner when it would leave it; a maximized last-active window gives its normal
// rectangle, not maximized and without the offset. Without a last-active window: `fallback`.
WindowRect place_new_window(const std::optional<WindowRect>& last_active, const WorkArea& area,
                            const WindowRect& fallback);

}  // namespace mfbe::copies
