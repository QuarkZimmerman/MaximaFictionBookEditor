// Feature 014 (contracts/print-service.md, tasks T011): the test hooks' print service keeps each
// request until the journeys answer it, writes the uploaded bytes to the request's file, and
// reports failures and cancellations to the export.

#include "print/queued_print_service.hpp"
#include "test_support.hpp"

#include <catch2/catch_test_macros.hpp>
#include <fstream>
#include <iterator>
#include <string>

TEST_CASE("print service: a request waits, then its bytes reach its file", "[print]") {
    mfbe::test::TempDir tmp;
    mfbe::QueuedPrintService service;
    bool called = false;
    bool ok = false;
    std::string message = "unset";
    mfbe::PrintRequest request{"http://127.0.0.1:1/pdf/t/print/0?token=x", 5.8, 8.3,
                               tmp / "part0.pdf"};
    service.print(request, [&](bool done_ok, const std::string& done_message) {
        called = true;
        ok = done_ok;
        message = done_message;
    });
    const auto pending = service.requests();
    REQUIRE(pending.size() == 1);
    CHECK(pending[0]["url"] == request.url);
    CHECK(pending[0]["paperWidthIn"] == 5.8);
    CHECK(pending[0]["paperHeightIn"] == 8.3);
    CHECK(pending[0]["tagged"] == true);
    CHECK_FALSE(called);

    CHECK_FALSE(service.complete("print-999", "%PDF-"));
    REQUIRE(service.complete(pending[0]["jobId"].get<std::string>(), "%PDF-1.4 bytes"));
    CHECK(called);
    CHECK(ok);
    CHECK(message.empty());
    std::ifstream in(request.out, std::ios::binary);
    CHECK(std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>()) ==
          "%PDF-1.4 bytes");
    CHECK(service.requests().empty());
}

TEST_CASE("print service: failures and cancellations reach the export", "[print]") {
    mfbe::test::TempDir tmp;
    mfbe::QueuedPrintService service;
    std::vector<std::string> results;
    auto record = [&](bool ok, const std::string& message) {
        results.push_back((ok ? "ok:" : "failed:") + message);
    };
    service.print({"u1", 1, 1, tmp / "a.pdf"}, record);
    service.print({"u2", 1, 1, tmp / "b.pdf"}, record);
    const auto pending = service.requests();
    REQUIRE(pending.size() == 2);
    CHECK(service.fail(pending[0]["jobId"].get<std::string>(), "no printer"));
    CHECK_FALSE(service.fail(pending[0]["jobId"].get<std::string>(), "again"));
    service.cancel();
    CHECK(results == std::vector<std::string>{"failed:no printer", "failed:cancelled"});
    CHECK(service.requests().empty());
}
