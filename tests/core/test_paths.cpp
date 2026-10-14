// Feature 002, research R1: UTF-8 text <-> path conversions independent of the process code
// page. On the Windows CI job the test executable runs with the legacy code page, where
// std::filesystem::path(std::string) and path::string() would mangle these names.
#include "test_support.hpp"

#include <mfbe/platform.hpp>

#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <fstream>
#include <set>
#include <string>
#include <vector>

using namespace mfbe;

namespace {

const std::vector<std::string> kSamples = {
    "books/novel.fb2",        "C:\\Users\\Тест\\Документы\\книга.fb2", "书/读书笔记.fb2",
    "📚 библиотека/Pöhl.fb2", "dir/sub\\file with spaces.fb2",         "",
};

}  // namespace

TEST_CASE("paths: UTF-8 text round-trips through path_from_utf8 and utf8_from_path", "[paths]") {
    for (const auto& sample : kSamples) {
        INFO(sample);
        CHECK(platform::utf8_from_path(platform::path_from_utf8(sample)) == sample);
    }
}

TEST_CASE("paths: the generic form uses '/' as the separator", "[paths]") {
#ifdef _WIN32
    CHECK(platform::utf8_from_path_generic(platform::path_from_utf8("C:\\Users\\Тест\\a.fb2")) ==
          "C:/Users/Тест/a.fb2");
#else
    CHECK(platform::utf8_from_path_generic(platform::path_from_utf8("dir/Тест/a.fb2")) ==
          "dir/Тест/a.fb2");
#endif
    const auto joined = platform::path_from_utf8("Тест") / platform::path_from_utf8("书.fb2");
    CHECK(platform::utf8_from_path_generic(joined) == "Тест/书.fb2");
}

#ifdef _WIN32
TEST_CASE("paths: Windows wide strings convert to and from UTF-8 exactly", "[paths]") {
    const std::wstring wide = L"C:\\Users\\\u0422\u0435\u0441\u0442";  // C:\Users\Тест
    CHECK(platform::utf8_from_path(std::filesystem::path(wide)) == "C:\\Users\\Тест");
    CHECK(platform::path_from_utf8("C:\\Users\\Тест").wstring() == wide);
    // An unpaired surrogate becomes U+FFFD instead of throwing.
    const std::wstring broken = {L'a', static_cast<wchar_t>(0xD800)};
    CHECK(platform::utf8_from_path(std::filesystem::path(broken)) == "a\xEF\xBF\xBD");
}
#endif

TEST_CASE("paths: invalid UTF-8 never throws", "[paths]") {
    const std::string invalid = "a\xFF\xFE";
    std::filesystem::path path;
    REQUIRE_NOTHROW(path = platform::path_from_utf8(invalid));
#ifdef _WIN32
    CHECK(platform::utf8_from_path(path) == "a\xEF\xBF\xBD\xEF\xBF\xBD");
#else
    CHECK(platform::utf8_from_path(path) == invalid);
#endif
}

TEST_CASE("paths: folders and files with non-English names are created and listed exactly",
          "[paths]") {
    test::TempDir tmp("mfbe-paths");
    const std::vector<std::string> names = {"Тест", "书", "Pöhl", "📚 книги"};
    for (const auto& name : names) {
        const auto folder = tmp.path() / platform::path_from_utf8(name);
        std::filesystem::create_directories(folder);
        std::ofstream(folder / platform::path_from_utf8(name + ".fb2"), std::ios::binary) << "x";
        CHECK(std::filesystem::is_regular_file(folder / platform::path_from_utf8(name + ".fb2")));
    }
    std::set<std::string> listed;
    for (const auto& entry : std::filesystem::directory_iterator(tmp.path())) {
        listed.insert(platform::utf8_from_path(entry.path().filename()));
    }
    CHECK(listed == std::set<std::string>(names.begin(), names.end()));
}
