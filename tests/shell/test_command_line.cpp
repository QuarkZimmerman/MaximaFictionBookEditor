// The shell's command line (contracts/cli.md §1): the interface language override accepts the
// three interface languages - English, Russian and, since feature 003 (US1), Ukrainian - in
// both option forms, rejects anything else with the command-line error exit, and the --help
// text names all three.
#include "command_line.h"

#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

using mfbe::shell::parseArguments;
using mfbe::shell::ParseStatus;
using mfbe::shell::usageText;

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
