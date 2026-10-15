// Linux file dialogs through the system's GTK 3, loaded at run time (no build dependency; in the
// browser process Chromium has normally loaded and initialised it already):
// GtkFileChooserNative, which uses the desktop portal where GTK decides to, with the named types
// (patterns that ignore letter case) and the selected one active, the folder and name of the
// request, multi-selection and the encoding choice of Save As. Asynchronous on the CEF UI
// thread - the main thread, whose GLib message loop dispatches GTK's events. The dialog is modal;
// under X11 it is also made transient for the editor window, which is not a GTK window, so the
// window manager keeps it above the editor and gives it the keyboard.
#include "file_dialog_platform.h"

#if defined(__linux__)

#include <algorithm>
#include <dlfcn.h>
#include <string>
#include <utility>
#include <vector>

namespace mfbe::shell {

namespace {

// Opaque GTK, GDK and GLib types; signatures as in the C headers (gboolean is int, GType is
// unsigned long, GCallback is void (*)(void)).
struct GSList {
    void* data;
    GSList* next;
};
struct GList {
    void* data;
    GList* next;
    GList* prev;
};
using GCallback = void (*)();

constexpr int kActionOpen = 0;            // GTK_FILE_CHOOSER_ACTION_OPEN
constexpr int kActionSave = 1;            // GTK_FILE_CHOOSER_ACTION_SAVE
constexpr int kActionSelectFolder = 2;    // GTK_FILE_CHOOSER_ACTION_SELECT_FOLDER
constexpr int kResponseAccept = -3;       // GTK_RESPONSE_ACCEPT
constexpr int kWindowStateWithdrawn = 1;  // GDK_WINDOW_STATE_WITHDRAWN
constexpr const char* kEncodingChoice = "encoding";

struct GtkApi {
    int (*gtk_init_check)(int*, char***) = nullptr;
    void* (*gtk_file_chooser_native_new)(const char*, void*, int, const char*,
                                         const char*) = nullptr;
    void (*gtk_native_dialog_set_modal)(void*, int) = nullptr;
    void (*gtk_native_dialog_show)(void*) = nullptr;
    void (*gtk_native_dialog_hide)(void*) = nullptr;
    void* (*gtk_file_filter_new)() = nullptr;
    void (*gtk_file_filter_set_name)(void*, const char*) = nullptr;
    const char* (*gtk_file_filter_get_name)(void*) = nullptr;
    void (*gtk_file_filter_add_pattern)(void*, const char*) = nullptr;
    void (*gtk_file_chooser_add_filter)(void*, void*) = nullptr;
    void (*gtk_file_chooser_set_filter)(void*, void*) = nullptr;
    void* (*gtk_file_chooser_get_filter)(void*) = nullptr;
    GSList* (*gtk_file_chooser_list_filters)(void*) = nullptr;
    int (*gtk_file_chooser_set_current_folder)(void*, const char*) = nullptr;
    void (*gtk_file_chooser_set_current_name)(void*, const char*) = nullptr;
    void (*gtk_file_chooser_set_select_multiple)(void*, int) = nullptr;
    void (*gtk_file_chooser_set_do_overwrite_confirmation)(void*, int) = nullptr;
    GSList* (*gtk_file_chooser_get_filenames)(void*) = nullptr;
    unsigned long (*g_signal_connect_data)(void*, const char*, GCallback, void*, void*,
                                           int) = nullptr;
    void (*g_object_unref)(void*) = nullptr;
    void (*g_free)(void*) = nullptr;
    void (*g_slist_free)(GSList*) = nullptr;
    // The encoding choice (GTK 3.22 and newer).
    void (*gtk_file_chooser_add_choice)(void*, const char*, const char*, const char**,
                                        const char**) = nullptr;
    void (*gtk_file_chooser_set_choice)(void*, const char*, const char*) = nullptr;
    const char* (*gtk_file_chooser_get_choice)(void*, const char*) = nullptr;
    // The chooser's own dialog window (not with the portal): above the editor under X11.
    GList* (*gtk_window_list_toplevels)() = nullptr;
    void (*g_list_free)(GList*) = nullptr;
    unsigned long (*gtk_file_chooser_dialog_get_type)() = nullptr;
    int (*g_type_check_instance_is_a)(void*, unsigned long) = nullptr;
    void* (*gtk_widget_get_window)(void*) = nullptr;
    int (*gdk_window_get_state)(void*) = nullptr;
    void* (*gdk_display_get_default)() = nullptr;
    unsigned long (*gdk_x11_display_get_type)() = nullptr;
    void* (*gdk_x11_window_foreign_new_for_display)(void*, unsigned long) = nullptr;
    void (*gdk_window_set_transient_for)(void*, void*) = nullptr;

    bool complete() const {
        return gtk_init_check && gtk_file_chooser_native_new && gtk_native_dialog_set_modal &&
               gtk_native_dialog_show && gtk_native_dialog_hide && gtk_file_filter_new &&
               gtk_file_filter_set_name && gtk_file_filter_get_name &&
               gtk_file_filter_add_pattern && gtk_file_chooser_add_filter &&
               gtk_file_chooser_set_filter && gtk_file_chooser_get_filter &&
               gtk_file_chooser_list_filters && gtk_file_chooser_set_current_folder &&
               gtk_file_chooser_set_current_name && gtk_file_chooser_set_select_multiple &&
               gtk_file_chooser_set_do_overwrite_confirmation && gtk_file_chooser_get_filenames &&
               g_signal_connect_data && g_object_unref && g_free && g_slist_free;
    }
    bool offersChoices() const {
        return gtk_file_chooser_add_choice && gtk_file_chooser_set_choice &&
               gtk_file_chooser_get_choice;
    }
    bool findsDialogWindow() const {
        return gtk_window_list_toplevels && g_list_free && gtk_file_chooser_dialog_get_type &&
               g_type_check_instance_is_a && gtk_widget_get_window && gdk_window_get_state;
    }
    bool keepsAboveX11Windows() const {
        return gdk_display_get_default && gdk_x11_display_get_type &&
               gdk_x11_window_foreign_new_for_display && gdk_window_set_transient_for;
    }
};

template <typename Fn>
void resolve(void* handle, const char* name, Fn* out) {
    *out = reinterpret_cast<Fn>(::dlsym(handle, name));
}

void resolveAll(void* handle, GtkApi& api) {
    resolve(handle, "gtk_init_check", &api.gtk_init_check);
    resolve(handle, "gtk_file_chooser_native_new", &api.gtk_file_chooser_native_new);
    resolve(handle, "gtk_native_dialog_set_modal", &api.gtk_native_dialog_set_modal);
    resolve(handle, "gtk_native_dialog_show", &api.gtk_native_dialog_show);
    resolve(handle, "gtk_native_dialog_hide", &api.gtk_native_dialog_hide);
    resolve(handle, "gtk_file_filter_new", &api.gtk_file_filter_new);
    resolve(handle, "gtk_file_filter_set_name", &api.gtk_file_filter_set_name);
    resolve(handle, "gtk_file_filter_get_name", &api.gtk_file_filter_get_name);
    resolve(handle, "gtk_file_filter_add_pattern", &api.gtk_file_filter_add_pattern);
    resolve(handle, "gtk_file_chooser_add_filter", &api.gtk_file_chooser_add_filter);
    resolve(handle, "gtk_file_chooser_set_filter", &api.gtk_file_chooser_set_filter);
    resolve(handle, "gtk_file_chooser_get_filter", &api.gtk_file_chooser_get_filter);
    resolve(handle, "gtk_file_chooser_list_filters", &api.gtk_file_chooser_list_filters);
    resolve(handle, "gtk_file_chooser_set_current_folder",
            &api.gtk_file_chooser_set_current_folder);
    resolve(handle, "gtk_file_chooser_set_current_name", &api.gtk_file_chooser_set_current_name);
    resolve(handle, "gtk_file_chooser_set_select_multiple",
            &api.gtk_file_chooser_set_select_multiple);
    resolve(handle, "gtk_file_chooser_set_do_overwrite_confirmation",
            &api.gtk_file_chooser_set_do_overwrite_confirmation);
    resolve(handle, "gtk_file_chooser_get_filenames", &api.gtk_file_chooser_get_filenames);
    resolve(handle, "g_signal_connect_data", &api.g_signal_connect_data);
    resolve(handle, "g_object_unref", &api.g_object_unref);
    resolve(handle, "g_free", &api.g_free);
    resolve(handle, "g_slist_free", &api.g_slist_free);
    resolve(handle, "gtk_file_chooser_add_choice", &api.gtk_file_chooser_add_choice);
    resolve(handle, "gtk_file_chooser_set_choice", &api.gtk_file_chooser_set_choice);
    resolve(handle, "gtk_file_chooser_get_choice", &api.gtk_file_chooser_get_choice);
    resolve(handle, "gtk_window_list_toplevels", &api.gtk_window_list_toplevels);
    resolve(handle, "g_list_free", &api.g_list_free);
    resolve(handle, "gtk_file_chooser_dialog_get_type", &api.gtk_file_chooser_dialog_get_type);
    resolve(handle, "g_type_check_instance_is_a", &api.g_type_check_instance_is_a);
    resolve(handle, "gtk_widget_get_window", &api.gtk_widget_get_window);
    resolve(handle, "gdk_window_get_state", &api.gdk_window_get_state);
    resolve(handle, "gdk_display_get_default", &api.gdk_display_get_default);
    resolve(handle, "gdk_x11_display_get_type", &api.gdk_x11_display_get_type);
    resolve(handle, "gdk_x11_window_foreign_new_for_display",
            &api.gdk_x11_window_foreign_new_for_display);
    resolve(handle, "gdk_window_set_transient_for", &api.gdk_window_set_transient_for);
}

// GTK 3 once per process (UI thread only); null, with the reason, when it cannot be used.
const GtkApi* gtkApi(std::string* why) {
    static GtkApi api;
    static bool attempted = false;
    static bool usable = false;
    static std::string failure;
    if (!attempted) {
        attempted = true;
        // GTK 3 and GTK 4 cannot share a process: never load GTK 3 next to a GTK 4 that
        // Chromium may have chosen.
        if (void* gtk4 = ::dlopen("libgtk-4.so.1", RTLD_LAZY | RTLD_NOLOAD)) {
            ::dlclose(gtk4);
            failure = "GTK 4 is loaded in the process";
        } else {
            void* handle = ::dlopen("libgtk-3.so.0", RTLD_NOW | RTLD_NOLOAD);
            if (handle == nullptr) {
                handle = ::dlopen("libgtk-3.so.0", RTLD_NOW | RTLD_GLOBAL);
            }
            if (handle == nullptr) {
                const char* error = ::dlerror();
                failure = std::string("libgtk-3.so.0 cannot be loaded") +
                          (error != nullptr ? std::string(": ") + error : std::string());
            } else {
                resolveAll(handle, api);
                int argc = 0;
                if (!api.complete()) {
                    failure = "libgtk-3.so.0 has no GtkFileChooserNative (GTK 3.20 or newer)";
                } else if (!api.gtk_init_check(&argc, nullptr)) {
                    failure = "GTK 3 cannot open the display";
                } else {
                    usable = true;
                }
            }
        }
    }
    if (!usable && why != nullptr) {
        *why = failure;
    }
    return usable ? &api : nullptr;
}

std::vector<void*> toplevels(const GtkApi& api) {
    std::vector<void*> windows;
    if (!api.findsDialogWindow()) {
        return windows;
    }
    GList* list = api.gtk_window_list_toplevels();
    for (GList* item = list; item != nullptr; item = item->next) {
        windows.push_back(item->data);
    }
    api.g_list_free(list);
    return windows;
}

// The GtkFileChooserDialog created with the chooser: a toplevel that did not exist before.
void* chooserWindow(const GtkApi& api, const std::vector<void*>& before) {
    for (void* window : toplevels(api)) {
        if (std::find(before.begin(), before.end(), window) == before.end() &&
            api.g_type_check_instance_is_a(window, api.gtk_file_chooser_dialog_get_type())) {
            return window;
        }
    }
    return nullptr;
}

// Makes the shown dialog transient for the editor's X11 window (nothing under Wayland or when
// the portal shows the dialog in another process).
void keepAbove(const GtkApi& api, void* window_widget, std::uintptr_t owner) {
    if (owner == 0 || window_widget == nullptr || !api.keepsAboveX11Windows()) {
        return;
    }
    void* display = api.gdk_display_get_default();
    void* window = api.gtk_widget_get_window(window_widget);
    if (display == nullptr || window == nullptr ||
        !api.g_type_check_instance_is_a(display, api.gdk_x11_display_get_type())) {
        return;
    }
    void* editor =
        api.gdk_x11_window_foreign_new_for_display(display, static_cast<unsigned long>(owner));
    if (editor != nullptr) {
        api.gdk_window_set_transient_for(window, editor);
        api.g_object_unref(editor);
    }
}

struct OpenDialog {
    const GtkApi* api = nullptr;
    void* chooser = nullptr;        // GtkFileChooserNative
    void* window_widget = nullptr;  // its GtkFileChooserDialog; null with the portal
    bool offers_encodings = false;
    FileDialogCallback done;
};

OpenDialog* g_open_dialog = nullptr;  // UI thread only

void finish(OpenDialog* dialog, FileDialogResult result) {
    if (g_open_dialog == dialog) {
        g_open_dialog = nullptr;
    }
    FileDialogCallback done = std::move(dialog->done);
    dialog->api->g_object_unref(dialog->chooser);
    delete dialog;
    if (done) {
        done(std::move(result));
    }
}

void onResponse(void* chooser, int response, void* data) {
    auto* dialog = static_cast<OpenDialog*>(data);
    const GtkApi& api = *dialog->api;
    FileDialogResult result;
    if (response == kResponseAccept) {
        GSList* names = api.gtk_file_chooser_get_filenames(chooser);
        for (GSList* item = names; item != nullptr; item = item->next) {
            if (item->data != nullptr) {
                result.paths.emplace_back(static_cast<const char*>(item->data));
                api.g_free(item->data);
            }
        }
        if (names != nullptr) {
            api.g_slist_free(names);
        }
        if (dialog->offers_encodings) {
            if (const char* encoding = api.gtk_file_chooser_get_choice(chooser, kEncodingChoice)) {
                result.encoding = encoding;
            }
        }
    }
    result.cancelled = result.paths.empty();
    finish(dialog, std::move(result));
}

int chooserAction(FileDialogMode mode) {
    switch (mode) {
        case FileDialogMode::kSave:
            return kActionSave;
        case FileDialogMode::kFolder:
            return kActionSelectFolder;
        case FileDialogMode::kOpen:
        case FileDialogMode::kOpenMultiple:
        default:
            return kActionOpen;
    }
}

void addTypes(const GtkApi& api, void* chooser, const FileDialogRequest& request) {
    std::vector<void*> types;
    for (const auto& filter : request.filters) {
        void* type = api.gtk_file_filter_new();
        api.gtk_file_filter_set_name(type, filter.name.c_str());
        for (const auto& pattern : gtkPatterns(filter)) {
            api.gtk_file_filter_add_pattern(type, pattern.c_str());
        }
        api.gtk_file_chooser_add_filter(chooser, type);
        types.push_back(type);
    }
    if (!types.empty()) {
        api.gtk_file_chooser_set_filter(chooser, types[selectedFilterIndex(request)]);
    }
}

// Save As: the folder and name of the current file, or the request's folder and name; Open:
// the request's folder. Paths are passed as their bytes (GLib's file name encoding on Linux).
void place(const GtkApi& api, void* chooser, const FileDialogRequest& request) {
    if (request.mode != FileDialogMode::kSave) {
        if (!request.folder.empty()) {
            api.gtk_file_chooser_set_current_folder(chooser, request.folder.c_str());
        }
        return;
    }
    const SavePlace target = savePlace(request);
    if (!target.folder.empty()) {
        api.gtk_file_chooser_set_current_folder(chooser, target.folder.c_str());
    }
    if (!target.name.empty()) {
        api.gtk_file_chooser_set_current_name(chooser, target.name.c_str());
    }
}

bool addEncodings(const GtkApi& api, void* chooser, const FileDialogRequest& request) {
    if (request.mode != FileDialogMode::kSave || request.encodings.empty() ||
        !api.offersChoices()) {
        return false;
    }
    std::vector<const char*> options;
    for (const auto& encoding : request.encodings) {
        options.push_back(encoding.c_str());
    }
    options.push_back(nullptr);
    api.gtk_file_chooser_add_choice(chooser, kEncodingChoice, request.encoding_label.c_str(),
                                    options.data(), options.data());
    api.gtk_file_chooser_set_choice(chooser, kEncodingChoice, request.encodings.front().c_str());
    return true;
}

}  // namespace

bool runPlatformFileDialog(std::uintptr_t owner, const FileDialogRequest& request,
                           FileDialogCallback done, std::string* why) {
    const GtkApi* api = gtkApi(why);
    if (api == nullptr) {
        return false;
    }
    if (g_open_dialog != nullptr) {
        done(FileDialogResult{});  // one file dialog at a time: the open one stays
        return true;
    }
    const std::vector<void*> before = toplevels(*api);
    void* chooser =
        api->gtk_file_chooser_native_new(request.title.empty() ? nullptr : request.title.c_str(),
                                         nullptr, chooserAction(request.mode), nullptr, nullptr);
    if (chooser == nullptr) {
        if (why != nullptr) {
            *why = "GTK could not create the file chooser";
        }
        return false;
    }
    api->gtk_native_dialog_set_modal(chooser, 1);
    if (request.mode == FileDialogMode::kOpenMultiple) {
        api->gtk_file_chooser_set_select_multiple(chooser, 1);
    }
    if (request.mode == FileDialogMode::kSave) {
        api->gtk_file_chooser_set_do_overwrite_confirmation(chooser, 1);
    }
    if (request.mode != FileDialogMode::kFolder) {
        addTypes(*api, chooser, request);
    }
    place(*api, chooser, request);

    auto* dialog = new OpenDialog;
    dialog->api = api;
    dialog->chooser = chooser;
    dialog->window_widget = api->findsDialogWindow() ? chooserWindow(*api, before) : nullptr;
    dialog->offers_encodings = addEncodings(*api, chooser, request);
    dialog->done = std::move(done);
    api->g_signal_connect_data(chooser, "response", reinterpret_cast<GCallback>(&onResponse),
                               dialog, nullptr, 0);
    g_open_dialog = dialog;
    api->gtk_native_dialog_show(chooser);
    keepAbove(*api, dialog->window_widget, owner);
    return true;
}

bool describeOpenGtkFileDialog(std::vector<std::string>* type_names, std::string* active_type,
                               bool* shown) {
    if (g_open_dialog == nullptr) {
        return false;
    }
    const GtkApi& api = *g_open_dialog->api;
    void* chooser = g_open_dialog->chooser;
    GSList* types = api.gtk_file_chooser_list_filters(chooser);
    for (GSList* item = types; item != nullptr; item = item->next) {
        const char* name = api.gtk_file_filter_get_name(item->data);
        type_names->push_back(name != nullptr ? name : "");
    }
    if (types != nullptr) {
        api.g_slist_free(types);
    }
    void* active = api.gtk_file_chooser_get_filter(chooser);
    const char* name = active != nullptr ? api.gtk_file_filter_get_name(active) : nullptr;
    *active_type = name != nullptr ? name : "";
    // Shown = GDK has processed the window's map notification from the X server, which needs
    // the GLib loop of the UI thread to dispatch GTK's events.
    void* window = g_open_dialog->window_widget != nullptr
                       ? api.gtk_widget_get_window(g_open_dialog->window_widget)
                       : nullptr;
    *shown = window != nullptr && (api.gdk_window_get_state(window) & kWindowStateWithdrawn) == 0;
    return true;
}

bool cancelOpenGtkFileDialog() {
    if (g_open_dialog == nullptr) {
        return false;
    }
    OpenDialog* dialog = g_open_dialog;
    dialog->api->gtk_native_dialog_hide(dialog->chooser);  // hiding emits no response
    finish(dialog, FileDialogResult{});
    return true;
}

}  // namespace mfbe::shell

#endif  // __linux__
