// Compiled in mfbe_app_bridge (exceptions enabled); see core_host.h.

#include "core_host.h"

#include "clipboard_bridge.h"
#include "dialog_provider.h"

#include <atomic>
#include <cstdio>
#include <exception>
#include <thread>
#include <utility>

// The in-process core is optional at build time: the shell links mfbe::core when the target
// exists, and these headers appear once the core server lands (T022/T025). Until then the
// shell runs with the --url developer override only.
#if __has_include(<mfbe/core_server.hpp>)
#include <mfbe/core_server.hpp>
#include <mfbe/log.hpp>
#include <mfbe/utf8_paths.hpp>
#define MFBE_SHELL_HAS_CORE 1
#endif

namespace mfbe::shell {

namespace {

// Extracts "scheme://host[:port]" from an http(s) URL (empty for anything else).
std::string originOf(const std::string& url) {
    const auto scheme_end = url.find("://");
    if (scheme_end == std::string::npos) {
        return {};
    }
    const auto authority_begin = scheme_end + 3;
    const auto authority_end = url.find_first_of("/?#", authority_begin);
    return url.substr(0, authority_end == std::string::npos ? url.size() : authority_end);
}

// --url developer override: nothing to start, nothing to stop.
class UrlOnlyHost final : public CoreHost {
public:
    explicit UrlOnlyHost(std::string url) : url_(std::move(url)), origin_(originOf(url_)) {}

    const std::string& url() const override { return url_; }
    const std::string& origin() const override { return origin_; }
    bool hasCore() const override { return false; }
    void attachDialogs(std::shared_ptr<NativeDialogs> /*dialogs*/) override {}
    void notifyOpenPaths(const std::vector<std::string>& /*paths*/) override {}
    void logWarning(const std::string& code, const std::string& message) override {
        std::fprintf(stderr, "mfbe: warning %s: %s\n", code.c_str(), message.c_str());
    }
    void stop() override {}

private:
    const std::string url_;
    const std::string origin_;
};

#if defined(MFBE_SHELL_HAS_CORE)

// Appends the run-time UI hints that have no core-side setting (--lang, --new) to the UI URL
// as query parameters: http://127.0.0.1:<port>/?token=<token>&lang=ru&new=1. The UI reads
// them at start-up; the core ignores unknown query parameters.
std::string withUiHints(std::string url, const CoreHostOptions& options) {
    const char separator = url.find('?') == std::string::npos ? '?' : '&';
    std::string query;
    if (options.ui_language == "en" || options.ui_language == "ru") {
        query += "&lang=" + options.ui_language;
    }
    if (options.new_document) {
        query += "&new=1";
    }
    if (!query.empty()) {
        query[0] = separator;
        url += query;
    }
    return url;
}

// Runs mfbe::CoreServer (core/include/mfbe/core_server.hpp) inside the shell process.
class InProcessCoreHost final : public CoreHost {
public:
    static std::unique_ptr<CoreHost> start(const CoreHostOptions& options, std::string* error) {
        try {
            mfbe::CoreServerOptions server_options;
            server_options.port = 0;  // OS-assigned loopback port
            // The core takes its folders as UTF-8 text (never the process code page).
            server_options.ui_dir = mfbe::platform::utf8_from_path(options.ui_dir);
            // data_dir is an override root for tests/--data-dir; empty = the platform
            // locations of contracts/resource-formats.md §1 (same rules the shell applies to
            // the CEF profile, see user_dirs.cpp).
            server_options.data_dir = mfbe::platform::utf8_from_path(options.data_dir_override);
            server_options.resources_dir = mfbe::platform::utf8_from_path(options.resources_dir);
            server_options.scripts_dir = mfbe::platform::utf8_from_path(options.scripts_dir);
            server_options.open_paths = options.open_paths;
            server_options.test_hooks = options.test_hooks;

            std::unique_ptr<mfbe::CoreServer> server = mfbe::CoreServer::start(server_options);
            if (!server) {
                if (error != nullptr) {
                    *error = "the core server could not be started (see the errors-only log)";
                }
                return nullptr;
            }
            std::string url = withUiHints(server->url(), options);
            return std::unique_ptr<CoreHost>(
                new InProcessCoreHost(std::move(server), url, options.on_core_stopped));
        } catch (const std::exception& e) {
            if (error != nullptr) {
                *error = std::string("the core server failed to start: ") + e.what();
            }
        } catch (...) {
            if (error != nullptr) {
                *error = "the core server failed to start (unknown error)";
            }
        }
        return nullptr;
    }

    ~InProcessCoreHost() override { stop(); }

    const std::string& url() const override { return url_; }
    const std::string& origin() const override { return origin_; }
    bool hasCore() const override { return server_ != nullptr; }

    void attachDialogs(std::shared_ptr<NativeDialogs> dialogs) override {
        if (!server_) {
            return;
        }
        std::shared_ptr<mfbe::DialogProvider> provider = makeCoreDialogProvider(std::move(dialogs));
        if (!provider) {
            std::fprintf(stderr,
                         "mfbe: native dialogs are not available in this build; dialog.* RPCs "
                         "answer dialog.unavailable\n");
            return;
        }
        try {
            server_->set_dialog_provider(std::move(provider));
        } catch (const std::exception& e) {
            std::fprintf(stderr, "mfbe: failed to register the dialog provider: %s\n", e.what());
        }
        try {
            if (std::shared_ptr<mfbe::ClipboardProvider> clipboard = makeCoreClipboardProvider()) {
                server_->set_clipboard_provider(std::move(clipboard));
            }
        } catch (const std::exception& e) {
            std::fprintf(stderr, "mfbe: failed to register the clipboard provider: %s\n", e.what());
        }
    }

    void logWarning(const std::string& code, const std::string& message) override {
        try {
            mfbe::log::warning("shell", code, message);
        } catch (...) {
        }
    }

    void notifyOpenPaths(const std::vector<std::string>& paths) override {
        if (!server_ || paths.empty()) {
            return;
        }
        try {
            server_->notify_open_paths(paths);
        } catch (const std::exception& e) {
            std::fprintf(stderr, "mfbe: failed to forward paths to the core: %s\n", e.what());
        }
    }

    void stop() override {
        if (!server_) {
            return;
        }
        stopping_by_shell_.store(true);
        try {
            server_->stop();
            server_->wait();
        } catch (const std::exception& e) {
            std::fprintf(stderr, "mfbe: error while stopping the core server: %s\n", e.what());
        } catch (...) {
        }
        if (quit_watcher_.joinable()) {
            quit_watcher_.join();
        }
        server_.reset();
    }

private:
    InProcessCoreHost(std::unique_ptr<mfbe::CoreServer> server, std::string url,
                      std::function<void()> on_core_stopped)
        : server_(std::move(server)), url_(std::move(url)), origin_(originOf(url_)) {
        if (on_core_stopped) {
            // `app.quit` stops the server from inside the core; wait() returns and the shell
            // is asked to close its windows. CoreHost::stop() sets the flag first so a
            // shell-initiated shutdown does not call back.
            quit_watcher_ = std::thread([this, on_core_stopped = std::move(on_core_stopped)] {
                try {
                    server_->wait();
                } catch (...) {
                }
                if (!stopping_by_shell_.load()) {
                    on_core_stopped();
                }
            });
        }
    }

    std::unique_ptr<mfbe::CoreServer> server_;
    const std::string url_;
    const std::string origin_;
    std::atomic<bool> stopping_by_shell_{false};
    std::thread quit_watcher_;
};

#endif  // MFBE_SHELL_HAS_CORE

}  // namespace

// static
bool CoreHost::coreCompiledIn() {
#if defined(MFBE_SHELL_HAS_CORE)
    return true;
#else
    return false;
#endif
}

// static
std::unique_ptr<CoreHost> CoreHost::start(const CoreHostOptions& options, std::string* error) {
    if (!options.url_override.empty()) {
        return std::unique_ptr<CoreHost>(new UrlOnlyHost(options.url_override));
    }
#if defined(MFBE_SHELL_HAS_CORE)
    return InProcessCoreHost::start(options, error);
#else
    if (error != nullptr) {
        *error =
            "this build of the shell has no in-process core (mfbe/core_server.hpp was not "
            "available at build time); start it with --url <http url> pointing at a running "
            "`mfbe-core serve` or Vite dev server";
    }
    return nullptr;
#endif
}

}  // namespace mfbe::shell
