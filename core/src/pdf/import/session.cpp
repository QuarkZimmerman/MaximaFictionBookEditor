// Feature 016: see session.hpp.
#include "pdf/import/session.hpp"

#include <chrono>

namespace mfbe::pdf_import {

using namespace std::chrono_literals;
using json = nlohmann::json;

Session::Session(std::filesystem::path folder, std::filesystem::path pdf, int quality,
                 std::filesystem::path fonts)
    : folder_(std::move(folder)),
      pdf_(std::move(pdf)),
      quality_(quality),
      fonts_(std::move(fonts)) {}

Session::~Session() {
    end();
}

void Session::end() {
    if (reader_) {
        reader_->kill();
        reader_.reset();
    }
    std::error_code ec;
    std::filesystem::remove_all(folder_, ec);
}

std::string Session::ended_reason() const {
    switch (reader_ ? reader_->end() : ReaderEnd::killed) {
        case ReaderEnd::timed_out:
            return "timeout";
        case ReaderEnd::over_memory:
            return "memory";
        case ReaderEnd::crashed:
            return "crashed";
        default:
            return "damaged";
    }
}

json Session::wait_open() {
    std::string line;
    while (reader_->next_event(line, 1s) || reader_->end() == ReaderEnd::running) {
        if (line.empty()) {
            continue;
        }
        const json e = json::parse(line, nullptr, false);
        line.clear();
        const std::string event = e.is_object() ? e.value("event", "") : "";
        if (event == "opened") {
            pages_ = e.value("pages", 0);
            return {{"opened", true}, {"pages", pages_}};
        }
        if (event == "needs-password") {
            return {{"needsPassword", true}};
        }
        if (event == "wrong-password") {
            return {{"needsPassword", true}, {"wrongPassword", true}};
        }
        if (event == "owner-password") {
            return {{"ownerPassword", true}};
        }
        if (event == "failed") {
            return {{"failed", e.value("reason", "damaged")}};
        }
    }
    return {{"failed", ended_reason()}};
}

json Session::inspect(const ReaderOcrOptions& ocr) {
    ReaderOptions o;
    o.reader = find_reader();
    o.pdf = pdf_;
    o.folder = folder_;
    o.quality = quality_;
    o.fonts = fonts_;
    o.ocr = ocr;
    if (o.reader.empty()) {
        return {{"failed", "crashed"}};
    }
    std::string error;
    reader_ = ReaderProcess::start(o, error);
    if (!reader_) {
        return {{"failed", "crashed"}};
    }
    return wait_open();
}

json Session::password(const std::string& password) {
    if (!reader_ || !reader_->send_line(password)) {
        return {{"failed", "passwordCancelled"}};
    }
    return wait_open();
}

std::string Session::read(const std::function<bool(const std::string&, int, int)>& progress,
                          json& result) {
    result = json{{"kinds", json::object()}};
    json& kinds = result["kinds"];
    std::vector<std::string> page_kinds(static_cast<std::size_t>(std::max(0, pages_)));
    std::string line;
    auto decrement_kind = [&kinds](const std::string& kind) {
        if (kind.empty() || !kinds.contains(kind)) {
            return;
        }
        const int count = kinds.value(kind, 0) - 1;
        if (count <= 0) {
            kinds.erase(kind);
        } else {
            kinds[kind] = count;
        }
    };
    while (reader_ && (reader_->next_event(line, 1s) || reader_->end() == ReaderEnd::running)) {
        if (line.empty()) {
            if (!progress("read", -1, pages_)) {
                end();
                return "cancelled";
            }
            continue;
        }
        const json e = json::parse(line, nullptr, false);
        line.clear();
        const std::string event = e.is_object() ? e.value("event", "") : "";
        if (event == "page") {
            const int n = e.value("n", 0);
            const std::string kind = e.value("kind", "text");
            if (n >= 1) {
                const std::size_t idx = static_cast<std::size_t>(n - 1);
                if (idx >= page_kinds.size()) {
                    page_kinds.resize(idx + 1);
                }
                if (!page_kinds[idx].empty()) {
                    decrement_kind(page_kinds[idx]);
                }
                page_kinds[idx] = kind;
            }
            kinds[kind] = kinds.value(kind, 0) + 1;
            if (!progress("read", n, pages_)) {
                end();
                return "cancelled";
            }
        } else if (event == "ocr-stage") {
            const int done = e.value("done", 0);
            const int total = e.value("total", 0);
            if (!progress("ocrDetect", done, total)) {
                end();
                return "cancelled";
            }
        } else if (event == "ocr-page") {
            const int n = e.value("n", 0);
            const std::string ocr_kind = e.value("kind", "ocr");
            if (n >= 1 && static_cast<std::size_t>(n) <= page_kinds.size()) {
                const std::size_t idx = static_cast<std::size_t>(n - 1);
                const std::string& prev = page_kinds[idx];
                std::string updated = prev;
                if (ocr_kind == "ocr" && prev == "garbled") {
                    // Rescued garbled page no longer counts as garbled in the final summary.
                    updated = "pictureShowingText";
                } else if (ocr_kind == "ocrFallback") {
                    updated = "pictureWithoutText";
                }
                if (updated != prev) {
                    decrement_kind(prev);
                    page_kinds[idx] = updated;
                    kinds[updated] = kinds.value(updated, 0) + 1;
                }
            }
            const int done = e.value("done", 0);
            const int total = e.value("total", 0);
            if (!progress("ocr", done, total)) {
                end();
                return "cancelled";
            }
        } else if (event == "done") {
            done_ = true;
            result["garbledShare"] = e.value("garbledShare", 1.0);
            result["drawingsLeftOut"] = e.value("drawingsLeftOut", 0);
            if (e.contains("ocr") && e["ocr"].is_object()) {
                result["ocr"] = e["ocr"];
            }
            reader_->set_silence_timeout(std::chrono::hours(24));
            return "";
        } else if (event == "failed") {
            if (e.contains("pages")) {
                result["pages"] = e.value("pages", 0);
            }
            if (e.contains("script") && e["script"].is_string()) {
                result["script"] = e["script"];
            }
            if (e.contains("suggestedLanguages") && e["suggestedLanguages"].is_array()) {
                result["suggestedLanguages"] = e["suggestedLanguages"];
            }
            return e.value("reason", "damaged");
        }
    }
    return ended_reason();
}

std::string Session::read(const std::function<bool(int, int)>& progress, json& result) {
    return read([&progress](const std::string&, int done, int total) { return progress(done, total); },
                result);
}

json Session::picture(const std::string& id, int page) {
    if (!reader_ || !done_) {
        return {{"event", "picture-failed"}, {"id", id}};
    }
    reader_->send_line(json{{"picture", id}, {"page", page}}.dump());
    std::string line;
    while (reader_->next_event(line, 30s)) {
        const json e = json::parse(line, nullptr, false);
        if (e.is_object() && e.value("id", "") == id) {
            return e;
        }
    }
    return {{"event", "picture-failed"}, {"id", id}};
}

void remove_stale_folders(const std::filesystem::path& root) {
    std::error_code ec;
    for (const auto& entry : std::filesystem::directory_iterator(root, ec)) {
        std::filesystem::remove_all(entry.path(), ec);
    }
}

}  // namespace mfbe::pdf_import
