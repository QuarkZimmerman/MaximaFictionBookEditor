// files.* handlers (feature 007, contracts/rpc-api.md §3.x of the feature, FR-024): the core side
// of the script API's mfbe.files - the powers of constitution principle V (b), performed by the
// editor at a script's request, never by the script's own code.
//
//   files.saveText({suggestedName, text, encoding?, title?}) -> {saved, name?}
//        The native Save dialog (the provider File > Save As uses, with its own overwrite
//        question) proposes `suggestedName`; the text is written atomically in `encoding`
//        (utf-8 without a BOM - the default -, utf-16 little endian with a BOM, windows-1251 with
//        '?' for what it cannot hold). A cancelled dialog: {saved: false}. `name` is the file
//        name alone, never the folder. Errors: invalidParams {field}, 1002 doc.ioError {path,
//        reason}, 1050 without a shell.
//   files.saveBinaries({docId, ids?, title?, folderToken?, overwrite?})
//        -> {saved, skipped: [ids], folderToken}
//        Without a token the native folder dialog; then each binary of `ids` (all when omitted)
//        is written with its original bytes, named by its id - an existing file is skipped
//        unless `overwrite`. The folder stays in the core: the answer carries a token, kept in
//        the document's session until it closes, for the second call that overwrites what the
//        user confirmed. A cancelled dialog: {saved: 0, skipped: [], folderToken: ""}. Errors:
//        1000 doc.notFound, 1010 binary.notFound {id}, invalidParams {field: 'folderToken'} for
//        a token the document does not hold, 1002 doc.ioError.
#include "server/services.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/dialog_provider.hpp>
#include <mfbe/encodings.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/utf8_paths.hpp>

#include <filesystem>
#include <memory>
#include <random>
#include <string>
#include <system_error>
#include <thread>
#include <vector>

namespace mfbe::server {
namespace {

using nlohmann::json;
namespace fs = std::filesystem;

std::shared_ptr<DialogProvider> require_provider(Services& services) {
    auto provider = services.dialog_provider();
    if (!provider) {
        throw rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                            json{{"reason", "no shell to show a native dialog"}});
    }
    return provider;
}

rpc::RpcError io_error(const fs::path& path, const std::string& reason) {
    return rpc::RpcError(rpc::codes::kDocIoError, "",
                         json{{"path", platform::utf8_from_path(path)}, {"reason", reason}});
}

// A file name and nothing else: no folder part, no "." or "..".
bool is_bare_file_name(const std::string& name) {
    if (name.empty() || name == "." || name == "..") {
        return false;
    }
    return name.find_first_of("/\\") == std::string::npos;
}

// The types of the Save dialog: the suggested name's own (named by their pattern, which needs
// no translation), then every file.
std::vector<FileFilter> text_filters(const std::string& suggested) {
    std::string extension =
        platform::utf8_from_path(platform::path_from_utf8(suggested).extension());
    for (char& c : extension) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    std::vector<FileFilter> filters;
    if (extension == ".html" || extension == ".htm") {
        filters.push_back({"*.html, *.htm", {"html", "htm"}});
    } else if (extension.size() > 1) {
        const std::string bare = extension.substr(1);
        filters.push_back({"*." + bare, {bare}});
    }
    filters.push_back({"*.*", {"*"}});
    return filters;
}

std::string encode_text(const std::string& text, const std::string& target) {
    if (target == "utf-8") {
        return text;
    }
    return encoding::encode_from_utf8(text, target, /*char_refs=*/false).bytes;
}

// The file name a binary is written under: its id, with every character a file name may not
// hold on some platform replaced by '_'.
std::string binary_file_name(const std::string& id) {
    std::string name;
    name.reserve(id.size());
    for (const char c : id) {
        const auto u = static_cast<unsigned char>(c);
        const bool forbidden = u < 0x20 || u == 0x7F ||
                               std::string_view("/\\:*?\"<>|").find(c) != std::string_view::npos;
        name.push_back(forbidden ? '_' : c);
    }
    while (!name.empty() && (name.back() == '.' || name.back() == ' ')) {
        name.pop_back();
    }
    if (name.empty() || name == "." || name == "..") {
        name = "_";
    }
    return name;
}

std::string new_token() {
    std::random_device rd;
    static const char* kHex = "0123456789abcdef";
    std::string token;
    for (int i = 0; i < 32; ++i) {
        token.push_back(kHex[rd() & 0x0F]);
    }
    return token;
}

struct BinariesJob {
    std::shared_ptr<BinaryStore> binaries;
    std::vector<std::string> ids;
    fs::path folder;
    std::string token;
    bool overwrite = false;
};

// Writes the binaries off the transport thread (a book's pictures may be large) and answers.
void write_binaries(BinariesJob job, rpc::Responder respond) {
    std::thread([job = std::move(job), respond]() {
        int saved = 0;
        json skipped = json::array();
        for (const std::string& id : job.ids) {
            const fs::path target = job.folder / platform::path_from_utf8(binary_file_name(id));
            std::error_code ec;
            if (!job.overwrite && fs::exists(fs::symlink_status(target, ec))) {
                skipped.push_back(id);
                continue;
            }
            const std::optional<std::string> bytes = job.binaries->bytes(id);
            if (!bytes) {
                respond.fail(rpc::RpcError(rpc::codes::kBinaryNotFound, "", json{{"id", id}}));
                return;
            }
            try {
                atomic_file::write_atomic(target, *bytes);
            } catch (const atomic_file::WriteError& e) {
                respond.fail(io_error(target, e.reason));
                return;
            }
            ++saved;
        }
        respond.ok(
            json{{"saved", saved}, {"skipped", std::move(skipped)}, {"folderToken", job.token}});
    }).detach();
}

// The ids to write: `ids` when given (each must be a binary of the document), else all.
std::vector<std::string> requested_ids(const json& p, const BinaryStore& binaries) {
    if (!p.contains("ids") || p["ids"].is_null()) {
        return binaries.ids();
    }
    if (!p["ids"].is_array()) {
        throw rpc::invalid_params("ids must be an array of binary ids", json{{"field", "ids"}});
    }
    std::vector<std::string> ids;
    for (const json& id : p["ids"]) {
        if (!id.is_string()) {
            throw rpc::invalid_params("ids must be an array of binary ids", json{{"field", "ids"}});
        }
        if (!binaries.contains(id.get<std::string>())) {
            throw rpc::RpcError(rpc::codes::kBinaryNotFound, "", json{{"id", id}});
        }
        ids.push_back(id.get<std::string>());
    }
    return ids;
}

}  // namespace

void register_files_handlers(rpc::RpcRouter& router, Services& services) {
    // Feature 009 (rpc-api §1): what a file is before Save As writes it - for the question when
    // a completed name points at an existing file, and the one when the chosen archive holds
    // other files (D32): `otherEntries` counts its files other than one named `entryName`.
    router.add_method("files.inspect", [](const json& params, rpc::RpcContext&) {
        const json& p = rpc::params::object(params);
        const fs::path file = platform::path_from_utf8(rpc::params::string(p, "path"));
        if (!file.is_absolute()) {
            throw rpc::invalid_params("path must be absolute", json{{"field", "path"}});
        }
        const std::optional<std::string> entry_name = rpc::params::opt_string(p, "entryName");
        const archive::Kind kind = archive::detect_kind(file);
        json result{
            {"exists", kind != archive::Kind::missing},
            {"kind", archive::is_other_archive(kind) ? "otherArchive" : archive::kind_name(kind)}};
        if (kind == archive::Kind::zip) {
            try {
                const archive::Listing listing = archive::list(file);
                std::uint64_t others = 0;
                for (const archive::Entry& e : listing.entries) {
                    if (!e.directory && (!entry_name || e.name != *entry_name)) {
                        ++others;
                    }
                }
                result["otherEntries"] = others;
                result["books"] = listing.books_total;
                if (listing.books_total == 1) {
                    result["onlyBook"] = listing.books.front().entry;
                }
            } catch (const archive::ArchiveError&) {
                // A damaged archive: its contents are unknown; a ZIP save replaces it whole.
            }
        }
        return result;
    });

    router.add_async_method("files.saveText", [&services](const json& params, rpc::RpcContext&,
                                                          rpc::Responder respond) {
        const json& p = rpc::params::object(params);
        const std::optional<std::string> suggested = rpc::params::opt_string(p, "suggestedName");
        if (!suggested || !is_bare_file_name(*suggested)) {
            throw rpc::invalid_params("suggestedName must be a file name",
                                      json{{"field", "suggestedName"}});
        }
        if (!p.contains("text") || !p["text"].is_string()) {
            throw rpc::invalid_params("text must be a string", json{{"field", "text"}});
        }
        const std::string encoding = rpc::params::string_or(p, "encoding", "utf-8");
        if (encoding != "utf-8" && encoding != "utf-16" && encoding != "windows-1251") {
            throw rpc::invalid_params("encoding must be utf-8, utf-16 or windows-1251",
                                      json{{"field", "encoding"}});
        }
        auto provider = require_provider(services);
        SaveFileRequest request;
        request.title = rpc::params::string_or(p, "title", "");
        request.defaultPath = *suggested;
        request.filters = text_filters(*suggested);
        const std::string bytes = encode_text(p["text"].get<std::string>(), encoding);
        try {
            provider->save_file(request, [respond, bytes](SaveFileResult result) {
                if (!result.path) {
                    respond.ok(json{{"saved", false}});
                    return;
                }
                const fs::path path = platform::path_from_utf8(*result.path);
                try {
                    atomic_file::write_atomic(path, bytes);
                } catch (const atomic_file::WriteError& e) {
                    respond.fail(io_error(path, e.reason));
                    return;
                }
                respond.ok(
                    json{{"saved", true}, {"name", platform::utf8_from_path(path.filename())}});
            });
        } catch (const DialogUnavailable& e) {
            respond.fail(
                rpc::RpcError(rpc::codes::kDialogUnavailable, "", json{{"reason", e.what()}}));
        }
    });

    router.add_async_method("files.saveBinaries", [&services](const json& params, rpc::RpcContext&,
                                                              rpc::Responder respond) {
        const json& p = rpc::params::object(params);
        const std::string doc_id = rpc::params::string(p, "docId");
        session::DocumentSession& session = services.documents.require(doc_id);
        const std::vector<std::string> ids = requested_ids(p, *session.binaries);
        const bool overwrite = rpc::params::boolean_or(p, "overwrite", false);

        // The second call: the folder of a token the document holds; no dialog.
        if (const std::optional<std::string> token = rpc::params::opt_string(p, "folderToken")) {
            const auto found = session.folderTokens.find(*token);
            if (found == session.folderTokens.end()) {
                throw rpc::invalid_params("folderToken is not a folder of this document",
                                          json{{"field", "folderToken"}});
            }
            write_binaries(BinariesJob{session.binaries, ids,
                                       platform::path_from_utf8(found->second), *token, overwrite},
                           respond);
            return;
        }

        auto provider = require_provider(services);
        PickFolderRequest request;
        request.title = rpc::params::string_or(p, "title", "");
        try {
            provider->pick_folder(request, [&services, respond, doc_id, ids,
                                            overwrite](PickFolderResult result) {
                if (!result.path) {
                    respond.ok(json{{"saved", 0}, {"skipped", json::array()}, {"folderToken", ""}});
                    return;
                }
                // The session is the transport thread's: the token is recorded there.
                const std::string folder = *result.path;
                auto record = [&services, respond, doc_id, ids, overwrite, folder] {
                    session::DocumentSession* current = services.documents.find(doc_id);
                    if (current == nullptr) {
                        respond.fail(
                            rpc::RpcError(rpc::codes::kDocNotFound, "", json{{"docId", doc_id}}));
                        return;
                    }
                    const std::string token = new_token();
                    current->folderTokens[token] = folder;
                    write_binaries(BinariesJob{current->binaries, ids,
                                               platform::path_from_utf8(folder), token, overwrite},
                                   respond);
                };
                if (!services.post || !services.post(record)) {
                    record();
                }
            });
        } catch (const DialogUnavailable& e) {
            respond.fail(
                rpc::RpcError(rpc::codes::kDialogUnavailable, "", json{{"reason", e.what()}}));
        }
    });
}

}  // namespace mfbe::server
