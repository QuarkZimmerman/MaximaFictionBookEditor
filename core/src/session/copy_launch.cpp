// See mfbe/copy_launch.hpp.
#include <mfbe/base64.hpp>
#include <mfbe/copy_launch.hpp>
#include <mfbe/utf8_paths.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <filesystem>
#include <random>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace mfbe::copies {

using json = nlohmann::json;

namespace {

std::string to_base64url(std::string_view bytes) {
    std::string text = base64::encode(bytes);
    for (char& c : text) {
        if (c == '+')
            c = '-';
        if (c == '/')
            c = '_';
    }
    while (!text.empty() && text.back() == '=')
        text.pop_back();
    return text;
}

std::optional<std::string> from_base64url(std::string_view text) {
    std::string standard(text);
    for (char& c : standard) {
        if (c == '-')
            c = '+';
        else if (c == '_')
            c = '/';
        else if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '+' || c == '/')) {
            return std::nullopt;
        }
    }
    while (standard.size() % 4 != 0)
        standard += '=';
    return base64::decode(standard);
}

bool absolute_utf8_path(const std::string& path) {
    if (path.empty())
        return false;
    return platform::path_from_utf8(path).is_absolute();
}

}  // namespace

std::string encode_request(const OpenRequest& request) {
    const json j{{"v", 1},
                 {"kind", request.kind},
                 {"requestId", request.request_id},
                 {"paths", request.paths},
                 {"origin", request.origin},
                 {"target", request.target}};
    return to_base64url(j.dump());
}

std::optional<OpenRequest> decode_request(std::string_view payload) {
    const auto bytes = from_base64url(payload);
    if (!bytes)
        return std::nullopt;
    const json j = json::parse(*bytes, nullptr, false);
    if (!j.is_object() || j.value("v", 0) != 1)
        return std::nullopt;
    OpenRequest r;
    r.kind = j.value("kind", std::string{});
    if (r.kind != "open" && r.kind != "activate")
        return std::nullopt;
    r.request_id = j.value("requestId", std::string{});
    r.origin = j.value("origin", std::string{"outside"});
    if (r.origin != "outside" && r.origin != "startup")
        return std::nullopt;
    r.target = j.value("target", std::string{"ask"});
    if (r.target != "ask" && r.target != "untouched")
        return std::nullopt;
    if (!j.contains("paths") || !j["paths"].is_array() || j["paths"].empty())
        return std::nullopt;
    for (const auto& p : j["paths"]) {
        if (!p.is_string() || !absolute_utf8_path(p.get<std::string>()))
            return std::nullopt;
        r.paths.push_back(p.get<std::string>());
    }
    return r;
}

std::optional<OpenRequest> parse_relayed_request(const std::vector<std::string>& argv) {
    const std::string prefix = "--" + std::string(kRequestSwitch) + "=";
    for (const std::string& arg : argv) {
        if (arg.rfind(prefix, 0) == 0)
            return decode_request(std::string_view(arg).substr(prefix.size()));
    }
    return std::nullopt;
}

std::string new_request_id() {
    static std::atomic<unsigned> counter{0};
    std::random_device rd;
#ifdef _WIN32
    const unsigned long long pid = GetCurrentProcessId();
#else
    const unsigned long long pid = static_cast<unsigned long long>(getpid());
#endif
    const auto now = std::chrono::steady_clock::now().time_since_epoch().count();
    return std::to_string(pid) + "-" + std::to_string(now) + "-" + std::to_string(rd()) + "-" +
           std::to_string(counter++);
}

Target choose_target(const std::vector<Record>& others, const std::string& first_book_id,
                     std::chrono::system_clock::time_point now) {
    std::vector<const Record*> fresh;
    for (const auto& r : others) {
        if (r.live && is_responding(r, now))
            fresh.push_back(&r);
    }
    Target t;
    if (fresh.empty())
        return t;
    if (!first_book_id.empty()) {
        for (const Record* r : fresh) {
            if (r->book && r->book->file_id == first_book_id) {
                t.relay = true;
                t.slot = r->slot;
                t.kind = "activate";
                return t;
            }
        }
    }
    const auto by_recent = [](const Record* a, const Record* b) {
        return a->last_active_at > b->last_active_at;  // ISO-8601 UTC sorts by time
    };
    std::stable_sort(fresh.begin(), fresh.end(), by_recent);
    for (const Record* r : fresh) {
        if (r->untouched && !r->book) {
            t.relay = true;
            t.slot = r->slot;
            t.target = "untouched";
            return t;
        }
    }
    t.relay = true;
    t.slot = fresh.front()->slot;
    return t;
}

WindowRect place_new_window(const std::optional<WindowRect>& last_active, const WorkArea& area,
                            const WindowRect& fallback) {
    if (!last_active || last_active->w <= 0 || last_active->h <= 0)
        return fallback;
    WindowRect w = *last_active;
    w.maximized = false;
    if (last_active->maximized)
        return w;  // its normal rectangle, without an offset (D7)
    w.x += 32;
    w.y += 32;
    if (area.w > 0 && area.h > 0) {
        w.w = std::min(w.w, area.w);
        w.h = std::min(w.h, area.h);
        if (w.x + w.w > area.x + area.w || w.y + w.h > area.y + area.h) {
            w.x = area.x;
            w.y = area.y;
        }
    }
    return w;
}

}  // namespace mfbe::copies
