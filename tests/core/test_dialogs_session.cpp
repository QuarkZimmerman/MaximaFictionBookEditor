// T024/T025: dialog provider shapes + queued provider, document session registry, binary
// store placeholder, CPython-compatible corpus sampler.
#include "test_support.hpp"

#include <mfbe/binary_store.hpp>
#include <mfbe/corpus_sample.hpp>
#include <mfbe/dialog_provider.hpp>
#include <mfbe/document_session.hpp>
#include <mfbe/rpc.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace mfbe;
using nlohmann::json;

TEST_CASE("dialogs: request/result JSON shapes follow rpc-api.md section 3.9", "[dialogs]") {
    const json open_req = json::parse(
        R"({"title":"Open","filters":[{"name":"FB2","extensions":["fb2","fbd"]}],"multiple":true})");
    const OpenFileRequest r = open_file_request_from_json(open_req);
    CHECK(r.title == "Open");
    REQUIRE(r.filters.size() == 1);
    CHECK(r.filters[0].extensions == std::vector<std::string>{"fb2", "fbd"});
    CHECK(r.multiple);
    CHECK(to_json(r) == open_req);

    CHECK(to_json(open_file_result_from_json(json{{"paths", {"/a", "/b"}}})) ==
          json{{"paths", {"/a", "/b"}}});
    CHECK(to_json(open_file_result_from_json(json{{"path", "/single"}})) ==
          json{{"paths", {"/single"}}});
    CHECK(to_json(open_file_result_from_json(json::object())) == json{{"paths", json::array()}});

    const SaveFileRequest s = save_file_request_from_json(json{
        {"title", "Save"}, {"defaultPath", "/b.fb2"}, {"encodingChoices", {"utf-8", "koi8-r"}}});
    CHECK(s.defaultPath == "/b.fb2");
    CHECK(s.encodingChoices.size() == 2);
    CHECK(to_json(save_file_result_from_json(json{{"path", "/x"}, {"encoding", "utf-8"}})) ==
          json{{"path", "/x"}, {"encoding", "utf-8"}});
    CHECK(to_json(save_file_result_from_json(json::object())) == json::object());  // cancelled
    CHECK(to_json(pick_folder_result_from_json(json{{"path", "/d"}})) == json{{"path", "/d"}});
    const MessageRequest m = message_request_from_json(
        json{{"text", "Save?"}, {"caption", "MFBE"}, {"buttons", {"Yes", "No", "Cancel"}}});
    CHECK(m.buttons.size() == 3);
    CHECK(to_json(message_result_from_json(json{{"button", "Yes"}})) == json{{"button", "Yes"}});

    CHECK_THROWS_AS(open_file_request_from_json(json{{"title", 5}}), std::invalid_argument);
    CHECK_THROWS_AS(open_file_result_from_json(json{{"paths", "x"}}), std::invalid_argument);
    CHECK_THROWS_AS(message_request_from_json(json::array()), std::invalid_argument);
}

TEST_CASE("dialogs: queued provider answers in order and fails loudly without an answer",
          "[dialogs]") {
    QueuedDialogProvider provider;
    CHECK(provider.enqueue("dialog.openFile", json{{"paths", {"/one.fb2"}}}) == 1);
    CHECK(provider.enqueue("dialog.message", json{{"button", "No"}}) == 2);
    CHECK(provider.pending() == 2);

    std::vector<std::string> got;
    provider.open_file(OpenFileRequest{}, [&](OpenFileResult r) { got = r.paths; });
    CHECK(got == std::vector<std::string>{"/one.fb2"});
    // Head of queue is a message answer: a save dialog must not consume it.
    CHECK_THROWS_AS(provider.save_file(SaveFileRequest{}, [](SaveFileResult) {}),
                    DialogUnavailable);
    CHECK(provider.pending() == 1);
    std::string button;
    provider.message(MessageRequest{}, [&](MessageResult r) { button = r.button; });
    CHECK(button == "No");
    CHECK(provider.pending() == 0);
    CHECK_THROWS_AS(provider.pick_folder(PickFolderRequest{}, [](PickFolderResult) {}),
                    DialogUnavailable);
    CHECK(provider.missed() == std::vector<std::string>{"dialog.saveFile", "dialog.pickFolder"});
    CHECK(provider.open_path("/tmp"));
    CHECK(provider.opened_paths() == std::vector<std::string>{"/tmp"});
    provider.enqueue("dialog.openFile", json::object());
    provider.clear();
    CHECK(provider.pending() == 0);
}

TEST_CASE("session: registry issues docIds and remembers carets", "[session]") {
    session::DocumentRegistry registry;
    auto& a = registry.create();
    auto& b = registry.create();
    CHECK(a.docId == "d1");
    CHECK(b.docId == "d2");
    CHECK(registry.size() == 2);
    CHECK(registry.ids() == std::vector<std::string>{"d1", "d2"});
    b.path = "/books/b.fb2";
    CHECK(registry.find_by_path("/books/b.fb2") == &b);
    CHECK(registry.find_by_path("/nope") == nullptr);
    CHECK(registry.find("d1") == &a);
    CHECK(registry.find("d3") == nullptr);
    CHECK(&registry.require("d2") == &b);
    try {
        registry.require("d9");
        FAIL("expected doc.notFound");
    } catch (const rpc::RpcError& e) {
        CHECK(e.code == rpc::codes::kDocNotFound);
        CHECK(e.data["docId"] == "d9");
    }
    CHECK_FALSE(registry.caret("d1").has_value());
    registry.remember_caret("d1", settings::Caret{"body", "n7", 3});
    CHECK(registry.caret("d1")->nodeId == "n7");
    registry.remember_caret("d9", settings::Caret{"body", "n7", 3});  // unknown: ignored
    CHECK(a.binaries != nullptr);
    CHECK(a.ids.next() == "n1");
    CHECK(registry.close("d1"));
    CHECK_FALSE(registry.close("d1"));
    CHECK(registry.create().docId == "d3");  // ids are never reused
}

TEST_CASE("binary store: in-memory placeholder behaviour", "[session]") {
    MemoryBinaryStore store;
    const auto meta = store.put("cover.jpg", "image/jpeg", std::string(10, 'a'));
    CHECK(meta.id == "cover.jpg");
    CHECK(meta.size == 10);
    CHECK(store.contains("cover.jpg"));
    CHECK(store.bytes("cover.jpg") == std::string(10, 'a'));
    CHECK_FALSE(store.bytes("x").has_value());
    model::BinaryMeta updated = *store.meta("cover.jpg");
    updated.referenceCount = 3;
    updated.size = 999;  // ignored: size follows the bytes
    store.update_meta(updated);
    CHECK(store.meta("cover.jpg")->referenceCount == 3);
    CHECK(store.meta("cover.jpg")->size == 10);
    store.put("cover.jpg", "image/png", "bb");  // replace keeps the reference count
    CHECK(store.meta("cover.jpg")->referenceCount == 3);
    CHECK(store.meta("cover.jpg")->contentType == "image/png");
    CHECK(store.total_bytes() == 2);
    CHECK(store.unique_id("cover.jpg") == "cover_2.jpg");
    CHECK(store.unique_id("new.png") == "new.png");
    CHECK(store.unique_id("") == "binary");
    CHECK(store.list().size() == 1);
    CHECK(store.remove("cover.jpg"));
    CHECK_FALSE(store.remove("cover.jpg"));
}

TEST_CASE("corpus: PyRandom reproduces CPython's Mersenne Twister", "[corpus]") {
    // Expected values produced with CPython 3 `random.Random(seed)`.
    struct Case {
        std::uint64_t seed;
        std::uint32_t first[3];
        std::uint64_t bits5;
        std::uint64_t bits40;
        std::uint64_t below1000;
    };
    const Case cases[] = {
        {0, {3626764237u, 1654615998u, 3255389356u}, 28, 44756014165ull, 265},
        {1, {577090037u, 2444712010u, 3639700191u}, 25, 71999863748ull, 261},
        {7, {1390851128u, 4071050724u, 647892279u}, 12, 54335349840ull, 74},
        {12345, {1789368711u, 3146859322u, 43676229u}, 26, 884012530637ull, 305},
        {4294967301ull, {675479763u, 2085189291u, 1213270837u}, 28, 917424144349ull, 14},
        {1099511627781ull, {2166296868u, 2220160828u, 1153647273u}, 21, 34040994016ull, 543},
    };
    for (const auto& c : cases) {
        INFO("seed " << c.seed);
        corpus::PyRandom rng(c.seed);
        CHECK(rng.getrandbits(32) == c.first[0]);
        CHECK(rng.getrandbits(32) == c.first[1]);
        CHECK(rng.getrandbits(32) == c.first[2]);
        CHECK(rng.getrandbits(5) == c.bits5);
        CHECK(rng.getrandbits(40) == c.bits40);
        CHECK(rng.randbelow(1000) == c.below1000);
    }
    std::vector<int> x{0, 1, 2, 3, 4, 5, 6, 7, 8, 9};
    corpus::PyRandom(7).shuffle(x);
    CHECK(x == std::vector<int>{8, 3, 1, 4, 7, 0, 9, 6, 2, 5});

    std::vector<std::string> names;
    for (int i = 0; i < 25; ++i) {
        char buf[8];
        std::snprintf(buf, sizeof(buf), "c%02d", i);
        names.emplace_back(buf);
    }
    CHECK(corpus::sample(names, 1, 5) ==
          std::vector<std::string>{"c10", "c20", "c21", "c23", "c24"});
    CHECK(corpus::sample(names, 42, 7) ==
          std::vector<std::string>{"c05", "c06", "c09", "c12", "c16", "c18", "c19"});
    CHECK(corpus::sample({}, 1, 5).empty());
    CHECK(corpus::sample({"only"}, 1, 5) == std::vector<std::string>{"only"});
}

TEST_CASE("corpus: scan + sample of the mini corpus matches sample.py", "[corpus]") {
    const auto root = test::fixtures_dir() / "corpus-mini";
    REQUIRE(std::filesystem::is_directory(root));
    auto candidates = corpus::scan_candidates(root, false);
    CHECK(candidates.size() == 12);
    CHECK(std::is_sorted(candidates.begin(), candidates.end()));
    // python3 tests/corpus/sample.py --root tests/fixtures/corpus-mini --count 4 --seed 3
    const auto picked = corpus::sample(candidates, 3, 4);
    std::vector<std::string> relative;
    for (const auto& p : picked) {
        relative.push_back(std::filesystem::relative(p, root).generic_string());
    }
    CHECK(relative == std::vector<std::string>{"00000001-00000100/a/0000a1/book1.fb2",
                                               "00000001-00000100/a/0000a2/book2.fb2",
                                               "00000101-00000200/a/0000a2/book2.fb2",
                                               "00000101-00000200/b/0000b2/book2.fb2"});
    auto with_fbd = corpus::scan_candidates(root, true);
    CHECK(with_fbd.size() == 13);
    CHECK(corpus::scan_candidates(root, true, 5).size() == 5);
    CHECK(corpus::scan_candidates(root / "missing", false).empty());
}
