// The address rule of the AI assistant (feature 005; rpc-api.md "Definitions": Address, Host,
// Local address) shared by the settings validation (`ai.custom.address`), the service list
// loader (`badAddress`) and the `ai.*` handlers (the request URL, the agreement gate, the host
// that reaches the log and the test record).
#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace mfbe::ai {

inline constexpr std::size_t kMaxAddressLength = 2048;

struct ParsedAddress {
    std::string scheme;       // "http" | "https" (lower case)
    std::string host;         // the authority without user information: `host` or `host:port` as
                              // written - the only part of an address that may be logged
    std::string hostname;     // the host alone, brackets and port removed, ASCII lower case
    std::string base;         // the address with its trailing '/' characters removed
    bool plain_http = false;  // scheme http
    bool local = false;       // hostname is localhost, 127.0.0.0/8 or ::1 (textual rule)
};

// Parses `address` by the rule: an absolute `http://` or `https://` URL with a host (a DNS
// name, an IPv4 literal or a bracketed IPv6 literal), an optional port, an optional path; no
// query, fragment or user information, no whitespace or control characters, valid UTF-8, at
// most kMaxAddressLength characters. nullopt when the rule is broken.
std::optional<ParsedAddress> parse_address(std::string_view address);

// The textual "local address" rule: `localhost` (ASCII case-insensitive), an IPv4 literal in
// 127.0.0.0/8, or `::1` (brackets removed). Everything else - LAN names and addresses included -
// is hosted.
bool is_local_hostname(std::string_view hostname);

// A looser rule for a link to open in the browser (a terms page, app.openUrl): an absolute
// `http://` or `https://` URL with a host, without whitespace or control characters, at most
// kMaxAddressLength characters - a query or a fragment is fine on a web page.
bool is_http_url(std::string_view url);

// True when `text` holds a control character (C0, DEL or C1 code points).
bool has_control_characters(std::string_view text);
// True when `text` holds whitespace (ASCII or Unicode spaces) or a control character.
bool has_whitespace_or_control(std::string_view text);

}  // namespace mfbe::ai
