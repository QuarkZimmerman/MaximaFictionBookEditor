// Internal: everything RPC handlers need, bundled (not part of the public API).
#pragma once

#include <mfbe/clipboard_provider.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/dialog_provider.hpp>
#include <mfbe/document_session.hpp>
#include <mfbe/exclusions.hpp>
#include <mfbe/file_watch.hpp>
#include <mfbe/genres.hpp>
#include <mfbe/hotkeys.hpp>
#include <mfbe/images.hpp>
#include <mfbe/keyboard_layout_provider.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/positions.hpp>
#include <mfbe/recent_files.hpp>
#include <mfbe/resource_tables.hpp>
#include <mfbe/resources.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/scripts.hpp>
#include <mfbe/settings.hpp>
#include <mfbe/spell.hpp>

#include <chrono>
#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>

namespace mfbe::server {

struct Services {
    CoreServerOptions options;
    platform::Dirs dirs;
    std::filesystem::path resources_dir;
    std::filesystem::path scripts_dir;
    bool test_hooks = false;

    settings::SettingsStore settings;
    settings::RecentFiles recent;
    // The remembered positions record (feature 004 US8), beside recent.json.
    settings::Positions positions;
    settings::ExclusionList exclusions;
    settings::HotkeysStore hotkeys;
    resources::ResourceLayers layers;
    session::DocumentRegistry documents;

    rpc::Notifier& notifier;
    rpc::JobManager jobs;
    std::unique_ptr<platform::FileWatcher> watcher;  // doc.watch polling (created on demand)

    // Spell checking (US6): dictionaries through the layers, Hunspell instances, custom.dic.
    std::unique_ptr<spell::SpellService> spell;
    // Scaled image previews (US7), shared by every document (keyed by docId + binary id).
    images::PreviewCache previews;

    std::chrono::steady_clock::time_point started_at = std::chrono::steady_clock::now();
    int port = 0;
    std::string token;

    // Runs `fn` on the transport (loop) thread; returns false when the server is gone.
    std::function<bool(std::function<void()>)> post;
    // Requests an orderly shutdown (app.quit).
    std::function<void()> request_quit;
    // The shell's relaunch (app.restart, feature 003 US3): CoreServerOptions::on_restart; unset
    // without a shell (1070 app.restartUnavailable).
    std::function<RestartOutcome(const std::optional<std::string>& reopen)> request_restart;

    // Dialog provider (set from any thread).
    std::shared_ptr<DialogProvider> dialog_provider() const;
    void set_dialog_provider(std::shared_ptr<DialogProvider> provider);
    std::shared_ptr<QueuedDialogProvider> queued_dialogs;  // only with test hooks
    // Clipboard provider (shell-delegated image paste; null in headless mode).
    std::shared_ptr<ClipboardProvider> clipboard_provider() const;
    void set_clipboard_provider(std::shared_ptr<ClipboardProvider> provider);
    std::shared_ptr<QueuedClipboardProvider> queued_clipboard;  // only with test hooks
    // Keyboard layout provider (feature 004 US11; shell-delegated switch at a document open;
    // null in headless mode without test hooks -> the "noShell" / "unsupported" results).
    std::shared_ptr<KeyboardLayoutProvider> keyboard_layouts() const;
    void set_keyboard_layout_provider(std::shared_ptr<KeyboardLayoutProvider> provider);
    std::shared_ptr<RecordingKeyboardLayoutProvider> recording_layouts;  // only with test hooks

    Services(CoreServerOptions opts, platform::Dirs dirs_, std::filesystem::path resources,
             std::filesystem::path scripts, rpc::Notifier& notifier_);
    ~Services();

    // Recomputes the resource layer roots from the current settings/dirs.
    void refresh_layers();
    // Rebuilds the effective genre catalogue (schema + bundled + user layers) and installs it
    // as the validator's genre check. Thread-safe.
    void refresh_genres();
    std::shared_ptr<const genres::GenreCatalog> genre_catalog() const;
    // Rebuilds the script package catalogue from the layers (US12). Thread-safe.
    void refresh_scripts();
    std::shared_ptr<const scripts::Catalog> script_catalog() const;  // null until refreshed
    // Bundled lookup tables (loaded on first use).
    const resources::LanguageTable& languages();
    const std::vector<resources::SymbolEntry>& symbols();
    // Image conversion policy from the current settings (other.pasteImageFormat/jpegQuality).
    images::ConversionPolicy conversion_policy() const;
    std::int64_t uptime_ms() const;

private:
    mutable std::mutex dialog_mutex_;
    std::shared_ptr<DialogProvider> dialogs_;
    std::shared_ptr<ClipboardProvider> clipboard_;
    std::shared_ptr<KeyboardLayoutProvider> keyboard_layouts_;
    mutable std::mutex genres_mutex_;
    std::shared_ptr<const genres::GenreCatalog> genres_;
    mutable std::mutex scripts_mutex_;
    std::shared_ptr<const scripts::Catalog> scripts_;
    std::optional<resources::LanguageTable> languages_;
    std::optional<std::vector<resources::SymbolEntry>> symbols_;
};

void register_app_handlers(rpc::RpcRouter& router, Services& services);
void register_log_handlers(rpc::RpcRouter& router, Services& services);
void register_settings_handlers(rpc::RpcRouter& router, Services& services);
void register_dialog_handlers(rpc::RpcRouter& router, Services& services);
void register_doc_handlers(rpc::RpcRouter& router, Services& services);
// doc.fragmentToXml / doc.fragmentFromXml (feature 005); called by register_doc_handlers.
void register_fragment_handlers(rpc::RpcRouter& router, Services& services);
void register_binary_handlers(rpc::RpcRouter& router, Services& services);
void register_resources_handlers(rpc::RpcRouter& router, Services& services);
void register_spell_handlers(rpc::RpcRouter& router, Services& services);
void register_words_handlers(rpc::RpcRouter& router, Services& services);
void register_scripts_handlers(rpc::RpcRouter& router, Services& services);
void register_system_handlers(rpc::RpcRouter& router, Services& services);
// Lazily creates the external-change watcher (emits doc.changedOnDisk through the notifier).
platform::FileWatcher& file_watcher(Services& services);
// Opens a folder through the shell (dialog provider) or the OS opener; 1050 without a shell.
nlohmann::json open_folder_with_shell(Services& services, const std::filesystem::path& path);
#ifdef MFBE_TEST_HOOKS
void register_test_handlers(rpc::RpcRouter& router, Services& services);
#endif

}  // namespace mfbe::server
