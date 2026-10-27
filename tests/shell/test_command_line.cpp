// The shell's command line (contracts/cli.md §1): the interface language override accepts the
// three interface languages - English, Russian and, since feature 003 (US1), Ukrainian - in
// both option forms, rejects anything else with the command-line error exit, and the --help
// text names all three; the restart options of feature 003 (US3) - `--wait-for-exit <pid>` and
// `--window-geometry <x,y,w,h[,max]>` - are parsed and validated; `--version` names the version
// label and the build id (feature 006, contracts/cli.md §1).
#include "command_line.h"

#include <catch2/catch_test_macros.hpp>
#include <regex>
#include <string>
#include <vector>

using mfbe::shell::CefVersionInfo;
using mfbe::shell::parseArguments;
using mfbe::shell::ParseStatus;
using mfbe::shell::usageText;
using mfbe::shell::versionText;

TEST_CASE("command line: --wait-for-exit takes the process id to wait for", "[shell]") {
    const auto spaced = parseArguments({"--wait-for-exit", "4242", "book.fb2"});
    CHECK(spaced.status == ParseStatus::kRun);
    CHECK(spaced.options.wait_for_exit_pid == 4242);
    CHECK(spaced.options.files == std::vector<std::string>{"book.fb2"});
    const auto joined = parseArguments({"--wait-for-exit=4242"});
    CHECK(joined.status == ParseStatus::kRun);
    CHECK(joined.options.wait_for_exit_pid == 4242);
    // Without the option nothing is waited for.
    CHECK(parseArguments({}).options.wait_for_exit_pid == 0);

    for (const std::string value : {"abc", "0", "-5", "12x", ""}) {
        const auto result = parseArguments({"--wait-for-exit", value});
        CHECK(result.status == ParseStatus::kExitError);
        CHECK(result.message.find("Invalid value for --wait-for-exit: '" + value + "'") !=
              std::string::npos);
    }
    const auto missing = parseArguments({"--wait-for-exit"});
    CHECK(missing.status == ParseStatus::kExitError);
    CHECK(missing.message.find("Missing value for command line option: '--wait-for-exit'") !=
          std::string::npos);
}

TEST_CASE("command line: --window-geometry takes x,y,w,h with an optional max", "[shell]") {
    const auto normal = parseArguments({"--window-geometry", "10,20,1200,800"});
    CHECK(normal.status == ParseStatus::kRun);
    REQUIRE(normal.options.window_geometry);
    CHECK(normal.options.window_geometry->x == 10);
    CHECK(normal.options.window_geometry->y == 20);
    CHECK(normal.options.window_geometry->width == 1200);
    CHECK(normal.options.window_geometry->height == 800);
    CHECK_FALSE(normal.options.window_geometry->maximized);

    const auto maximized = parseArguments({"--window-geometry=-5,0,640,400,max", "--no-sandbox"});
    CHECK(maximized.status == ParseStatus::kRun);
    REQUIRE(maximized.options.window_geometry);
    CHECK(maximized.options.window_geometry->x == -5);
    CHECK(maximized.options.window_geometry->maximized);
    CHECK(maximized.options.no_sandbox);
    CHECK_FALSE(parseArguments({}).options.window_geometry);

    for (const std::string value : {"10,20", "a,b,c,d", "1,2,0,4", "1,2,3,4,big", ""}) {
        const auto result = parseArguments({"--window-geometry", value});
        CHECK(result.status == ParseStatus::kExitError);
        CHECK(result.message.find("Invalid value for --window-geometry: '" + value + "'") !=
              std::string::npos);
        CHECK(result.message.find("expected x,y,w,h or x,y,w,h,max") != std::string::npos);
    }
}

TEST_CASE("command line: the help text names the restart options", "[shell]") {
    const std::string usage = usageText();
    CHECK(usage.find("--wait-for-exit <pid>") != std::string::npos);
    CHECK(usage.find("--window-geometry <x,y,w,h[,max]>") != std::string::npos);
}

TEST_CASE("command line: --lang accepts en, ru and uk", "[shell]") {
    for (const std::string lang : {"en", "ru", "uk"}) {
        const auto spaced = parseArguments({"--lang", lang, "book.fb2"});
        CHECK(spaced.status == ParseStatus::kRun);
        CHECK(spaced.options.lang == lang);
        CHECK(spaced.options.files == std::vector<std::string>{"book.fb2"});

        const auto joined = parseArguments({"--lang=" + lang});
        CHECK(joined.status == ParseStatus::kRun);
        CHECK(joined.options.lang == lang);
    }
    // No override: the system language decides (empty).
    CHECK(parseArguments({}).options.lang.empty());
}

TEST_CASE("command line: an unknown --lang value is a command-line error", "[shell]") {
    for (const std::string lang : {"xx", "ukr", "UK", "uk-UA", ""}) {
        const auto result = parseArguments({"--lang", lang});
        CHECK(result.status == ParseStatus::kExitError);
        CHECK(result.message.find("Invalid value for --lang: '" + lang + "'") != std::string::npos);
        CHECK(result.message.find("expected en, ru or uk") != std::string::npos);
    }
    const auto missing = parseArguments({"--lang"});
    CHECK(missing.status == ParseStatus::kExitError);
    CHECK(missing.message.find("Missing value for command line option: '--lang'") !=
          std::string::npos);
}

TEST_CASE("command line: the help text offers en|ru|uk", "[shell]") {
    const std::string usage = usageText();
    CHECK(usage.find("--lang <en|ru|uk>") != std::string::npos);
    const auto help = parseArguments({"--help"});
    CHECK(help.status == ParseStatus::kExitOk);
    CHECK(help.message == usage);
}

// The first line of --version carries the configured version stamps (cmake/MfbeVersion.cmake,
// passed by tests/shell/CMakeLists.txt): the label - 0.0.6-rc untagged, 0.0.6-rc.N from a
// release tag - and the build id, the label, "+" and the commit hash.
TEST_CASE("command line: --version names the version label and the build id", "[shell]") {
    CefVersionInfo cef;
    cef.compiled_cef_version = "150.0.22+gc1a097e+chromium-150.0.7871.256";
    cef.api_version = 15000;
    const std::string text = versionText(cef);
    const std::string first = text.substr(0, text.find('\n'));
    const std::string label = MFBE_VERSION;
    const std::string build_id = MFBE_BUILD_ID;
    CHECK(first == "Maxima Fiction Book Editor " + label + " (build " + build_id + ", " +
                       MFBE_BUILD_DATE + ")");
    CHECK(std::regex_match(label, std::regex(R"(\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?)")));
    REQUIRE(build_id.size() > label.size() + 1);
    CHECK(build_id.substr(0, label.size() + 1) == label + "+");
    CHECK(std::regex_match(build_id.substr(label.size() + 1), std::regex("[0-9a-f]{10}|unknown")));
}
