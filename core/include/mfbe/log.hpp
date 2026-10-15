// Errors-only diagnostics log (T012, FR-131).
//
// One JSON object per line in `<log dir>/mfbe-errors.log` (spdlog rotating sink, 5 x 1 MB):
//   {"ts":"2026-10-12T20:00:00.123Z","level":"error","source":"core","code":"io.writeFailed",
//    "message":"...","context":{"version":"0.0.2","platform":"linux","docId":"d1"},"stack":"..."}
// Only `error` and `warning` entries reach the file. `info`/`debug` exist for the console
// (stderr) at the verbosity selected with `set_console_level` and never touch the file.
// Callers MUST NOT pass book text or personal data in `message`/`context`/`stack`.
#pragma once

#include <filesystem>
#include <map>
#include <optional>
#include <string>
#include <string_view>

namespace mfbe::log {

enum class Level { error, warning, info, debug };

struct Context {
    std::optional<std::string> docId;
    std::optional<std::string> nodeId;
    std::map<std::string, std::string> extra;  // additional non-sensitive key/values
};

// Shorthand for a context carrying only extra key/values: log::extras({{"path", p}}).
inline Context extras(std::map<std::string, std::string> extra) {
    Context ctx;
    ctx.extra = std::move(extra);
    return ctx;
}

// Opens the rotating file sink in `log_dir` (created when missing). Idempotent: calling it
// again with another directory re-points the sink. Failures fall back to stderr only.
void init(const std::filesystem::path& log_dir);

// Flushes and closes the file sink (safe to call without init).
void shutdown();

// Current log file path ("" when init was never called or failed).
std::filesystem::path log_file_path();

void error(std::string_view source, std::string_view code, std::string_view message,
           const Context& context = {}, std::string_view stack = {});
void warning(std::string_view source, std::string_view code, std::string_view message,
             const Context& context = {}, std::string_view stack = {});

// Console-only diagnostics (stderr); filtered by set_console_level (default: error).
void info(std::string_view source, std::string_view message);
void debug(std::string_view source, std::string_view message);

// "error" | "warn" | "warning" | "info" | "debug"; unknown values keep the current level.
void set_console_level(std::string_view level);
void set_console_level(Level level);
Level console_level();

// Renders one entry as the single-line JSON written to the file (exposed for tests).
std::string format_entry(Level level, std::string_view source, std::string_view code,
                         std::string_view message, const Context& context, std::string_view stack);

}  // namespace mfbe::log
