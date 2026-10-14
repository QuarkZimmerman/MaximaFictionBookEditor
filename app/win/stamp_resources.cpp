// Build-time tool (Windows only): gives the renamed CEF bootstrap executable the editor's
// own icon, version information and manifest.
//
// With the Chromium sandbox the browser process is CEF's bootstrap.exe (renamed mfbe.exe),
// which loads the application DLL. Explorer, the Start menu, the taskbar and "Open with"
// show the *executable's* resources, so without this step the editor would appear with the
// bootstrap's generic icon and CEF's version strings. Windows also reads the process manifest
// only from the executable: the editor's (app.manifest: UTF-8 as the process code page, DPI
// awareness, common controls, long paths) must be stamped into it, or the process runs with
// the legacy code page and paths with letters outside it break (feature 002, research R1).
//
//   mfbe_stamp_resources <exe> <icon.ico> [<module-with-VS_VERSION_INFO> [<app.manifest>]]
//   mfbe_stamp_resources --dump-manifest <exe>
//
// Replaces every RT_GROUP_ICON/RT_ICON resource of <exe> with the groups of <icon.ico>; when
// the third argument is given, every RT_VERSION resource with the one compiled into the
// application DLL (app.rc); when the fourth is given, every RT_MANIFEST resource with the
// manifest file as resource 1 (CREATEPROCESS_MANIFEST_RESOURCE_ID). --dump-manifest writes the
// executable's manifest resource 1 to stdout. Exit code 0 on success, 1 with a message on
// stderr otherwise.
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <io.h>
#include <string>
#include <vector>
#include <windows.h>

namespace {

#pragma pack(push, 2)
struct IconDir {
    WORD reserved;
    WORD type;
    WORD count;
};
struct IconDirEntryFile {
    BYTE width;
    BYTE height;
    BYTE colors;
    BYTE reserved;
    WORD planes;
    WORD bit_count;
    DWORD bytes;
    DWORD offset;
};
struct GrpIconDirEntry {
    BYTE width;
    BYTE height;
    BYTE colors;
    BYTE reserved;
    WORD planes;
    WORD bit_count;
    DWORD bytes;
    WORD id;
};
#pragma pack(pop)

constexpr WORD kLanguage = MAKELANGID(LANG_ENGLISH, SUBLANG_ENGLISH_US);  // as CEF's bootstrap
// CREATEPROCESS_MANIFEST_RESOURCE_ID (winuser.h defines it as a MAKEINTRESOURCE pointer).
constexpr WORD kProcessManifestId = 1;

struct ResourceName {
    bool numeric;
    WORD id;
    std::wstring name;
    LPCWSTR as_lpcwstr() const { return numeric ? MAKEINTRESOURCEW(id) : name.c_str(); }
};

struct ResourceEntry {
    ResourceName name;
    WORD language;
};

// Collects every (name, language) of a resource type so they can be removed first.
std::vector<ResourceEntry> collect(HMODULE module, LPCWSTR type) {
    struct State {
        HMODULE module;
        LPCWSTR type;
        std::vector<ResourceEntry> entries;
        ResourceName current;
    } state{module, type, {}, {}};
    EnumResourceNamesW(
        module, type,
        [](HMODULE, LPCWSTR, LPWSTR name, LONG_PTR param) -> BOOL {
            auto* s = reinterpret_cast<State*>(param);
            if (IS_INTRESOURCE(name)) {
                s->current =
                    ResourceName{true, static_cast<WORD>(reinterpret_cast<ULONG_PTR>(name)), L""};
            } else {
                s->current = ResourceName{false, 0, name};
            }
            EnumResourceLanguagesW(
                s->module, s->type, name,
                [](HMODULE, LPCWSTR, LPCWSTR, WORD language, LONG_PTR inner) -> BOOL {
                    auto* st = reinterpret_cast<State*>(inner);
                    st->entries.push_back(ResourceEntry{st->current, language});
                    return TRUE;
                },
                param);
            return TRUE;
        },
        reinterpret_cast<LONG_PTR>(&state));
    return state.entries;
}

std::vector<char> read_file(const std::wstring& path) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                              FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        return {};
    }
    std::vector<char> data;
    LARGE_INTEGER size{};
    if (GetFileSizeEx(file, &size) && size.QuadPart > 0 && size.QuadPart < (1LL << 30)) {
        data.resize(static_cast<std::size_t>(size.QuadPart));
        DWORD read = 0;
        if (!ReadFile(file, data.data(), static_cast<DWORD>(data.size()), &read, nullptr) ||
            read != data.size()) {
            data.clear();
        }
    }
    CloseHandle(file);
    return data;
}

bool fail(const char* message) {
    std::fprintf(stderr, "mfbe_stamp_resources: %s (error %lu)\n", message, GetLastError());
    return false;
}

bool remove_all(HANDLE update, LPCWSTR type, const std::vector<ResourceEntry>& entries) {
    for (const ResourceEntry& e : entries) {
        if (!UpdateResourceW(update, type, e.name.as_lpcwstr(), e.language, nullptr, 0)) {
            return fail("cannot remove an existing resource");
        }
    }
    return true;
}

bool stamp_icon(HANDLE update, const std::vector<char>& ico) {
    if (ico.size() < sizeof(IconDir)) {
        return fail("icon file too small");
    }
    IconDir dir{};
    std::memcpy(&dir, ico.data(), sizeof(dir));
    if (dir.reserved != 0 || dir.type != 1 || dir.count == 0) {
        return fail("not an .ico file");
    }
    const std::size_t table =
        sizeof(IconDir) + static_cast<std::size_t>(dir.count) * sizeof(IconDirEntryFile);
    if (ico.size() < table) {
        return fail("truncated icon directory");
    }
    std::vector<char> group(sizeof(IconDir) +
                            static_cast<std::size_t>(dir.count) * sizeof(GrpIconDirEntry));
    std::memcpy(group.data(), &dir, sizeof(dir));
    for (WORD i = 0; i < dir.count; ++i) {
        IconDirEntryFile entry{};
        std::memcpy(&entry, ico.data() + sizeof(IconDir) + i * sizeof(IconDirEntryFile),
                    sizeof(entry));
        if (entry.offset > ico.size() || entry.bytes > ico.size() - entry.offset) {
            return fail("icon image outside the file");
        }
        const WORD id = static_cast<WORD>(i + 1);
        if (!UpdateResourceW(update, RT_ICON, MAKEINTRESOURCEW(id), kLanguage,
                             const_cast<char*>(ico.data() + entry.offset), entry.bytes)) {
            return fail("cannot add an icon image");
        }
        GrpIconDirEntry grp{entry.width,  entry.height,    entry.colors, 0,
                            entry.planes, entry.bit_count, entry.bytes,  id};
        std::memcpy(group.data() + sizeof(IconDir) + i * sizeof(GrpIconDirEntry), &grp,
                    sizeof(grp));
    }
    if (!UpdateResourceW(update, RT_GROUP_ICON, MAKEINTRESOURCEW(1), kLanguage, group.data(),
                         static_cast<DWORD>(group.size()))) {
        return fail("cannot add the icon group");
    }
    return true;
}

bool stamp_version(HANDLE update, const std::wstring& source_module) {
    HMODULE module = LoadLibraryExW(source_module.c_str(), nullptr,
                                    LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE);
    if (module == nullptr) {
        return fail("cannot load the module carrying the version information");
    }
    bool ok = false;
    HRSRC found = FindResourceW(module, MAKEINTRESOURCEW(VS_VERSION_INFO), RT_VERSION);
    if (found == nullptr) {
        fail("the module has no VS_VERSION_INFO resource");
    } else {
        HGLOBAL loaded = LoadResource(module, found);
        const DWORD size = SizeofResource(module, found);
        void* data = loaded != nullptr ? LockResource(loaded) : nullptr;
        if (data == nullptr || size == 0) {
            fail("cannot read the version resource");
        } else {
            std::vector<char> copy(static_cast<const char*>(data),
                                   static_cast<const char*>(data) + size);
            ok = UpdateResourceW(update, RT_VERSION, MAKEINTRESOURCEW(VS_VERSION_INFO), kLanguage,
                                 copy.data(), size) != FALSE;
            if (!ok) {
                fail("cannot write the version resource");
            }
        }
    }
    FreeLibrary(module);
    return ok;
}

bool stamp_manifest(HANDLE update, const std::vector<char>& manifest) {
    if (manifest.empty()) {
        return fail("the manifest file is empty or unreadable");
    }
    std::vector<char> copy = manifest;
    if (!UpdateResourceW(update, RT_MANIFEST, MAKEINTRESOURCEW(kProcessManifestId), kLanguage,
                         copy.data(), static_cast<DWORD>(copy.size()))) {
        return fail("cannot write the manifest resource");
    }
    return true;
}

int dump_manifest(const std::wstring& exe) {
    HMODULE module = LoadLibraryExW(exe.c_str(), nullptr,
                                    LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE);
    if (module == nullptr) {
        return fail("cannot open the executable") ? 0 : 1;
    }
    int result = 1;
    HRSRC found = FindResourceW(module, MAKEINTRESOURCEW(kProcessManifestId), RT_MANIFEST);
    if (found == nullptr) {
        fail("the executable has no manifest resource 1");
    } else {
        HGLOBAL loaded = LoadResource(module, found);
        const DWORD size = SizeofResource(module, found);
        const void* data = loaded != nullptr ? LockResource(loaded) : nullptr;
        if (data == nullptr || size == 0) {
            fail("cannot read the manifest resource");
        } else {
            _setmode(_fileno(stdout), _O_BINARY);
            result = std::fwrite(data, 1, size, stdout) == size ? 0 : 1;
        }
    }
    FreeLibrary(module);
    return result;
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
    if (argc == 3 && std::wstring(argv[1]) == L"--dump-manifest") {
        return dump_manifest(argv[2]);
    }
    if (argc < 3) {
        std::fprintf(stderr,
                     "usage: mfbe_stamp_resources <exe> <icon.ico> [<module-with-version> "
                     "[<app.manifest>]]\n"
                     "       mfbe_stamp_resources --dump-manifest <exe>\n");
        return 1;
    }
    std::vector<char> manifest;
    if (argc >= 5) {
        manifest = read_file(argv[4]);
        if (manifest.empty()) {
            return fail("cannot read the manifest file") ? 0 : 1;
        }
    }
    const std::wstring exe = argv[1];
    const std::vector<char> ico = read_file(argv[2]);
    if (ico.empty()) {
        return fail("cannot read the icon file") ? 0 : 1;
    }

    // Enumerate what the executable carries today (the handle must be closed before updating).
    std::vector<ResourceEntry> icons;
    std::vector<ResourceEntry> groups;
    std::vector<ResourceEntry> versions;
    std::vector<ResourceEntry> manifests;
    if (HMODULE module = LoadLibraryExW(
            exe.c_str(), nullptr, LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE)) {
        icons = collect(module, RT_ICON);
        groups = collect(module, RT_GROUP_ICON);
        versions = collect(module, RT_VERSION);
        manifests = collect(module, RT_MANIFEST);
        FreeLibrary(module);
    } else {
        return fail("cannot open the executable") ? 0 : 1;
    }

    HANDLE update = BeginUpdateResourceW(exe.c_str(), FALSE);
    if (update == nullptr) {
        return fail("BeginUpdateResource failed") ? 0 : 1;
    }
    bool ok = remove_all(update, RT_GROUP_ICON, groups) && remove_all(update, RT_ICON, icons) &&
              stamp_icon(update, ico);
    if (ok && argc >= 4) {
        ok = remove_all(update, RT_VERSION, versions) && stamp_version(update, argv[3]);
    }
    if (ok && argc >= 5) {
        ok = remove_all(update, RT_MANIFEST, manifests) && stamp_manifest(update, manifest);
    }
    if (!ok) {
        EndUpdateResourceW(update, TRUE);  // discard
        return 1;
    }
    if (!EndUpdateResourceW(update, FALSE)) {
        return fail("EndUpdateResource failed") ? 0 : 1;
    }
    std::printf("mfbe_stamp_resources: stamped %ls\n", exe.c_str());
    return 0;
}
