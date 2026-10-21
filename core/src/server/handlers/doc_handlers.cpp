// doc.* handlers (T045) - contracts/rpc-api.md §3.2.
//
//   doc.new() -> Document + {filledIn, templateIssue?}   from the effective template
//   doc.open({path}) -> {document, warnings} | {jobId}   (job above kJobThresholdBytes)
//   doc.openSource({path}) -> {docId, text, encoding, error?, warnings}
//   doc.close({docId}) -> {}
//   doc.toXml({docId, document, elideBinaries?}) -> {text}
//   doc.fromXml({docId, text}) -> {document, warnings, remap?}   (error 1001 when malformed)
//   doc.save({docId, document? | text?, path?, encoding?, force?})
//       -> {path, encoding, converted: [BinaryMeta + {from, to}], validation}
//          | {needsConfirmation: true, validation} | {jobId}
//       Model saves convert every non-JPEG/PNG image binary in place before writing (FR-110,
//       same ids); Source-only text saves are written verbatim.
//   Every document loaded into the model (doc.new, doc.open, doc.fromXml) gets the details the
//   original filled in on load (feature 002 FR-005); its JSON lists them in `filledIn`.
//   doc.formatDate({value}) -> {text}   the regional long date of a YYYY-MM-DD value (feature
//       003 FR-050, the Today button); invalidParams unless a calendar date
//   doc.validate({docId, document?, text?}) -> ValidationReport | {jobId}
//   doc.recent() -> RecentFile[] (+ exists), doc.clearRecent() -> {}
//   doc.caret({docId, caret?}) -> {caret?}
//   doc.watch({docId, enabled}) -> {}   (notification doc.changedOnDisk {docId, path, mtime})
//   doc.readDescription({docId, path}) -> {importId, description, documentDetails, binaries,
//       warnings} | {jobId}   (feature 004 US4, FR-031/FR-032): the file read as doc.open reads
//       it, keeping only its description (as read; node ids from `docId`'s allocator), the
//       document-info after the 002 FR-005 fill-in and the binaries the description's
//       importable entries refer to, held by a hidden session `importId` (GET /binary,
//       binary.copy, doc.close) - no Recent Files, no caret, no watch.
//
// Jobs run on worker threads; everything that touches the session registry is posted back
// to the loop thread (Services::post), so the registry stays single-threaded.
#include "server/services.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/document_details.hpp>
#include <mfbe/encodings.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/images.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/log.hpp>
#include <mfbe/node_ids.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/templates.hpp>
#include <mfbe/validator.hpp>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <exception>
#include <filesystem>
#include <functional>
#include <future>
#include <optional>
#include <string>
#include <system_error>

namespace mfbe::server {
namespace {

using nlohmann::json;
namespace fs = std::filesystem;

// Files at least this big are opened/saved/validated as jobs with progress notifications.
constexpr std::uintmax_t kJobThresholdBytes = 2 * 1024 * 1024;

/* ----------------------------------------------------------------------------------------- */
/* Errors and small helpers                                                                   */
/* ----------------------------------------------------------------------------------------- */

rpc::RpcError not_fictionbook(const std::string& path, const std::string& reason) {
    return rpc::RpcError(rpc::codes::kDocNotFictionBook, "",
                         json{{"path", path}, {"reason", reason}});
}

rpc::RpcError parse_error(const fb2::ParseError& e) {
    return rpc::RpcError(rpc::codes::kDocParseError, "",
                         json{{"line", e.line}, {"column", e.column}, {"message", e.message}});
}

rpc::RpcError io_error(const std::string& path, const std::string& reason) {
    return rpc::RpcError(rpc::codes::kDocIoError, "", json{{"path", path}, {"reason", reason}});
}

// Paths travel as UTF-8 text (RPC parameters, sessions, recent files) and become filesystem
// paths through platform::path_from_utf8 where a file is touched.
std::string absolute_path(const std::string& path) {
    std::error_code ec;
    const fs::path abs = fs::absolute(platform::path_from_utf8(path), ec);
    return ec ? path : platform::utf8_from_path(abs.lexically_normal());
}

model::FileKind file_kind_of(const std::string& path) {
    return model::file_kind_from_extension(
        platform::utf8_from_path(platform::path_from_utf8(path).extension()));
}

json issues_json(const std::vector<model::ValidationIssue>& issues) {
    json out = json::array();
    for (const auto& issue : issues) {
        out.push_back(model::to_json(issue));
    }
    return out;
}

model::Document document_param(const json& params) {
    const json& doc = rpc::params::object_field(params, "document");
    try {
        return model::document_from_json(doc);
    } catch (const model::CodecError& e) {
        throw rpc::invalid_params("document: " + e.detail, json{{"field", "document" + e.path}});
    }
}

// Runs `fn` on the loop thread and waits for its result (jobs touching the registry). The
// wait gives up when the job is cancelled (e.g. server shutdown, when the loop is gone); `fn`
// must capture its state by value so a late execution stays safe.
template <typename Fn>
auto on_loop_thread(Services& services, Fn fn, rpc::JobControl* control = nullptr)
    -> decltype(fn()) {
    using Result = decltype(fn());
    if (!services.post) {
        return fn();
    }
    auto promise = std::make_shared<std::promise<Result>>();
    auto future = promise->get_future();
    const bool posted = services.post([promise, fn = std::move(fn)]() mutable {
        try {
            promise->set_value(fn());
        } catch (...) {
            promise->set_exception(std::current_exception());
        }
    });
    if (!posted) {
        throw rpc::RpcError(rpc::codes::kCancelled, "server is shutting down");
    }
    while (future.wait_for(std::chrono::milliseconds(50)) != std::future_status::ready) {
        if (control != nullptr && control->cancelled()) {
            throw rpc::RpcError(rpc::codes::kCancelled,
                                "cancelled while waiting for the server thread");
        }
    }
    return future.get();
}

// The interface language setting (`view.uiLanguage`, "system" included) the filled-in date text
// follows when the regional settings cannot be determined (feature 003 FR-050). Read on the
// loop thread - the settings store is not shared with workers - and passed along by value.
std::string ui_language_setting(const Services& services) {
    return services.settings.get_string("view.uiLanguage", "system");
}

// The interface language resolved for format_long_date ("system" -> the OS language).
std::string resolved_ui_language(const Services& services) {
    const std::string setting = ui_language_setting(services);
    return setting == "system" || setting.empty() ? platform::system_language() : setting;
}

struct CalendarDate {
    int year = 0;
    int month = 0;
    int day = 0;
};

// A date value in the FB2 schema's form, YYYY-MM-DD, that exists in the calendar.
std::optional<CalendarDate> parse_calendar_date(const std::string& value) {
    if (value.size() != 10 || value[4] != '-' || value[7] != '-') {
        return std::nullopt;
    }
    for (std::size_t i : {0u, 1u, 2u, 3u, 5u, 6u, 8u, 9u}) {
        if (!std::isdigit(static_cast<unsigned char>(value[i]))) {
            return std::nullopt;
        }
    }
    CalendarDate date;
    date.year = std::stoi(value.substr(0, 4));
    date.month = std::stoi(value.substr(5, 2));
    date.day = std::stoi(value.substr(8, 2));
    if (date.month < 1 || date.month > 12 || date.day < 1) {
        return std::nullopt;
    }
    constexpr int kDays[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    const bool leap = (date.year % 4 == 0 && date.year % 100 != 0) || date.year % 400 == 0;
    const int days = date.month == 2 && leap ? 29 : kDays[date.month - 1];
    if (date.day > days) {
        return std::nullopt;
    }
    return date;
}

// Encoding a document is written in: explicit request, else the "Keep encoding" setting picks
// the opened file's encoding, else the configured default (utf-8 out of the box).
std::string effective_encoding(Services& services, const session::DocumentSession& s,
                               const std::optional<std::string>& requested) {
    std::string name;
    if (requested && !requested->empty()) {
        const auto canonical = encoding::normalize_name(*requested);
        if (!canonical || !encoding::is_supported(*canonical)) {
            throw rpc::invalid_params("unsupported encoding: " + *requested,
                                      json{{"field", "encoding"}});
        }
        name = *canonical;
    } else if (services.settings.get_bool("other.keepEncoding", false)) {
        name = encoding::normalize_name(s.sourceEncoding).value_or("utf-8");
    } else {
        name =
            encoding::normalize_name(services.settings.get_string("other.defaultEncoding", "utf-8"))
                .value_or("utf-8");
    }
    if (name.rfind("utf-16", 0) == 0) {
        name = "utf-16";  // written as UTF-16LE with a BOM
    }
    return name;
}

/* ----------------------------------------------------------------------------------------- */
/* Opening                                                                                    */
/* ----------------------------------------------------------------------------------------- */

struct Opened {
    fb2::ReadResult read;
    std::shared_ptr<BinaryStore> store = std::make_shared<BinaryStore>();
    model::NodeIdAllocator ids;
    platform::FileStamp stamp;
    std::string path;
    // Document details filled in on load (see the header).
    std::vector<std::string> filled_in;
};

// The document JSON of a loaded document, with the details filled in on load.
json loaded_document_json(const model::Document& doc, const std::vector<std::string>& filled_in) {
    json result = model::to_json(doc);
    result["filledIn"] = filled_in;
    return result;
}

// Reads a book with the hardened parser; the reader's failures become Open's errors 1004 /
// 1001 / 1002 (the description import reuses them, rpc-api §3.2).
fb2::ReadResult read_book(const std::string& path, BinaryStore& store,
                          model::NodeIdAllocator& ids) {
    try {
        return fb2::read_file(platform::path_from_utf8(path), store, ids);
    } catch (const fb2::NotFictionBookFailure& e) {
        throw not_fictionbook(path, e.reason);
    } catch (const fb2::ParseFailure& e) {
        throw parse_error(e.error);
    } catch (const fb2::IoFailure& e) {
        throw io_error(e.path, e.reason);
    }
}

// `ui_language` is the interface language setting for the filled-in date (see above).
Opened open_document(const std::string& path, const std::string& ui_language,
                     rpc::JobControl* control) {
    Opened opened;
    opened.path = path;
    opened.stamp = platform::stamp_of(platform::path_from_utf8(path));
    if (control != nullptr) {
        control->progress("read", 0, 100);
    }
    opened.read = read_book(path, *opened.store, opened.ids);
    opened.filled_in = model::fill_in_document_details(
        opened.read.document, model::details_context_now(false, ui_language));
    if (control != nullptr) {
        control->check_cancelled();
        control->progress("model", 90, 100);
    }
    return opened;
}

// Loop thread: fills a session with an opened document. `s` was created on the loop thread
// (so the docId was known while the worker serialised the result).
void fill_session(Services& services, session::DocumentSession& s, Opened& opened) {
    model::Document& doc = opened.read.document;
    doc.docId = s.docId;
    s.path = opened.path;
    s.fileKind = doc.fileKind;
    s.sourceEncoding = doc.sourceEncoding;
    s.xlinkPrefix = opened.read.xlink_prefix;
    s.schemaHint = doc.schemaHint;
    s.sourceOnly = false;
    if (opened.stamp.exists) {
        s.lastKnownMtime = opened.stamp.mtime;
        s.lastKnownSize = opened.stamp.size;
    }
    s.binaries = std::move(opened.store);
    s.ids = opened.ids;
    s.caret = services.recent.caret(opened.path);
    services.recent.touch(opened.path);
    s.snapshot = std::move(doc);
}

// Loop thread, synchronous path: session + result in one go.
json register_session(Services& services, Opened&& opened) {
    session::DocumentSession& s = services.documents.create();
    opened.read.document.docId = s.docId;
    json result{{"document", loaded_document_json(opened.read.document, opened.filled_in)},
                {"warnings", issues_json(opened.read.warnings)}};
    fill_session(services, s, opened);
    return result;
}

// Rough in-memory size of a model (text plus a fixed cost per node) for the job threshold.
std::uintmax_t approximate_size(const model::Document& doc) {
    std::uintmax_t total = 0;
    const std::function<void(const model::Node&)> walk = [&](const model::Node& n) {
        total += 64 + n.text.size();
        for (const auto& c : n.content) {
            walk(c);
        }
    };
    for (const auto& body : doc.bodies) {
        walk(body);
    }
    return total;
}

/* ----------------------------------------------------------------------------------------- */
/* Description import (feature 004 US4)                                                       */
/* ----------------------------------------------------------------------------------------- */

// What doc.readDescription keeps of a source file: its description as read (no filling-in),
// the document-info as Open would have filled it in, the reader's warnings and a store holding
// only the binaries the description's importable entries refer to.
struct ReadDescription {
    model::Document document;  // description only: bodies, stylesheets and extras dropped
    model::DocumentInfo details;
    std::vector<model::ValidationIssue> warnings;
    std::shared_ptr<BinaryStore> store = std::make_shared<BinaryStore>();
    model::NodeIdAllocator ids;
};

// Worker or loop thread: reads the whole file as Open reads it (a malformed body refuses the
// import too), then drops everything but the description and the binaries it refers to from
// an importable entry - the cover pages and the images of the annotations and the history;
// `output` is no importable entry, so a binary referenced only there is dropped as well.
ReadDescription read_description(const std::string& path, const std::string& ui_language,
                                 rpc::JobControl* control) {
    ReadDescription out;
    if (control != nullptr) {
        control->progress("read", 0, 100);
    }
    fb2::ReadResult read = read_book(path, *out.store, out.ids);
    out.warnings = std::move(read.warnings);
    model::Document& doc = read.document;
    // The details as Open would fill them in, computed on a copy: the description itself
    // stays as read, so the UI can tell what the file has from what the editor adds.
    model::Document details;
    details.description.documentInfo = doc.description.documentInfo;
    model::fill_in_document_details(details, model::details_context_now(false, ui_language));
    out.details = std::move(details.description.documentInfo);
    doc.bodies.clear();
    doc.stylesheets.clear();
    doc.extras.clear();
    doc.path.reset();
    const std::vector<std::string> referenced =
        referenced_ids(doc, ReferenceRoots{.description = true, .outputs = false, .bodies = false});
    for (const std::string& id : out.store->ids()) {
        if (std::find(referenced.begin(), referenced.end(), id) == referenced.end()) {
            out.store->remove(id);
        }
    }
    sync_binaries(doc, *out.store);
    out.document = std::move(doc);
    if (control != nullptr) {
        control->check_cancelled();
        control->progress("model", 90, 100);
    }
    return out;
}

// Loop thread: gives the imported description its node ids from the target's allocator (so
// the imported annotation and history can be inserted into the open document without a
// collision) and registers the hidden import session holding the binaries. 1000 when the
// target was closed meanwhile.
json register_import(Services& services, const std::string& target_id, ReadDescription& read) {
    session::DocumentSession& target = services.documents.require(target_id);
    model::reassign_node_ids(read.document, target.ids);
    session::DocumentSession& s = services.documents.create();
    read.document.docId = s.docId;
    s.binaries = read.store;
    s.ids = read.ids;
    s.sourceOnly = false;
    json binaries = json::array();
    for (const auto& meta : read.store->list()) {
        binaries.push_back(model::to_json(meta));
    }
    json result{{"importId", s.docId},
                {"description", model::to_json(read.document.description)},
                {"documentDetails", model::to_json(read.details)},
                {"binaries", std::move(binaries)},
                {"warnings", issues_json(read.warnings)}};
    s.snapshot = std::move(read.document);
    return result;
}

// Loop thread: forgets an import session with its previews.
void close_import(Services& services, const std::string& import_id) {
    services.previews.invalidate_prefix(import_id + "/");
    services.documents.close(import_id);
}

/* ----------------------------------------------------------------------------------------- */
/* Saving                                                                                     */
/* ----------------------------------------------------------------------------------------- */

struct SaveRequest {
    std::string doc_id;
    std::optional<model::Document> document;  // model save
    std::optional<std::string> text;          // Source-only save (text written as-is)
    std::string path;                         // absolute target
    std::string encoding;                     // canonical
    bool force = false;
    std::string xlink_prefix;
    std::shared_ptr<BinaryStore> store;
    std::optional<settings::Caret> caret;
    images::ConversionPolicy policy;  // image conversion on save (FR-110)
};

// BinaryMeta JSON extended with the content types before/after conversion.
json converted_json(const std::vector<images::Converted>& converted) {
    json out = json::array();
    for (const images::Converted& c : converted) {
        json j = model::to_json(c.meta);
        j["from"] = c.from;
        j["to"] = c.to;
        out.push_back(std::move(j));
    }
    return out;
}

// Rewrites (or inserts) the encoding of the XML declaration of Source-only text.
std::string with_declared_encoding(std::string text, const std::string& encoding) {
    std::size_t pos = 0;
    while (pos < text.size() &&
           (text[pos] == ' ' || text[pos] == '\n' || text[pos] == '\r' || text[pos] == '\t')) {
        ++pos;
    }
    if (text.compare(pos, 5, "<?xml") != 0) {
        return "<?xml version=\"1.0\" encoding=\"" + encoding + "\"?>\n" + text;
    }
    const std::size_t end = text.find("?>", pos);
    if (end == std::string::npos) {
        return text;
    }
    std::string decl = text.substr(pos, end - pos);
    const std::size_t enc = decl.find("encoding");
    if (enc == std::string::npos) {
        decl += " encoding=\"" + encoding + "\"";
    } else {
        std::size_t q1 = decl.find_first_of("\"'", enc);
        if (q1 == std::string::npos) {
            return text;
        }
        const std::size_t q2 = decl.find(decl[q1], q1 + 1);
        if (q2 == std::string::npos) {
            return text;
        }
        decl.replace(q1 + 1, q2 - q1 - 1, encoding);
    }
    return text.substr(0, pos) + decl + text.substr(end);
}

json perform_save(Services& services, SaveRequest& request, rpc::JobControl* control) {
    const auto progress = [&](const char* phase, int done) {
        if (control != nullptr) {
            control->check_cancelled();
            control->progress(phase, done, 100);
        }
    };
    progress("validate", 0);
    std::string text;
    model::ValidationReport validation;
    std::vector<images::Converted> converted;
    if (request.document) {
        update_reference_counts(*request.document, *request.store);
        validation = validation::validate_document(*request.document, request.store.get(),
                                                   request.xlink_prefix);
        if (validation.errorCount > 0 && !request.force) {
            return json{{"needsConfirmation", true}, {"validation", model::to_json(validation)}};
        }
        // Saved documents contain only JPEG/PNG images (FR-110): convert the `willConvert`
        // binaries in the live store (same ids, so every reference stays valid), then
        // serialise. Undecodable payloads are kept verbatim and reported (FR-111).
        progress("convert", 30);
        converted =
            images::convert_store(
                *request.store, request.policy,
                [&](std::size_t done, std::size_t total) {
                    if (control != nullptr && total > 0) {
                        control->progress("convert",
                                          30 + static_cast<std::int64_t>(30 * done / total), 100);
                    }
                })
                .converted;
        progress("serialize", 60);
        fb2::WriteOptions options;
        options.encoding = request.encoding;
        options.xlink_prefix = request.xlink_prefix;
        text = fb2::write_document(*request.document, request.store.get(), options).text;
    } else {
        text = with_declared_encoding(*request.text, request.encoding);
        progress("validate", 40);
        validation = validation::validate_xml_text(text);
        if (validation.errorCount > 0 && !request.force) {
            return json{{"needsConfirmation", true}, {"validation", model::to_json(validation)}};
        }
    }
    progress("write", 70);
    const std::string bytes = fb2::encode_document(text, request.encoding);
    const fs::path target = platform::path_from_utf8(request.path);
    try {
        atomic_file::write_atomic(target, bytes);
    } catch (const atomic_file::WriteError& e) {
        // Logged once by the router as rpc.doc.ioError (method, docId, path, reason).
        throw io_error(e.path, e.reason);
    }
    const platform::FileStamp stamp = platform::stamp_of(target);

    // Session bookkeeping on the loop thread (the session may have been closed meanwhile).
    const std::string doc_id = request.doc_id;
    const std::string path = request.path;
    const std::string enc = request.encoding;
    auto snapshot = request.document
                        ? std::make_shared<model::Document>(std::move(*request.document))
                        : nullptr;
    const auto caret = request.caret;
    std::vector<std::string> converted_ids;
    for (const auto& c : converted) {
        converted_ids.push_back(c.id);
    }
    auto update = [&services, doc_id, path, enc, stamp, snapshot, caret, converted_ids]() -> int {
        session::DocumentSession* s = services.documents.find(doc_id);
        for (const std::string& id : converted_ids) {
            services.previews.invalidate_prefix(doc_id + "/" + id + "@");
        }
        if (s != nullptr) {
            s->path = path;
            s->fileKind = file_kind_of(path);
            s->sourceEncoding = enc;
            if (stamp.exists) {
                s->lastKnownMtime = stamp.mtime;
                s->lastKnownSize = stamp.size;
            }
            if (snapshot) {
                snapshot->docId = doc_id;
                snapshot->path = path;
                snapshot->fileKind = s->fileKind;
                snapshot->sourceEncoding = enc;
                sync_binaries(*snapshot, *s->binaries);
                s->snapshot = std::move(*snapshot);
                s->sourceOnly = false;
            }
            if (s->watching && services.watcher) {
                // Re-point + refresh after our own save.
                services.watcher->watch(doc_id, platform::path_from_utf8(path));
            }
        }
        services.recent.touch(path, caret);
        return 0;
    };
    if (control == nullptr) {
        update();  // synchronous call: already on the loop thread
    } else {
        on_loop_thread(services, update, control);
    }
    progress("done", 100);
    return json{{"path", path},
                {"encoding", enc},
                {"converted", converted_json(converted)},
                {"validation", model::to_json(validation)}};
}

/* ----------------------------------------------------------------------------------------- */
/* Validation                                                                                 */
/* ----------------------------------------------------------------------------------------- */

model::ValidationReport validate_text_with_model(const std::string& text,
                                                 const std::shared_ptr<BinaryStore>& store,
                                                 const std::string& xlink_prefix) {
    model::ValidationReport report = validation::validate_xml_text(text);
    if (report.errorCount == 0 || report.issues.empty() ||
        report.issues[0].code != "xml.notWellFormed") {
        // Well-formed: add the model-level consistency checks on a scratch parse.
        BinaryStore scratch(BinaryStore::kNoSpill);
        model::NodeIdAllocator ids;
        fb2::ReadOptions options;
        options.force_encoding = "utf-8";
        options.compute_schema_hint = false;
        options.placeholder_source = store.get();
        try {
            const fb2::ReadResult read = fb2::read_bytes(text, scratch, ids, options);
            (void)xlink_prefix;
            auto extra = validation::consistency_issues(read.document, &scratch);
            report.issues.insert(report.issues.end(), extra.begin(), extra.end());
            for (const auto& w : read.warnings) {
                report.issues.push_back(w);
            }
            validation::finalize_report(report);
        } catch (const fb2::ParseFailure&) {
            // already reported by validate_xml_text
        }
    }
    return report;
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Watcher                                                                                    */
/* ----------------------------------------------------------------------------------------- */

platform::FileWatcher& file_watcher(Services& services) {
    if (!services.watcher) {
        services.watcher = std::make_unique<platform::FileWatcher>(
            [&services](const std::string& doc_id, const std::string& path, std::int64_t mtime) {
                auto notify = [&services, doc_id, path, mtime] {
                    if (session::DocumentSession* s = services.documents.find(doc_id)) {
                        s->lastKnownMtime = mtime;
                        std::error_code ec;
                        s->lastKnownSize = fs::file_size(platform::path_from_utf8(path), ec);
                    }
                    services.notifier.notify(
                        "doc.changedOnDisk",
                        json{{"docId", doc_id}, {"path", path}, {"mtime", mtime}});
                };
                if (!services.post || !services.post(notify)) {
                    services.notifier.notify(
                        "doc.changedOnDisk",
                        json{{"docId", doc_id}, {"path", path}, {"mtime", mtime}});
                }
            });
    }
    return *services.watcher;
}

/* ----------------------------------------------------------------------------------------- */
/* Handlers                                                                                   */
/* ----------------------------------------------------------------------------------------- */

void register_doc_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("doc.new", [&services](const json&, rpc::RpcContext&) {
        // The first blank.fb2 of the template layers; a user file that turns out unusable
        // gives way to the bundled one (resource-formats §2a).
        resources::EffectiveTemplate effective = resources::resolve_template(
            services.layers,
            platform::path_from_utf8(services.settings.get_string("other.templateFolder")));
        Opened opened;
        const auto read_template = [&opened](const fs::path& file) {
            opened = Opened{};
            fb2::ReadOptions options;
            options.file_kind = model::FileKind::fb2;
            opened.read =
                fb2::read_bytes(fb2::read_file_bytes(file), *opened.store, opened.ids, options);
        };
        try {
            read_template(effective.path);
        } catch (const std::exception& e) {
            if (effective.layer == resources::LayerName::bundled) {
                throw rpc::internal_error(std::string("blank template unusable: ") + e.what());
            }
            effective.issue = resources::TemplateIssue{effective.path, "notWellFormed", e.what()};
            effective.path =
                services.layers.roots().bundled_resources / resources::kTemplateFileName;
            effective.layer = resources::LayerName::bundled;
            try {
                read_template(effective.path);
            } catch (const std::exception& bundled) {
                throw rpc::internal_error(std::string("blank template unusable: ") +
                                          bundled.what());
            }
        }
        session::DocumentSession& s = services.documents.create();
        model::Document& doc = opened.read.document;
        doc.docId = s.docId;
        doc.path.reset();
        doc.sourceEncoding = "utf-8";
        const std::vector<std::string> filled_in = model::fill_in_document_details(
            doc, model::details_context_now(true, ui_language_setting(services)));
        s.fileKind = model::FileKind::fb2;
        s.sourceEncoding = "utf-8";
        s.xlinkPrefix = opened.read.xlink_prefix;
        s.schemaHint = doc.schemaHint;
        s.binaries = std::move(opened.store);
        s.ids = opened.ids;
        s.snapshot = doc;
        json result = loaded_document_json(doc, filled_in);
        if (effective.issue) {
            result["templateIssue"] = resources::to_json(*effective.issue);
        }
        return result;
    });

    router.add_method("doc.open", [&services](const json& params, rpc::RpcContext& ctx) {
        const std::string path = absolute_path(rpc::params::string(params, "path"));
        const fs::path file = platform::path_from_utf8(path);
        std::error_code ec;
        if (!fs::exists(file, ec)) {
            services.recent.remove(path);  // prune missing files (resource-formats.md §8)
            throw io_error(path, "file not found");
        }
        const std::uintmax_t size = fs::file_size(file, ec);
        const std::string ui_language = ui_language_setting(services);
        if (ec || size < kJobThresholdBytes) {
            Opened opened = open_document(path, ui_language, nullptr);
            return register_session(services, std::move(opened));
        }
        // The session (and its docId) exists from the start; the worker parses and builds the
        // JSON result, the loop thread only moves the data into the session at the end.
        const std::string doc_id = services.documents.create().docId;
        const std::string job_id = ctx.jobs.start(
            [&services, path, doc_id, ui_language](rpc::JobControl& control) -> json {
                auto opened = std::make_shared<Opened>();
                try {
                    *opened = open_document(path, ui_language, &control);
                } catch (...) {
                    on_loop_thread(
                        services,
                        [&services, doc_id] {
                            services.documents.close(doc_id);
                            return 0;
                        },
                        &control);
                    throw;
                }
                opened->read.document.docId = doc_id;
                json result{
                    {"document", loaded_document_json(opened->read.document, opened->filled_in)},
                    {"warnings", issues_json(opened->read.warnings)}};
                const bool registered = on_loop_thread(
                    services,
                    [&services, doc_id, opened] {
                        session::DocumentSession* s = services.documents.find(doc_id);
                        if (s == nullptr) {
                            return false;  // closed while loading
                        }
                        fill_session(services, *s, *opened);
                        return true;
                    },
                    &control);
                if (!registered) {
                    throw rpc::RpcError(rpc::codes::kCancelled, "document was closed while loading",
                                        json{{"docId", doc_id}});
                }
                control.progress("done", 100, 100);
                return result;
            });
        return json{{"jobId", job_id}};
    });

    router.add_method("doc.openSource", [&services](const json& params, rpc::RpcContext&) {
        const std::string path = absolute_path(rpc::params::string(params, "path"));
        const fs::path file = platform::path_from_utf8(path);
        fb2::SourceText source;
        try {
            source = fb2::read_source(file);
        } catch (const fb2::NotFictionBookFailure& e) {
            throw not_fictionbook(path, e.reason);
        } catch (const fb2::IoFailure& e) {
            services.recent.remove(path);
            throw io_error(e.path, e.reason);
        }
        session::DocumentSession& s = services.documents.create();
        s.path = path;
        s.fileKind = file_kind_of(path);
        s.sourceEncoding = source.encoding;
        s.schemaHint = model::SchemaHint::unknown;
        s.sourceOnly = source.error.has_value();
        const platform::FileStamp stamp = platform::stamp_of(file);
        if (stamp.exists) {
            s.lastKnownMtime = stamp.mtime;
            s.lastKnownSize = stamp.size;
        }
        s.caret = services.recent.caret(path);
        services.recent.touch(path);
        json result{{"docId", s.docId},
                    {"text", source.text},
                    {"encoding", source.encoding},
                    {"warnings", issues_json(source.warnings)}};
        if (source.error) {
            result["error"] = json{{"line", source.error->line},
                                   {"column", source.error->column},
                                   {"message", source.error->message}};
        }
        return result;
    });

    router.add_method("doc.readDescription", [&services](const json& params, rpc::RpcContext& ctx) {
        const std::string target_id = rpc::params::string(params, "docId");
        services.documents.require(target_id);
        const std::string path = absolute_path(rpc::params::string(params, "path"));
        const fs::path file = platform::path_from_utf8(path);
        std::error_code ec;
        if (!fs::exists(file, ec)) {
            // Unlike doc.open, a missing source prunes nothing: it was never a recent file.
            throw io_error(path, "file not found");
        }
        const std::uintmax_t size = fs::file_size(file, ec);
        const std::string ui_language = ui_language_setting(services);
        if (ec || size < kJobThresholdBytes) {
            ReadDescription read = read_description(path, ui_language, nullptr);
            return register_import(services, target_id, read);
        }
        // Open's job: the worker parses, the loop thread registers the hidden session at
        // the end - a cancellation before that leaves nothing behind, one that arrives
        // while the session is being registered takes it down again.
        const std::string job_id = ctx.jobs.start([&services, path, target_id,
                                                   ui_language](rpc::JobControl& control) -> json {
            auto read =
                std::make_shared<ReadDescription>(read_description(path, ui_language, &control));
            control.check_cancelled();
            json result = on_loop_thread(
                services,
                [&services, target_id, read] {
                    return register_import(services, target_id, *read);
                },
                &control);
            if (control.cancelled()) {
                const std::string import_id = result["importId"];
                on_loop_thread(services, [&services, import_id] {
                    close_import(services, import_id);
                    return 0;
                });
                control.check_cancelled();
            }
            control.progress("done", 100, 100);
            return result;
        });
        return json{{"jobId", job_id}};
    });

    router.add_method("doc.close", [&services](const json& params, rpc::RpcContext&) {
        const std::string doc_id = rpc::params::string(params, "docId");
        if (services.watcher) {
            services.watcher->unwatch(doc_id);
        }
        // An import session's previews (the dialog's cover picture) go with it (feature 004).
        services.previews.invalidate_prefix(doc_id + "/");
        if (!services.documents.close(doc_id)) {
            throw rpc::RpcError(rpc::codes::kDocNotFound, "", json{{"docId", doc_id}});
        }
        return json::object();
    });

    router.add_method("doc.toXml", [&services](const json& params, rpc::RpcContext&) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        model::Document doc = document_param(params);
        fb2::WriteOptions options;
        options.elide_binaries = rpc::params::boolean_or(params, "elideBinaries", false);
        options.xlink_prefix = s.xlinkPrefix;
        options.encoding = effective_encoding(services, s, std::nullopt);
        update_reference_counts(doc, *s.binaries);
        return json{{"text", fb2::write_document(doc, s.binaries.get(), options).text}};
    });

    router.add_method("doc.fromXml", [&services](const json& params, rpc::RpcContext&) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        const std::string text = rpc::params::string(params, "text");
        auto store = std::make_shared<BinaryStore>();
        fb2::ReadOptions options;
        options.force_encoding = "utf-8";
        options.file_kind = s.fileKind;
        options.placeholder_source = s.binaries.get();
        fb2::ReadResult read;
        try {
            read = fb2::read_bytes(text, *store, s.ids, options, s.path.value_or(""));
        } catch (const fb2::ParseFailure& e) {
            throw parse_error(e.error);
        }
        model::Document& doc = read.document;
        doc.docId = s.docId;
        doc.path = s.path;
        doc.fileKind = s.fileKind;
        doc.sourceEncoding = s.sourceEncoding;
        const std::vector<std::string> filled_in = model::fill_in_document_details(
            doc, model::details_context_now(false, ui_language_setting(services)));
        json result{{"document", nullptr}, {"warnings", issues_json(read.warnings)}};
        if (s.snapshot) {
            result["remap"] = model::build_remap(*s.snapshot, doc).to_json();
        }
        s.binaries = std::move(store);
        s.xlinkPrefix = read.xlink_prefix;
        s.schemaHint = doc.schemaHint;
        s.sourceOnly = false;
        s.snapshot = doc;
        result["document"] = loaded_document_json(doc, filled_in);
        return result;
    });

    // The Today button's date text (feature 003 FR-050): the same function that fills in the
    // date of a loaded document, so both write the system's regional long date.
    router.add_method("doc.formatDate", [&services](const json& params, rpc::RpcContext&) {
        const std::string value = rpc::params::string(params, "value");
        const std::optional<CalendarDate> date = parse_calendar_date(value);
        if (!date) {
            throw rpc::invalid_params("value must be a calendar date as YYYY-MM-DD",
                                      json{{"field", "value"}});
        }
        return json{{"text", platform::format_long_date(date->year, date->month, date->day,
                                                        resolved_ui_language(services))}};
    });

    router.add_method("doc.save", [&services](const json& params, rpc::RpcContext& ctx) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        SaveRequest request;
        request.doc_id = s.docId;
        if (rpc::params::opt_field(params, "document") != nullptr) {
            request.document = document_param(params);
        } else if (auto text = rpc::params::opt_string(params, "text")) {
            request.text = *text;
        } else if (s.snapshot) {
            request.document = *s.snapshot;
        } else {
            throw rpc::invalid_params("document or text is required", json{{"field", "document"}});
        }
        const auto path = rpc::params::opt_string(params, "path");
        if (path && !path->empty()) {
            request.path = absolute_path(*path);
        } else if (s.path) {
            request.path = *s.path;
        } else {
            throw rpc::invalid_params("path is required for a new document",
                                      json{{"field", "path"}});
        }
        request.encoding =
            effective_encoding(services, s, rpc::params::opt_string(params, "encoding"));
        request.force = rpc::params::boolean_or(params, "force", false);
        request.xlink_prefix = s.xlinkPrefix;
        request.store = s.binaries;
        request.caret = s.caret;
        request.policy = services.conversion_policy();

        const std::uintmax_t estimate =
            static_cast<std::uintmax_t>(s.binaries->total_bytes()) +
            (request.text ? request.text->size() : static_cast<std::size_t>(0));
        const bool big =
            estimate >= kJobThresholdBytes ||
            (request.document && approximate_size(*request.document) >= kJobThresholdBytes);
        if (!big) {
            return perform_save(services, request, nullptr);
        }
        auto shared = std::make_shared<SaveRequest>(std::move(request));
        const std::string job_id = ctx.jobs.start([&services, shared](rpc::JobControl& control) {
            return perform_save(services, *shared, &control);
        });
        return json{{"jobId", job_id}};
    });

    router.add_method("doc.validate", [&services](const json& params, rpc::RpcContext& ctx) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        const std::string xlink = s.xlinkPrefix;
        std::shared_ptr<BinaryStore> store = s.binaries;
        if (auto text = rpc::params::opt_string(params, "text")) {
            if (text->size() < kJobThresholdBytes) {
                return model::to_json(validate_text_with_model(*text, store, xlink));
            }
            auto shared = std::make_shared<std::string>(std::move(*text));
            const std::string job_id =
                ctx.jobs.start([shared, store, xlink](rpc::JobControl& control) {
                    control.progress("validate", 0, 100);
                    return model::to_json(validate_text_with_model(*shared, store, xlink));
                });
            return json{{"jobId", job_id}};
        }
        model::Document doc;
        if (rpc::params::opt_field(params, "document") != nullptr) {
            doc = document_param(params);
        } else if (s.snapshot) {
            doc = *s.snapshot;
        } else {
            throw rpc::invalid_params("document or text is required", json{{"field", "document"}});
        }
        const bool big = static_cast<std::uintmax_t>(store->total_bytes()) >= kJobThresholdBytes ||
                         approximate_size(doc) >= kJobThresholdBytes;
        if (!big) {
            update_reference_counts(doc, *store);
            return model::to_json(validation::validate_document(doc, store.get(), xlink));
        }
        auto shared = std::make_shared<model::Document>(std::move(doc));
        const std::string job_id = ctx.jobs.start([shared, store, xlink](rpc::JobControl& control) {
            control.progress("validate", 0, 100);
            update_reference_counts(*shared, *store);
            return model::to_json(validation::validate_document(*shared, store.get(), xlink));
        });
        return json{{"jobId", job_id}};
    });

    router.add_method("doc.recent", [&services](const json&, rpc::RpcContext&) {
        json out = json::array();
        for (const auto& item : services.recent.items()) {
            json j = settings::to_json(item);
            std::error_code ec;
            j["exists"] = fs::exists(platform::path_from_utf8(item.path), ec);
            out.push_back(std::move(j));
        }
        return out;
    });

    router.add_method("doc.clearRecent", [&services](const json&, rpc::RpcContext&) {
        services.recent.clear();
        return json::object();
    });

    router.add_method("doc.caret", [&services](const json& params, rpc::RpcContext&) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        if (const json* caret = rpc::params::opt_field(params, "caret")) {
            const auto parsed = settings::caret_from_json(*caret);
            if (!parsed) {
                throw rpc::invalid_params("caret must be {view, nodeId?, offset?, line?, column?}",
                                          json{{"field", "caret"}});
            }
            s.caret = parsed;
            if (s.path) {
                services.recent.set_caret(*s.path, parsed);
            }
        }
        json result = json::object();
        if (s.caret) {
            result["caret"] = settings::to_json(*s.caret);
        }
        return result;
    });

    router.add_method("doc.watch", [&services](const json& params, rpc::RpcContext&) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        const bool enabled = rpc::params::boolean_or(params, "enabled", true);
        if (enabled) {
            if (!s.path) {
                throw rpc::invalid_params("document has no file to watch",
                                          json{{"field", "docId"}});
            }
            file_watcher(services).watch(s.docId, platform::path_from_utf8(*s.path));
            s.watching = true;
        } else {
            if (services.watcher) {
                services.watcher->unwatch(s.docId);
            }
            s.watching = false;
        }
        return json::object();
    });
}

}  // namespace mfbe::server
