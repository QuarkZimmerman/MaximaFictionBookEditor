// Feature 009, User Story 2 (T017): a file is recognised by its leading bytes, never by its
// name (D6, FR-020, research DP-1).
#include "test_support.hpp"

#include <mfbe/archive.hpp>

#include <catch2/catch_test_macros.hpp>

#include <string>

using namespace mfbe;
namespace fs = std::filesystem;

namespace {

fs::path fixture(const std::string& name) {
    return test::fixtures_dir() / "archives" / name;
}

}  // namespace

TEST_CASE("archive kind: ZIP and the other archive kinds by their leading bytes", "[archive]") {
    CHECK(archive::detect_kind(fixture("single.fb2.zip")) == archive::Kind::zip);
    CHECK(archive::detect_kind(fixture("sample.rar")) == archive::Kind::rar);
    CHECK(archive::detect_kind(fixture("sample.7z")) == archive::Kind::sevenz);
    CHECK(archive::detect_kind(fixture("sample.gz")) == archive::Kind::gzip);

    test::TempDir tmp;
    auto made = [&](const std::string& name, const std::string& bytes) {
        test::write_text(tmp / name, bytes);
        return archive::detect_kind(tmp / name);
    };
    CHECK(made("a.bz2", "BZh91AY&SY") == archive::Kind::bzip2);
    CHECK(made("a.xz", std::string("\xfd" "7zXZ\0\0", 8)) == archive::Kind::xz);
    CHECK(made("a.zst", "\x28\xb5\x2f\xfd\x04\x00") == archive::Kind::zstd);
    CHECK(made("a.cab", "MSCF\0\0\0\0") == archive::Kind::cab);
    std::string tar(512, '\0');
    tar.replace(257, 5, "ustar");
    CHECK(made("a.tar", tar) == archive::Kind::tar);
    // An empty archive is only an end-of-central-directory record.
    CHECK(made("empty.zip", std::string("PK\x05\x06", 4) + std::string(18, '\0')) ==
          archive::Kind::zip);
    // The name means nothing: a ZIP named .fb2 is a ZIP, a plain book named .zip is a file.
    CHECK(made("book.fb2", test::read_text(fixture("single.fb2.zip"))) == archive::Kind::zip);
    CHECK(made("book.zip", test::read_text(test::fixtures_dir() / "books" / "modern-utf8.fb2")) ==
          archive::Kind::file);
    CHECK(archive::detect_kind(tmp / "missing.zip") == archive::Kind::missing);
    CHECK(archive::detect_kind(tmp.path()) == archive::Kind::folder);
}

TEST_CASE("archive kind: the contract's names", "[archive]") {
    CHECK(std::string(archive::kind_name(archive::Kind::sevenz)) == "7z");
    CHECK(std::string(archive::kind_name(archive::Kind::file)) == "file");
    CHECK(archive::is_other_archive(archive::Kind::rar));
    CHECK_FALSE(archive::is_other_archive(archive::Kind::zip));
    CHECK_FALSE(archive::is_other_archive(archive::Kind::file));
    CHECK(std::string(archive::reason_name(archive::Reason::too_large)) == "tooLarge");
    CHECK(std::string(archive::reason_name(archive::Reason::multi_volume)) == "multiVolume");
}
