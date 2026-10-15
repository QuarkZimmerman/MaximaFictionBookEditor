// T013: per-user directories and portable folder detection.
#include "test_support.hpp"

#include <mfbe/platform.hpp>

#include <catch2/catch_test_macros.hpp>
#include <cstdlib>

#ifndef _WIN32
#include <unistd.h>
#endif

using namespace mfbe;

namespace {

struct EnvGuard {
    EnvGuard(const char* name_, const std::string& value) : name(name_) {
        const char* old = std::getenv(name_);
        if (old != nullptr) {
            previous = old;
        }
#ifdef _WIN32
        _putenv_s(name_, value.c_str());
#else
        setenv(name_, value.c_str(), 1);
#endif
    }
    ~EnvGuard() {
#ifdef _WIN32
        _putenv_s(name, previous ? previous->c_str() : "");
#else
        if (previous) {
            setenv(name, previous->c_str(), 1);
        } else {
            unsetenv(name);
        }
#endif
    }
    const char* name;
    std::optional<std::string> previous;
};

}  // namespace

TEST_CASE("dirs: override root puts everything below it", "[dirs]") {
    test::TempDir tmp;
    const auto dirs = platform::resolve_dirs(tmp.path().string());
    CHECK(dirs.config == tmp.path());
    CHECK(dirs.data == tmp.path());
    CHECK(dirs.state == tmp.path());
    CHECK(dirs.logs == tmp.path() / "logs");
    platform::ensure_dirs(dirs);
    CHECK(std::filesystem::is_directory(dirs.logs));
}

TEST_CASE("dirs: relative override is made absolute", "[dirs]") {
    const auto dirs = platform::resolve_dirs("relative-data-dir");
    CHECK(dirs.config.is_absolute());
    CHECK(dirs.logs.filename() == "logs");
}

#ifdef __linux__
TEST_CASE("dirs: Linux follows XDG base directories", "[dirs]") {
    test::TempDir tmp;
    EnvGuard cfg("XDG_CONFIG_HOME", (tmp.path() / "cfg").string());
    EnvGuard data("XDG_DATA_HOME", (tmp.path() / "data").string());
    EnvGuard state("XDG_STATE_HOME", (tmp.path() / "state").string());
    const auto dirs = platform::resolve_dirs();
    CHECK(dirs.config == tmp.path() / "cfg" / "maxfbeditor");
    CHECK(dirs.data == tmp.path() / "data" / "maxfbeditor");
    CHECK(dirs.state == tmp.path() / "state" / "maxfbeditor");
    CHECK(dirs.logs == tmp.path() / "state" / "maxfbeditor" / "logs");
    CHECK(platform::platform_name() == "linux");
}
#endif

#ifdef _WIN32
TEST_CASE("dirs: Windows keeps user content in Roaming and machine state in Local", "[dirs]") {
    // Windows guidelines: settings and user-authored content (custom dictionary, genre lists,
    // scripts, dictionaries) under %APPDATA% so they roam with the profile; caches and logs
    // under %LOCALAPPDATA%; nothing below the installation folder.
    const char* roaming = std::getenv("APPDATA");
    const char* local = std::getenv("LOCALAPPDATA");
    REQUIRE(roaming != nullptr);
    REQUIRE(local != nullptr);
    const auto dirs = platform::resolve_dirs();
    const std::filesystem::path app = "Maxima Fiction Book Editor";
    CHECK(dirs.config == std::filesystem::path(roaming) / app);
    CHECK(dirs.data == std::filesystem::path(roaming) / app);
    CHECK(dirs.state == std::filesystem::path(local) / app);
    CHECK(dirs.logs == std::filesystem::path(local) / app / "logs");
    CHECK(platform::platform_name() == "windows");
}
#endif

TEST_CASE("dirs: portable folder next to the executable", "[dirs]") {
    test::TempDir tmp;
    const auto exe_dir = tmp.path() / "bin";
    std::filesystem::create_directories(exe_dir);
    CHECK_FALSE(platform::detect_portable_dir(exe_dir, std::nullopt).has_value());
    std::filesystem::create_directories(exe_dir / "user" / "genres");
    const auto portable = platform::detect_portable_dir(exe_dir, std::nullopt);
    REQUIRE(portable.has_value());
    CHECK(std::filesystem::equivalent(*portable, exe_dir / "user"));
}

TEST_CASE("dirs: AppImage portable folder candidates", "[dirs]") {
    test::TempDir tmp;
    const std::string image = (tmp.path() / "Mfbe.AppImage").string();
    test::write_text(image, "fake");
    CHECK_FALSE(platform::detect_portable_dir(tmp.path(), image).has_value());

    SECTION("<AppImage>.d is accepted") {
        std::filesystem::create_directories(image + ".d");
        const auto portable = platform::detect_portable_dir(tmp.path(), image);
        REQUIRE(portable.has_value());
        CHECK(std::filesystem::equivalent(*portable, image + ".d"));
    }
    SECTION("<AppImage>.home/user wins over .d") {
        std::filesystem::create_directories(image + ".d");
        std::filesystem::create_directories(std::filesystem::path(image + ".home") / "user");
        const auto portable = platform::detect_portable_dir(tmp.path(), image);
        REQUIRE(portable.has_value());
        CHECK(std::filesystem::equivalent(*portable,
                                          std::filesystem::path(image + ".home") / "user"));
    }
    SECTION("exe-dir/user is ignored when APPIMAGE is set") {
        std::filesystem::create_directories(tmp.path() / "user");
        CHECK_FALSE(platform::detect_portable_dir(tmp.path(), image).has_value());
    }
}

TEST_CASE("dirs: a portable folder the editor can write to holds every directory", "[dirs]") {
    test::TempDir tmp;
    const auto portable = tmp / "user";
    std::filesystem::create_directories(portable);
    const auto dirs = platform::resolve_dirs("", portable);
    CHECK(dirs.config == portable);
    CHECK(dirs.data == portable);
    CHECK(dirs.state == portable);
    CHECK(dirs.logs == portable / "logs");
    CHECK(dirs.portable == portable);
    CHECK(std::filesystem::is_empty(portable));  // the write probe is gone
}

TEST_CASE("dirs: without a portable folder, the per-user folders", "[dirs]") {
    test::TempDir tmp;
    const auto per_user = platform::resolve_dirs("", std::nullopt);
    CHECK(per_user.config != tmp / "user");
    const auto dirs = platform::resolve_dirs("", tmp / "user");
    CHECK(dirs.config == per_user.config);
    CHECK(dirs.data == per_user.data);
    CHECK(dirs.logs == per_user.logs);
}

#ifndef _WIN32
TEST_CASE("dirs: a portable folder the editor cannot write to only adds resources", "[dirs]") {
    if (::geteuid() == 0) {
        SKIP("root writes into read-only folders");
    }
    test::TempDir tmp;
    const auto portable = tmp / "user";
    std::filesystem::create_directories(portable);
    std::filesystem::permissions(
        portable, std::filesystem::perms::owner_read | std::filesystem::perms::owner_exec);
    const auto dirs = platform::resolve_dirs("", portable);
    std::filesystem::permissions(portable, std::filesystem::perms::owner_all);
    CHECK(dirs.data == platform::resolve_dirs("", std::nullopt).data);
    CHECK(dirs.portable == portable);
}
#endif

TEST_CASE("dirs: an override root wins over a portable folder", "[dirs]") {
    test::TempDir tmp;
    const auto portable = tmp / "user";
    std::filesystem::create_directories(portable);
    const auto dirs = platform::resolve_dirs(platform::utf8_from_path(tmp / "data"), portable);
    CHECK(dirs.data == tmp / "data");
    CHECK(dirs.logs == tmp / "data" / "logs");
    CHECK(dirs.portable == portable);
}

TEST_CASE("dirs: a folder is writable when a file can be created in it", "[dirs]") {
    test::TempDir tmp;
    CHECK(platform::directory_writable(tmp.path()));
    CHECK(std::filesystem::is_empty(tmp.path()));
    CHECK_FALSE(platform::directory_writable(tmp / "missing"));
    CHECK_FALSE(platform::directory_writable({}));
    CHECK_FALSE(platform::portable_data_dir(std::nullopt).has_value());
    CHECK(platform::portable_data_dir(tmp.path()) == tmp.path());
}

#ifndef _WIN32
TEST_CASE("dirs: system language comes from LC_ALL/LC_MESSAGES/LANG", "[dirs]") {
    {
        EnvGuard all("LC_ALL", "ru_RU.UTF-8");
        CHECK(platform::system_language() == "ru");
    }
    {
        EnvGuard all("LC_ALL", "C");
        EnvGuard messages("LC_MESSAGES", "de_DE@euro");
        CHECK(platform::system_language() == "de");
    }
    {
        EnvGuard all("LC_ALL", "C");
        EnvGuard messages("LC_MESSAGES", "POSIX");
        EnvGuard lang("LANG", "C");
        CHECK(platform::system_language() == "en");
    }
}
#endif

TEST_CASE("dirs: executable path and pid are available", "[dirs]") {
    CHECK_FALSE(platform::executable_path().empty());
    CHECK(std::filesystem::is_directory(platform::executable_dir()));
    CHECK(platform::current_pid() > 0);
    CHECK(platform::resident_memory_bytes() > 0);
}
