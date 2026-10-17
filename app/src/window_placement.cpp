#include "window_placement.h"

#include <algorithm>
#include <charconv>
#include <vector>

namespace mfbe::shell {

namespace {

// A whole decimal integer (optional '-'), nothing else.
bool parseInt(std::string_view text, int* value) {
    if (text.empty()) {
        return false;
    }
    int parsed = 0;
    const auto result = std::from_chars(text.data(), text.data() + text.size(), parsed);
    if (result.ec != std::errc() || result.ptr != text.data() + text.size()) {
        return false;
    }
    *value = parsed;
    return true;
}

std::vector<std::string_view> splitCommas(std::string_view text) {
    std::vector<std::string_view> parts;
    while (true) {
        const auto comma = text.find(',');
        parts.push_back(text.substr(0, comma));
        if (comma == std::string_view::npos) {
            break;
        }
        text.remove_prefix(comma + 1);
    }
    return parts;
}

}  // namespace

std::optional<WindowPlacement> parseWindowGeometry(std::string_view text) {
    const std::vector<std::string_view> parts = splitCommas(text);
    if (parts.size() != 4 && parts.size() != 5) {
        return std::nullopt;
    }
    WindowPlacement placement;
    if (!parseInt(parts[0], &placement.x) || !parseInt(parts[1], &placement.y) ||
        !parseInt(parts[2], &placement.width) || !parseInt(parts[3], &placement.height)) {
        return std::nullopt;
    }
    if (placement.width <= 0 || placement.height <= 0) {
        return std::nullopt;
    }
    if (parts.size() == 5) {
        if (parts[4] != "max") {
            return std::nullopt;
        }
        placement.maximized = true;
    }
    return placement;
}

std::string formatWindowGeometry(const WindowPlacement& placement) {
    std::string text = std::to_string(placement.x) + "," + std::to_string(placement.y) + "," +
                       std::to_string(placement.width) + "," + std::to_string(placement.height);
    if (placement.maximized) {
        text += ",max";
    }
    return text;
}

WindowPlacement clampToArea(const WindowPlacement& placement, const ScreenRect& area, int min_width,
                            int min_height) {
    WindowPlacement result = placement;
    // Size: within the area, but never below the minimum.
    result.width = std::max(std::min(result.width, area.width), min_width);
    result.height = std::max(std::min(result.height, area.height), min_height);
    // Position: the whole window inside the area; the area's origin when it does not fit.
    const int max_x = area.x + area.width - result.width;
    const int max_y = area.y + area.height - result.height;
    result.x = max_x < area.x ? area.x : std::clamp(result.x, area.x, max_x);
    result.y = max_y < area.y ? area.y : std::clamp(result.y, area.y, max_y);
    return result;
}

bool coversArea(const ScreenRect& bounds, const ScreenRect& area) {
    return bounds.x <= area.x && bounds.y <= area.y &&
           bounds.x + bounds.width >= area.x + area.width &&
           bounds.y + bounds.height >= area.y + area.height;
}

}  // namespace mfbe::shell
