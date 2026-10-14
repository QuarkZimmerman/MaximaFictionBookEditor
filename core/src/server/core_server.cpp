// CoreServer: wires directories, stores, router, handlers and the loopback transport (T022).
#include "server/loopback_server.hpp"
#include "server/services.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/log.hpp>
#include <mfbe/validator.hpp>
#include <mfbe/version.hpp>

#include <algorithm>
#include <atomic>
#include <future>
#include <random>
#include <sstream>
#include <stdexcept>
#include <system_error>
#include <thread>

namespace mfbe {
namespace {

namespace fs = std::filesystem;

std::string random_token_hex() {
    std::random_device rd;
    std::ostringstream out;
    out << std::hex;
    for (int i = 0; i < 4; ++i) {  // 4 x 32 bits = 128 bits
        unsigned int v = rd();
        char buf[16];
        std::snprintf(buf, sizeof(buf), "%08x", v);
        out << buf;
    }
    return out.str();
}

bool is_dir(const fs::path& p) {
    std::error_code ec;
    return !p.empty() && fs::is_directory(p, ec);
}

// The option strings and the build-tree fallbacks are UTF-8 text (the shell converts its own
// folders with utf8_from_path).
fs::path resolve_resources_dir(const std::string& override_dir) {
    if (!override_dir.empty()) {
        return fs::absolute(platform::path_from_utf8(override_dir));
    }
    const fs::path exe_dir = platform::executable_dir();
    const fs::path source_dir = platform::path_from_utf8(MFBE_RESOURCES_SOURCE_DIR);
    for (const fs::path& candidate :
         {exe_dir / ".." / "share" / "mfbe" / "resources", exe_dir / "resources", source_dir}) {
        if (is_dir(candidate)) {
            std::error_code ec;
            auto canonical = fs::weakly_canonical(candidate, ec);
            return ec ? candidate : canonical;
        }
    }
    return source_dir;
}

fs::path resolve_scripts_dir(const std::string& override_dir) {
    if (!override_dir.empty()) {
        return fs::absolute(platform::path_from_utf8(override_dir));
    }
    const fs::path exe_dir = platform::executable_dir();
    const fs::path source_dir = platform::path_from_utf8(MFBE_SCRIPTS_SOURCE_DIR);
    for (const fs::path& candidate :
         {exe_dir / ".." / "share" / "mfbe" / "scripts", exe_dir / "scripts", source_dir}) {
        if (is_dir(candidate)) {
            std::error_code ec;
            auto canonical = fs::weakly_canonical(candidate, ec);
            return ec ? candidate : canonical;
        }
    }
    return source_dir;
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Services                                                                                   */
/* ----------------------------------------------------------------------------------------- */

namespace server {

Services::Services(CoreServerOptions opts, platform::Dirs dirs_, fs::path resources,
                   fs::path scripts, rpc::Notifier& notifier_)
    : options(std::move(opts)),
      dirs(std::move(dirs_)),
      resources_dir(std::move(resources)),
      scripts_dir(std::move(scripts)),
      settings(dirs.config / "settings.json"),
      recent(dirs.config / "recent.json"),
      exclusions(dirs.config / "exclusions.txt"),
      hotkeys(dirs.config / "hotkeys.json"),
      layers(resources::Roots{}),
      notifier(notifier_),
      jobs(notifier_) {
    settings.load();
    recent.load();
    exclusions.load();
    hotkeys.load();
    refresh_layers();
    std::filesystem::path custom =
        platform::path_from_utf8(settings.get_string("view.customDictionaryPath"));
    if (custom.empty()) {
        custom = dirs.data / "custom.dic";
    }
    spell = std::make_unique<spell::SpellService>(layers, custom);
}

Services::~Services() {
    // The validator hook must not outlive the catalogue owner.
    genres::install_genre_validator(nullptr);
}

void Services::refresh_layers() {
    resources::Roots roots;
    roots.user_data = dirs.data;
    roots.portable = dirs.portable;
    roots.bundled_resources = resources_dir;
    roots.bundled_scripts = scripts_dir;
    roots.settings_genres = platform::path_from_utf8(settings.get_string("other.genresFolder"));
    roots.settings_scripts = platform::path_from_utf8(settings.get_string("other.scriptsFolder"));
    layers.set_roots(std::move(roots));
}

void Services::refresh_genres() {
    auto catalog = std::make_shared<const genres::GenreCatalog>(
        genres::load_catalog(validation::schema_genres(), resources_dir / "genres", layers));
    {
        std::lock_guard<std::mutex> lock(genres_mutex_);
        genres_ = catalog;
    }
    genres::install_genre_validator(catalog);
}

std::shared_ptr<const genres::GenreCatalog> Services::genre_catalog() const {
    std::lock_guard<std::mutex> lock(genres_mutex_);
    return genres_;
}

void Services::refresh_scripts() {
    auto catalog = std::make_shared<const scripts::Catalog>(scripts::load_catalog(layers));
    std::lock_guard<std::mutex> lock(scripts_mutex_);
    scripts_ = catalog;
}

std::shared_ptr<const scripts::Catalog> Services::script_catalog() const {
    std::lock_guard<std::mutex> lock(scripts_mutex_);
    return scripts_;
}

const resources::LanguageTable& Services::languages() {
    if (!languages_) {
        languages_ = resources::load_languages(resources_dir / "languages.json");
    }
    return *languages_;
}

const std::vector<resources::SymbolEntry>& Services::symbols() {
    if (!symbols_) {
        symbols_ = resources::load_symbols(resources_dir / "symbols.ini");
    }
    return *symbols_;
}

images::ConversionPolicy Services::conversion_policy() const {
    images::ConversionPolicy policy;
    policy.preferred =
        images::format_from_string(settings.get_string("other.pasteImageFormat", "jpeg"))
            .value_or(images::Format::jpeg);
    policy.jpeg_quality = std::clamp(settings.get_int("other.jpegQuality", 90), 1, 100);
    return policy;
}

std::shared_ptr<ClipboardProvider> Services::clipboard_provider() const {
    std::lock_guard<std::mutex> lock(dialog_mutex_);
    return clipboard_;
}

void Services::set_clipboard_provider(std::shared_ptr<ClipboardProvider> provider) {
    std::lock_guard<std::mutex> lock(dialog_mutex_);
    clipboard_ = std::move(provider);
}

std::int64_t Services::uptime_ms() const {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() -
                                                                 started_at)
        .count();
}

std::shared_ptr<DialogProvider> Services::dialog_provider() const {
    std::lock_guard<std::mutex> lock(dialog_mutex_);
    return dialogs_;
}

void Services::set_dialog_provider(std::shared_ptr<DialogProvider> provider) {
    std::lock_guard<std::mutex> lock(dialog_mutex_);
    dialogs_ = std::move(provider);
}

}  // namespace server

/* ----------------------------------------------------------------------------------------- */
/* CoreServer                                                                                 */
/* ----------------------------------------------------------------------------------------- */

struct CoreServer::Impl : rpc::Notifier {
    std::unique_ptr<server::Services> services;
    rpc::RpcRouter router;

    std::thread thread;
    std::thread::id loop_thread_id;
    std::mutex loop_mutex;
    server::LoopbackServer* transport = nullptr;  // valid while loop_alive
    bool loop_alive = false;
    std::atomic<bool> stop_requested{false};
    std::atomic<bool> thread_started{false};
    std::promise<void> finished_promise;
    std::shared_future<void> finished = finished_promise.get_future().share();

    // Thread-safe: runs fn on the loop thread.
    bool post(std::function<void()> fn) {
        std::lock_guard<std::mutex> lock(loop_mutex);
        if (!loop_alive || transport == nullptr) {
            return false;
        }
        transport->loop()->defer(std::move(fn));
        return true;
    }

    void notify(const std::string& method, const nlohmann::json& params) override {
        std::string text =
            rpc::RpcRouter::wire_text(rpc::RpcRouter::make_notification(method, params));
        post([this, text = std::move(text)] {
            if (transport != nullptr) {
                transport->broadcast(text);
            }
        });
    }

    void request_stop() {
        if (stop_requested.exchange(true)) {
            return;
        }
        post([this] {
            if (transport != nullptr) {
                transport->stop();
            }
        });
    }

    void register_handlers() {
        server::register_app_handlers(router, *services);
        server::register_log_handlers(router, *services);
        server::register_settings_handlers(router, *services);
        server::register_dialog_handlers(router, *services);
        server::register_doc_handlers(router, *services);
        server::register_binary_handlers(router, *services);
        server::register_resources_handlers(router, *services);
        server::register_spell_handlers(router, *services);
        server::register_words_handlers(router, *services);
        server::register_scripts_handlers(router, *services);
#ifdef MFBE_TEST_HOOKS
        if (services->test_hooks) {
            server::register_test_handlers(router, *services);
        }
#endif
    }
};

CoreServer::CoreServer() : impl_(std::make_unique<Impl>()) {}

CoreServer::~CoreServer() {
    stop();
    wait();
    if (impl_->thread.joinable()) {
        impl_->thread.join();
    }
    if (impl_->services) {
        impl_->services->watcher.reset();
        impl_->services->jobs.shutdown();
    }
}

std::unique_ptr<CoreServer> CoreServer::start(const CoreServerOptions& options) {
    std::unique_ptr<CoreServer> server(new CoreServer());
    Impl& impl = *server->impl_;

    platform::Dirs dirs = platform::resolve_dirs(options.data_dir);
    platform::ensure_dirs(dirs);
    log::init(dirs.logs);

    impl.services = std::make_unique<server::Services>(
        options, dirs, resolve_resources_dir(options.resources_dir),
        resolve_scripts_dir(options.scripts_dir), impl);
    server::Services& services = *impl.services;
    services.token = options.token.empty() ? random_token_hex() : options.token;
    validation::set_schema_dir(services.resources_dir / "schema");
    services.refresh_genres();  // effective genre list -> validator (FR-054)
#ifdef MFBE_TEST_HOOKS
    services.test_hooks = options.test_hooks;
    if (services.test_hooks) {
        services.queued_dialogs = std::make_shared<QueuedDialogProvider>();
        services.set_dialog_provider(services.queued_dialogs);
        services.queued_clipboard = std::make_shared<QueuedClipboardProvider>();
        services.set_clipboard_provider(services.queued_clipboard);
    }
#else
    if (options.test_hooks) {
        log::warning("core", "server.testHooksUnavailable",
                     "test hooks requested but not compiled in (MFBE_TEST_HOOKS off)");
    }
#endif
    services.post = [&impl](std::function<void()> fn) { return impl.post(std::move(fn)); };
    services.request_quit = [&impl] { impl.request_stop(); };
    impl.register_handlers();

    std::promise<std::string> ready;  // "" = ok, otherwise error text
    auto ready_future = ready.get_future();
    impl.thread_started = true;
    impl.thread = std::thread([&impl, &services, ready = std::move(ready)]() mutable {
        impl.loop_thread_id = std::this_thread::get_id();
        std::unique_ptr<server::LoopbackServer> transport;
        try {
            transport = std::make_unique<server::LoopbackServer>(services, impl.router);
        } catch (const std::exception& e) {
            ready.set_value(std::string("cannot create server: ") + e.what());
            impl.finished_promise.set_value();
            return;
        }
        if (!transport->listen()) {
            ready.set_value("cannot bind 127.0.0.1:" + std::to_string(services.options.port));
            transport.reset();
            impl.finished_promise.set_value();
            return;
        }
        {
            std::lock_guard<std::mutex> lock(impl.loop_mutex);
            impl.transport = transport.get();
            impl.loop_alive = true;
        }
        transport->notify_open_paths(services.options.open_paths);
        ready.set_value("");
        transport->run();
        {
            std::lock_guard<std::mutex> lock(impl.loop_mutex);
            impl.loop_alive = false;
            impl.transport = nullptr;
        }
        transport.reset();
        impl.finished_promise.set_value();
    });

    const std::string error = ready_future.get();
    if (!error.empty()) {
        impl.thread.join();
        log::error("core", "server.startFailed", error,
                   log::extras({{"port", std::to_string(options.port)}}));
        throw std::runtime_error(error);
    }
    log::info("server", "listening on " + server->url());
    return server;
}

int CoreServer::port() const {
    return impl_->services ? impl_->services->port : 0;
}

const std::string& CoreServer::token() const {
    static const std::string empty;
    return impl_->services ? impl_->services->token : empty;
}

std::string CoreServer::url() const {
    return "http://127.0.0.1:" + std::to_string(port()) + "/?token=" + token();
}

void CoreServer::set_dialog_provider(std::shared_ptr<DialogProvider> provider) {
    if (impl_->services) {
        impl_->services->set_dialog_provider(std::move(provider));
    }
}

void CoreServer::set_clipboard_provider(std::shared_ptr<ClipboardProvider> provider) {
    if (impl_->services) {
        impl_->services->set_clipboard_provider(std::move(provider));
    }
}

void CoreServer::notify_open_paths(const std::vector<std::string>& paths) {
    impl_->post([this, paths] {
        if (impl_->transport != nullptr) {
            impl_->transport->notify_open_paths(paths);
        }
    });
}

void CoreServer::stop() {
    impl_->request_stop();
}

void CoreServer::wait() {
    if (!impl_->thread_started.load() || std::this_thread::get_id() == impl_->loop_thread_id) {
        return;  // nothing to wait for / never block the loop thread on itself
    }
    impl_->finished.wait();
}

bool CoreServer::stopped() const {
    if (!impl_->thread_started.load()) {
        return true;
    }
    return impl_->finished.wait_for(std::chrono::seconds(0)) == std::future_status::ready;
}

}  // namespace mfbe
