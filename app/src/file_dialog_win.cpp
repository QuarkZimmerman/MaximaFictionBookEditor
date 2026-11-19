// Windows file dialogs: the Common Item Dialog (IFileOpenDialog / IFileSaveDialog), as the
// original editor's dialogs (mainfrm.cpp, GetOpenFileName / GetSaveFileName): the named types
// with the selected one active, one client GUID for Open and Save As of documents so both
// remember one folder, the folder and name of the request, multi-selection, folder picking and
// the encoding combo of Save As through IFileDialogCustomize. Modal to the editor window, shown
// on the CEF UI thread (a single-threaded COM apartment).
#include "file_dialog_platform.h"

#if defined(_WIN32)

// clang-format off: windows.h first, the shell headers depend on it
#include <windows.h>

#include <objbase.h>
#include <shlobj.h>
#include <shobjidl.h>
// clang-format on

#include <mfbe/utf8_paths.hpp>

#include <cstdio>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

namespace mfbe::shell {

namespace {

// Client GUID of the document dialogs (Open and Save As), the role GUID_FB2Dialog played in the
// original; a value of its own, so the two editors remember separate folders.
// {ACAE353F-AF25-4F21-A413-5865FB64FBCF}
constexpr GUID kDocumentDialogsGuid = {
    0xacae353f, 0xaf25, 0x4f21, {0xa4, 0x13, 0x58, 0x65, 0xfb, 0x64, 0xfb, 0xcf}};

// Ids of the encoding group and combo, as the original (items: kEncodingItemBase + index).
constexpr DWORD kEncodingGroup = 1000;
constexpr DWORD kEncodingCombo = 1001;
constexpr DWORD kZipCheck = 1002;  // feature 009 (DP-8): "save as ZIP archive"

// Releases a COM interface when it goes out of scope.
template <typename T>
class ComRef {
public:
    ComRef() = default;
    ~ComRef() { reset(); }
    ComRef(const ComRef&) = delete;
    ComRef& operator=(const ComRef&) = delete;

    T* get() const { return ptr_; }
    T* operator->() const { return ptr_; }
    T** put() {
        reset();
        return &ptr_;
    }

private:
    void reset() {
        if (ptr_ != nullptr) {
            ptr_->Release();
            ptr_ = nullptr;
        }
    }

    T* ptr_ = nullptr;
};

// COM for this thread: Chromium's UI thread already is a single-threaded apartment, so this
// only counts it up (and down again).
class ComApartment {
public:
    ComApartment() : result_(::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)) {}
    ~ComApartment() {
        if (SUCCEEDED(result_)) {
            ::CoUninitialize();
        }
    }
    ComApartment(const ComApartment&) = delete;
    ComApartment& operator=(const ComApartment&) = delete;

private:
    HRESULT result_;
};

// UTF-8 text (titles, type names, encodings, a file name) as UTF-16.
std::wstring wideText(const std::string& utf8) {
    if (utf8.empty()) {
        return {};
    }
    const int length =
        ::MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
    if (length <= 0) {
        return {};
    }
    std::wstring wide(static_cast<size_t>(length), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), wide.data(),
                          length);
    return wide;
}

bool shellItem(const std::string& utf8_path, ComRef<IShellItem>& item) {
    const std::wstring path = mfbe::platform::path_from_utf8(utf8_path).wstring();
    return SUCCEEDED(
        ::SHCreateItemFromParsingName(path.c_str(), nullptr, IID_PPV_ARGS(item.put())));
}

std::string itemPath(IShellItem* item) {
    PWSTR path = nullptr;
    if (FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) || path == nullptr) {
        return {};
    }
    std::string utf8 = mfbe::platform::utf8_from_path(
        std::filesystem::path(path));  // path-text: a wide path from the Windows API
    ::CoTaskMemFree(path);
    return utf8;
}

// The file name and type follow the ZIP box while the dialog is open (the requester after his smoke
// test of 0.0.12-rc.4): its toggle renames the file and selects the ZIP type or the plain one;
// choosing the ZIP type ticks the box, another type unticks it. The dialog holds the object while
// it is advised (IFileDialog::Advise); its control events reach it through QueryInterface.
class ZipFollower final : public IFileDialogEvents, public IFileDialogControlEvents {
public:
    explicit ZipFollower(const FileDialogRequest& request) : request_(request) {
        plain_ = request;
        plain_.selected_filter = static_cast<int>(zipFollowFilter(request, false));
    }
    ZipFollower(const ZipFollower&) = delete;
    ZipFollower& operator=(const ZipFollower&) = delete;

    IFACEMETHODIMP QueryInterface(REFIID riid, void** object) override {
        if (object == nullptr) {
            return E_POINTER;
        }
        if (riid == IID_IUnknown || riid == __uuidof(IFileDialogEvents)) {
            *object = static_cast<IFileDialogEvents*>(this);
        } else if (riid == __uuidof(IFileDialogControlEvents)) {
            *object = static_cast<IFileDialogControlEvents*>(this);
        } else {
            *object = nullptr;
            return E_NOINTERFACE;
        }
        AddRef();
        return S_OK;
    }
    IFACEMETHODIMP_(ULONG) AddRef() override {
        return static_cast<ULONG>(::InterlockedIncrement(&refs_));
    }
    IFACEMETHODIMP_(ULONG) Release() override {
        const LONG left = ::InterlockedDecrement(&refs_);
        if (left == 0) {
            delete this;
        }
        return static_cast<ULONG>(left);
    }

    // IFileDialogEvents: only a type change matters; the rest keeps the dialog's own behaviour.
    IFACEMETHODIMP OnFileOk(IFileDialog*) override { return S_OK; }
    IFACEMETHODIMP OnFolderChanging(IFileDialog*, IShellItem*) override { return S_OK; }
    IFACEMETHODIMP OnFolderChange(IFileDialog*) override { return S_OK; }
    IFACEMETHODIMP OnSelectionChange(IFileDialog*) override { return S_OK; }
    IFACEMETHODIMP OnShareViolation(IFileDialog*, IShellItem*,
                                    FDE_SHAREVIOLATION_RESPONSE*) override {
        return E_NOTIMPL;
    }
    IFACEMETHODIMP OnTypeChange(IFileDialog* dialog) override {
        UINT type = 0;
        if (following_ || request_.zip_filter < 0 || FAILED(dialog->GetFileTypeIndex(&type)) ||
            type == 0) {
            return S_OK;
        }
        const bool zip = static_cast<int>(type) - 1 == request_.zip_filter;
        ComRef<IFileDialogCustomize> customize;
        if (FAILED(dialog->QueryInterface(IID_PPV_ARGS(customize.put())))) {
            return S_OK;
        }
        BOOL checked = FALSE;
        customize->GetCheckButtonState(kZipCheck, &checked);
        if ((checked == TRUE) != zip) {
            following_ = true;
            customize->SetCheckButtonState(kZipCheck, zip ? TRUE : FALSE);
            rename(dialog, zip);
            following_ = false;
        }
        return S_OK;
    }
    IFACEMETHODIMP OnOverwrite(IFileDialog*, IShellItem*, FDE_OVERWRITE_RESPONSE*) override {
        return E_NOTIMPL;
    }

    // IFileDialogControlEvents: the ZIP box's toggle.
    IFACEMETHODIMP OnItemSelected(IFileDialogCustomize*, DWORD, DWORD) override { return S_OK; }
    IFACEMETHODIMP OnButtonClicked(IFileDialogCustomize*, DWORD) override { return S_OK; }
    IFACEMETHODIMP OnCheckButtonToggled(IFileDialogCustomize* customize, DWORD id,
                                        BOOL checked) override {
        if (following_ || id != kZipCheck) {
            return S_OK;
        }
        ComRef<IFileDialog> dialog;
        if (FAILED(customize->QueryInterface(IID_PPV_ARGS(dialog.put())))) {
            return S_OK;
        }
        const bool zip = checked == TRUE;
        following_ = true;
        rename(dialog.get(), zip);
        if (request_.zip_filter >= 0) {
            dialog->SetFileTypeIndex(static_cast<UINT>(zipFollowFilter(request_, zip) + 1));
        }
        following_ = false;
        return S_OK;
    }
    IFACEMETHODIMP OnControlActivating(IFileDialogCustomize*, DWORD) override { return S_OK; }

private:
    ~ZipFollower() = default;

    void rename(IFileDialog* dialog, bool zip) {
        const std::string extension = zip ? std::string("zip") : defaultExtension(plain_);
        if (!extension.empty()) {
            dialog->SetDefaultExtension(wideText(extension).c_str());
        }
        PWSTR name = nullptr;
        if (FAILED(dialog->GetFileName(&name)) || name == nullptr) {
            return;
        }
        const std::string current = mfbe::platform::utf8_from_path(
            std::filesystem::path(name));  // path-text: a wide file name from the Windows API
        ::CoTaskMemFree(name);
        const std::string renamed = zipFollowName(request_, current, zip);
        if (renamed != current) {
            dialog->SetFileName(wideText(renamed).c_str());
        }
    }

    FileDialogRequest request_;
    FileDialogRequest plain_;  // the request with its plain type selected (its default extension)
    LONG refs_ = 1;
    bool following_ = false;  // a change made here: its own event is not followed again
};

// Open and Save As: the user's documents folder while the client GUID keeps no folder.
void defaultToDocuments(IFileDialog* dialog) {
    ComRef<IShellItem> documents;
    if (SUCCEEDED(::SHGetKnownFolderItem(FOLDERID_Documents, KF_FLAG_DEFAULT, nullptr,
                                         IID_PPV_ARGS(documents.put())))) {
        dialog->SetDefaultFolder(documents.get());
    }
}

void openIn(IFileDialog* dialog, const std::string& folder) {
    ComRef<IShellItem> item;
    if (!folder.empty() && shellItem(folder, item)) {
        dialog->SetFolder(item.get());
    }
}

// The proposed file: Save As shows the current file as the original's SetSaveAsItem did; other
// dialogs open on its folder with its name filled in (the original's dictionary dialog).
void placeFile(IFileDialog* dialog, const FileDialogRequest& request) {
    if (request.mode == FileDialogMode::kSave &&
        mfbe::platform::path_from_utf8(request.default_path).has_parent_path()) {
        ComRef<IShellItem> item;
        ComRef<IFileSaveDialog> save;
        if (shellItem(request.default_path, item) &&
            SUCCEEDED(dialog->QueryInterface(IID_PPV_ARGS(save.put()))) &&
            SUCCEEDED(save->SetSaveAsItem(item.get()))) {
            return;
        }
    }
    const ProposedFile file = proposedFile(request);
    openIn(dialog, file.folder);
    if (!file.name.empty()) {
        dialog->SetFileName(wideText(file.name).c_str());
    }
}

void collectResults(IFileDialog* dialog, const FileDialogRequest& request,
                    FileDialogResult& result) {
    if (request.mode == FileDialogMode::kOpenMultiple) {
        ComRef<IFileOpenDialog> open;
        ComRef<IShellItemArray> items;
        if (FAILED(dialog->QueryInterface(IID_PPV_ARGS(open.put()))) ||
            FAILED(open->GetResults(items.put()))) {
            return;
        }
        DWORD count = 0;
        items->GetCount(&count);
        for (DWORD i = 0; i < count; ++i) {
            ComRef<IShellItem> item;
            if (SUCCEEDED(items->GetItemAt(i, item.put()))) {
                std::string path = itemPath(item.get());
                if (!path.empty()) {
                    result.paths.push_back(std::move(path));
                }
            }
        }
        return;
    }
    ComRef<IShellItem> item;
    if (SUCCEEDED(dialog->GetResult(item.put()))) {
        std::string path = itemPath(item.get());
        if (!path.empty()) {
            result.paths.push_back(std::move(path));
        }
    }
}

bool showDialog(HWND owner, const FileDialogRequest& request, FileDialogResult& result,
                std::string* why) {
    const bool save = request.mode == FileDialogMode::kSave;
    ComRef<IFileDialog> dialog;
    const HRESULT created =
        save ? ::CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER,
                                  IID_PPV_ARGS(dialog.put()))
             : ::CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                                  IID_PPV_ARGS(dialog.put()));
    if (FAILED(created)) {
        if (why != nullptr) {
            char code[16];
            std::snprintf(code, sizeof(code), "0x%08lx", static_cast<unsigned long>(created));
            *why = std::string("the Common Item Dialog could not be created (") + code + ")";
        }
        return false;
    }

    FILEOPENDIALOGOPTIONS options = 0;
    dialog->GetOptions(&options);
    options |= FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
    switch (request.mode) {
        case FileDialogMode::kOpen:
            options |= FOS_FILEMUSTEXIST;
            break;
        case FileDialogMode::kOpenMultiple:
            options |= FOS_FILEMUSTEXIST | FOS_ALLOWMULTISELECT;
            break;
        case FileDialogMode::kSave:
            options |= FOS_OVERWRITEPROMPT;
            break;
        case FileDialogMode::kFolder:
            options |= FOS_PICKFOLDERS;
            break;
    }
    dialog->SetOptions(options);
    if (request.document_dialog) {
        dialog->SetClientGuid(kDocumentDialogsGuid);
        defaultToDocuments(dialog.get());
    }
    if (!request.title.empty()) {
        dialog->SetTitle(wideText(request.title).c_str());
    }

    // The type names and patterns stay alive until Show returns.
    std::vector<std::wstring> names;
    std::vector<std::wstring> specs;
    if (request.mode != FileDialogMode::kFolder) {
        for (const auto& filter : request.filters) {
            names.push_back(wideText(filter.name));
            specs.push_back(wideText(windowsFilterSpec(filter)));
        }
    }
    std::vector<COMDLG_FILTERSPEC> types;
    for (size_t i = 0; i < names.size(); ++i) {
        types.push_back(COMDLG_FILTERSPEC{names[i].c_str(), specs[i].c_str()});
    }
    if (!types.empty()) {
        dialog->SetFileTypes(static_cast<UINT>(types.size()), types.data());
        dialog->SetFileTypeIndex(windowsFileTypeIndex(request));
    }
    const std::string extension = defaultExtension(request);
    if (!extension.empty()) {
        dialog->SetDefaultExtension(wideText(extension).c_str());
    }

    placeFile(dialog.get(), request);

    ComRef<IFileDialogCustomize> customize;
    const bool offers_encodings = save && !request.encodings.empty() &&
                                  SUCCEEDED(dialog->QueryInterface(IID_PPV_ARGS(customize.put())));
    if (offers_encodings) {
        customize->StartVisualGroup(kEncodingGroup, wideText(request.encoding_label).c_str());
        customize->AddComboBox(kEncodingCombo);
        for (size_t i = 0; i < request.encodings.size(); ++i) {
            customize->AddControlItem(kEncodingCombo, static_cast<DWORD>(kEncodingItemBase + i),
                                      wideText(request.encodings[i]).c_str());
        }
        customize->SetSelectedControlItem(
            kEncodingCombo, static_cast<DWORD>(kEncodingItemBase + selectedEncodingIndex(request)));
        customize->EndVisualGroup();
    }
    // Feature 009 (DP-8): the ZIP checkbox, added the same way beside the encoding choice.
    const bool offers_zip = save && !request.zip_label.empty() &&
                            (customize.get() != nullptr ||
                             SUCCEEDED(dialog->QueryInterface(IID_PPV_ARGS(customize.put()))));
    if (offers_zip) {
        customize->AddCheckButton(kZipCheck, wideText(request.zip_label).c_str(),
                                  request.zip_checked ? TRUE : FALSE);
    }
    // Feature 017 (DP-5): further boxes, one check button each, ids after the ZIP box's.
    const bool offers_checks = save && !request.checks.empty() &&
                               (customize.get() != nullptr ||
                                SUCCEEDED(dialog->QueryInterface(IID_PPV_ARGS(customize.put()))));
    if (offers_checks) {
        for (size_t i = 0; i < request.checks.size(); ++i) {
            customize->AddCheckButton(static_cast<DWORD>(kZipCheck + 1 + i),
                                      wideText(request.checks[i].label).c_str(),
                                      request.checks[i].checked ? TRUE : FALSE);
        }
    }

    DWORD follower_cookie = 0;
    bool following = false;
    if (offers_zip && request.zip_rename != FileDialogRequest::ZipRename::kNone) {
        auto* follower = new ZipFollower(request);
        following = SUCCEEDED(dialog->Advise(follower, &follower_cookie));
        follower->Release();  // the dialog holds it while advised
    }
    const HRESULT shown = dialog->Show(owner);
    if (following) {
        dialog->Unadvise(follower_cookie);
    }
    if (FAILED(shown)) {
        return true;  // cancelled (ERROR_CANCELLED) or not shown: no file
    }
    collectResults(dialog.get(), request, result);
    if (offers_encodings) {
        DWORD item = 0;
        if (SUCCEEDED(customize->GetSelectedControlItem(kEncodingCombo, &item))) {
            result.encoding = encodingOfItem(request, item);
        }
    }
    if (offers_zip) {
        BOOL checked = FALSE;
        if (SUCCEEDED(customize->GetCheckButtonState(kZipCheck, &checked))) {
            result.zip = checked ? 1 : 0;
        }
    }
    if (offers_checks) {
        for (size_t i = 0; i < request.checks.size(); ++i) {
            BOOL checked = request.checks[i].checked ? TRUE : FALSE;
            customize->GetCheckButtonState(static_cast<DWORD>(kZipCheck + 1 + i), &checked);
            result.checks.emplace_back(request.checks[i].id, checked == TRUE);
        }
        result.checks_shown = true;
    }
    result.cancelled = result.paths.empty();
    return true;
}

}  // namespace

bool runPlatformFileDialog(std::uintptr_t owner, const FileDialogRequest& request,
                           FileDialogCallback done, std::string* why) {
    ComApartment apartment;
    HWND window = owner != 0 ? ::GetAncestor(reinterpret_cast<HWND>(owner), GA_ROOT) : nullptr;
    FileDialogResult result;
    if (!showDialog(window, request, result, why)) {
        return false;
    }
    done(std::move(result));
    return true;
}

}  // namespace mfbe::shell

#endif  // _WIN32
