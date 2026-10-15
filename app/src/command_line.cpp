#include "command_line.h"

#include <charconv>
#include <string_view>

namespace mfbe::shell {

namespace {

constexpr std::string_view kVersion = MFBE_VERSION;
constexpr std::string_view kBuildId = MFBE_BUILD_ID;
constexpr std::string_view kBuildDate = MFBE_BUILD_DATE;
constexpr std::string_view kProductName = MFBE_PRODUCT_NAME;

bool parsePort(std::string_view text, int* port) {
    int value = 0;
    const auto* begin = text.data();
    const auto* end = text.data() + text.size();
    const auto result = std::from_chars(begin, end, value);
    if (result.ec != std::errc() || result.ptr != end) {
        return false;
    }
    // 0 asks Chromium for an ephemeral port (printed to stderr); otherwise a user port.
    if (value != 0 && (value < 1024 || value > 65535)) {
        return false;
    }
    *port = value;
    return true;
}

ParseResult error(std::string message) {
    ParseResult result;
    result.status = ParseStatus::kExitError;
    result.message = std::move(message);
    return result;
}

}  // namespace

ParseResult parseArguments(const std::vector<std::string>& args) {
    ParseResult result;
    ShellOptions& options = result.options;

    bool only_positional = false;
    for (size_t i = 0; i < args.size(); ++i) {
        const std::string& arg = args[i];

        if (only_positional || arg.empty() || arg[0] != '-' || arg == "-") {
            options.files.push_back(arg);
            continue;
        }
        if (arg == "--") {
            only_positional = true;
            continue;
        }

        // Split "--name=value".
        std::string name = arg;
        std::string value;
        bool has_value = false;
        if (const auto eq = arg.find('='); eq != std::string::npos) {
            name = arg.substr(0, eq);
            value = arg.substr(eq + 1);
            has_value = true;
        }

        // Options that take a value; the value may also be the next argument.
        const bool takes_value = name == "--lang" || name == "--remote-debugging-port" ||
                                 name == "--ozone-platform" || name == "--url";
        if (takes_value && !has_value) {
            if (i + 1 >= args.size()) {
                return error("Missing value for command line option: '" + name + "'");
            }
            value = args[++i];
            has_value = true;
        }

        if (name == "--lang") {
            if (value != "en" && value != "ru") {
                return error("Invalid value for --lang: '" + value + "' (expected en or ru)");
            }
            options.lang = value;
        } else if (name == "--remote-debugging-port") {
            if (!parsePort(value, &options.remote_debugging_port)) {
                return error("Invalid value for --remote-debugging-port: '" + value +
                             "' (expected a port number 1024-65535, or 0 for an ephemeral port)");
            }
        } else if (name == "--ozone-platform") {
            if (value != "wayland" && value != "x11") {
                return error("Invalid value for --ozone-platform: '" + value +
                             "' (expected wayland or x11)");
            }
            options.ozone_platform = value;
        } else if (name == "--url") {
            if (value.rfind("http://", 0) != 0 && value.rfind("https://", 0) != 0 &&
                value != "about:blank") {
                return error("Invalid value for --url: '" + value +
                             "' (expected an http(s) URL or about:blank)");
            }
            options.url_override = value;
        } else if (has_value) {
            // Flags never take a value ("--new=1" is not accepted).
            return error("Invalid command line option: '" + arg + "'");
        } else if (name == "--new") {
            options.new_document = true;
        } else if (name == "--no-sandbox") {
            options.no_sandbox = true;
        } else if (name == "--version" || name == "-v") {
            options.show_version = true;
        } else if (name == "--help" || name == "-h" || name == "-?") {
            options.show_help = true;
        } else {
            return error("Invalid command line option: '" + arg + "'");
        }
    }

    if (options.show_help) {
        result.status = ParseStatus::kExitOk;
        result.message = usageText();
    } else if (options.show_version) {
        result.status = ParseStatus::kExitOk;  // caller fills in versionText() with runtime info
    }
    return result;
}

ParseResult parseCommandLine(int argc, const char* const* argv) {
    std::vector<std::string> args;
    for (int i = 1; i < argc; ++i) {
        if (argv[i] != nullptr) {
            args.emplace_back(argv[i]);
        }
    }
    return parseArguments(args);
}

std::string usageText() {
    std::string text;
    text += std::string(kProductName) + " " + std::string(kVersion) + "\n\n";
    text +=
        "Usage: mfbe [options] [FILE...]\n"
        "  FILE                           .fb2 / .fbd / .xml document(s) to open\n"
        "  --lang <en|ru>                 override the interface language for this run\n"
        "  --new                          start with a new document from the blank template (the "
        "same as starting without FILE)\n"
        "  --remote-debugging-port <n>    enable Chromium DevTools/CDP on 127.0.0.1:<n>\n"
        "  --no-sandbox                   skip the Chromium sandbox (logged)\n"
        "  --ozone-platform <wayland|x11> Linux: force a display backend (default: auto)\n"
        "  --url <http url>               development only: load this URL instead of the "
        "in-process core\n"
        "  --version                      print version information and exit\n"
        "  --help                         show this help and exit\n"
        "\n"
        "Exit codes: 0 normal, 1 fatal error at start-up, 2 command-line error.\n";
    return text;
}

std::string versionText(const CefVersionInfo& cef) {
    std::string text;
    text += std::string(kProductName) + " " + std::string(kVersion) + " (build " +
            std::string(kBuildId) + ", " + std::string(kBuildDate) + ")\n";
    text += "CEF " + cef.compiled_cef_version + " (compiled against; CEF_API_VERSION " +
            std::to_string(cef.api_version) + ")\n";
    if (!cef.runtime_cef_version.empty()) {
        text += "Runtime: CEF " + cef.runtime_cef_version + ", Chromium " +
                cef.runtime_chromium_version + "\n";
    }
    return text;
}

}  // namespace mfbe::shell
