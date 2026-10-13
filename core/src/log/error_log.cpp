// Errors-only rolling log (T012). See mfbe/log.hpp.
#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/version.hpp>

#include <nlohmann/json.hpp>
#include <spdlog/sinks/rotating_file_sink.h>
#include <spdlog/spdlog.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <memory>
#include <mutex>
#include <system_error>

namespace mfbe::log {
namespace {

constexpr std::size_t kMaxFileBytes = 1024 * 1024;  // 1 MB
constexpr std::size_t kMaxFiles = 5;
constexpr std::size_t kMaxFieldLength = 4000;  // defensive cap per field

struct State {
    std::mutex mutex;
    std::shared_ptr<spdlog::logger> file_logger;
    std::filesystem::path file_path;
    std::atomic<Level> console_level{Level::error};
};

State& state() {
    static State s;
    return s;
}

std::string truncate(std::string_view text) {
    if (text.size() <= kMaxFieldLength) {
        return std::string(text);
    }
    return std::string(text.substr(0, kMaxFieldLength)) + "...";
}

std::string timestamp_utc() {
    using namespace std::chrono;
    const auto now = system_clock::now();
    const auto ms = duration_cast<milliseconds>(now.time_since_epoch()) % 1000;
    const std::time_t t = system_clock::to_time_t(now);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[96];
    std::snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", tm.tm_year + 1900,
                  tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec,
                  static_cast<int>(ms.count()));
    return buf;
}

const char* level_name(Level level) {
    switch (level) {
        case Level::error:
            return "error";
        case Level::warning:
            return "warning";
        case Level::info:
            return "info";
        case Level::debug:
            return "debug";
    }
    return "error";
}

void write_console(Level level, std::string_view source, std::string_view text) {
    if (static_cast<int>(level) > static_cast<int>(state().console_level.load())) {
        return;
    }
    std::fprintf(stderr, "[mfbe %s] %.*s: %.*s\n", level_name(level),
                 static_cast<int>(source.size()), source.data(), static_cast<int>(text.size()),
                 text.data());
    std::fflush(stderr);
}

void write_entry(Level level, std::string_view source, std::string_view code,
                 std::string_view message, const Context& context, std::string_view stack) {
    const std::string line = format_entry(level, source, code, message, context, stack);
    {
        std::lock_guard<std::mutex> lock(state().mutex);
        if (state().file_logger) {
            state().file_logger->log(
                level == Level::error ? spdlog::level::err : spdlog::level::warn, line);
            state().file_logger->flush();
        }
    }
    write_console(level, source, std::string(code) + " " + std::string(message));
}

}  // namespace

std::string format_entry(Level level, std::string_view source, std::string_view code,
                         std::string_view message, const Context& context, std::string_view stack) {
    nlohmann::json entry;
    entry["ts"] = timestamp_utc();
    entry["level"] = level_name(level);
    entry["source"] = truncate(source);
    entry["code"] = truncate(code);
    entry["message"] = truncate(message);
    nlohmann::json ctx;
    ctx["version"] = version::kVersion;
    ctx["platform"] = platform::platform_name();
    if (context.docId) {
        ctx["docId"] = *context.docId;
    }
    if (context.nodeId) {
        ctx["nodeId"] = *context.nodeId;
    }
    for (const auto& [key, value] : context.extra) {
        if (!ctx.contains(key)) {
            ctx[key] = truncate(value);
        }
    }
    entry["context"] = std::move(ctx);
    if (!stack.empty()) {
        entry["stack"] = truncate(stack);
    }
    return entry.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
}

void init(const std::filesystem::path& log_dir) {
    std::lock_guard<std::mutex> lock(state().mutex);
    try {
        std::error_code ec;
        std::filesystem::create_directories(log_dir, ec);
        const auto path = log_dir / "mfbe-errors.log";
        auto sink = std::make_shared<spdlog::sinks::rotating_file_sink_mt>(
            path.string(), kMaxFileBytes, kMaxFiles);
        auto logger = std::make_shared<spdlog::logger>("mfbe-errors", sink);
        logger->set_pattern("%v");
        logger->set_level(spdlog::level::warn);
        logger->flush_on(spdlog::level::warn);
        if (state().file_logger) {
            state().file_logger->flush();
        }
        state().file_logger = std::move(logger);
        state().file_path = path;
    } catch (const std::exception& e) {
        state().file_logger.reset();
        state().file_path.clear();
        std::fprintf(stderr, "[mfbe error] log: cannot open error log in %s: %s\n",
                     log_dir.string().c_str(), e.what());
    }
}

void shutdown() {
    std::lock_guard<std::mutex> lock(state().mutex);
    if (state().file_logger) {
        state().file_logger->flush();
        state().file_logger.reset();
    }
    state().file_path.clear();
}

std::filesystem::path log_file_path() {
    std::lock_guard<std::mutex> lock(state().mutex);
    return state().file_path;
}

void error(std::string_view source, std::string_view code, std::string_view message,
           const Context& context, std::string_view stack) {
    write_entry(Level::error, source, code, message, context, stack);
}

void warning(std::string_view source, std::string_view code, std::string_view message,
             const Context& context, std::string_view stack) {
    write_entry(Level::warning, source, code, message, context, stack);
}

void info(std::string_view source, std::string_view message) {
    write_console(Level::info, source, message);
}

void debug(std::string_view source, std::string_view message) {
    write_console(Level::debug, source, message);
}

void set_console_level(std::string_view level) {
    if (level == "error") {
        set_console_level(Level::error);
    } else if (level == "warn" || level == "warning") {
        set_console_level(Level::warning);
    } else if (level == "info") {
        set_console_level(Level::info);
    } else if (level == "debug") {
        set_console_level(Level::debug);
    }
}

void set_console_level(Level level) {
    state().console_level.store(level);
}

Level console_level() {
    return state().console_level.load();
}

}  // namespace mfbe::log
