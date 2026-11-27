// package.* JSON-RPC handlers for FBD ZIP Package Mode (feature 022, contracts/rpc-api.md).
//
//   package.create({}) -> {packageId, path: null, entries: []}
//   package.addFiles({packageId, paths}) -> {added, rejected}
//   package.removeEntry({packageId, entryId}) -> {}
//   package.save({packageId, path, entries, force?}) -> {jobId}
//   package.close({packageId}) -> {}
//
// Jobs run on worker threads while every access to Services::packages and Services::documents is
// serialized back onto the loop thread through Services::post.
#include "server/services.hpp"

#include <mfbe/document_details.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/fbd_package.hpp>
#include <mfbe/images.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/utf8_paths.hpp>
#include <mfbe/validator.hpp>

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <future>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

namespace mfbe::server {
namespace {

using nlohmann::json;
namespace fs = std::filesystem;

rpc::RpcError package_not_found(const std::string& package_id) {
    return rpc::RpcError(rpc::codes::kPackageNotFound, "unknown package",
                         json{{"packageId", package_id}});
}

rpc::RpcError package_save_failed(const std::string& reason, const std::string& detail,
                                  const std::optional<std::string>& path = std::nullopt,
                                  const std::optional<std::string>& entry = std::nullopt) {
    json data{{"reason", reason}};
    if (path && !path->empty()) {
        data["path"] = *path;
    }
    if (entry && !entry->empty()) {
        data["entry"] = *entry;
    }
    if (!detail.empty()) {
        data["detail"] = detail;
    }
    return rpc::RpcError(rpc::codes::kPackageSaveFailed, detail, std::move(data));
}

std::string absolute_utf8_path(const std::string& path) {
    std::error_code ec;
    const fs::path abs = fs::absolute(platform::path_from_utf8(path), ec);
    return ec ? path : platform::utf8_from_path(abs.lexically_normal());
}

std::string ui_language_setting(const Services& services) {
    return services.settings.get_string("view.uiLanguage", "system");
}

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

// Text-like book formats compress well; PDF/EPUB/DOCX/ODT/DjVu/MOBI/CHM are already compressed,
// so STORE avoids wasted CPU and keeps large saves near disk bandwidth.
bool should_deflate_payload(std::string_view lower_ext) {
    static constexpr std::string_view kDeflateExts[] = {
        "txt", "md", "markdown", "rtf", "html", "htm", "xhtml", "xml", "tex", "csv", "json", "doc",
    };
    return std::any_of(std::begin(kDeflateExts), std::end(kDeflateExts),
                       [&](std::string_view ext) { return ext == lower_ext; });
}

std::shared_ptr<BinaryStore> clone_binary_store(const BinaryStore& source) {
    auto copy = std::make_shared<BinaryStore>();
    for (const std::string& id : source.ids()) {
        const auto meta = source.meta(id);
        const auto bytes = source.bytes(id);
        if (!meta || !bytes) {
            continue;
        }
        copy->put(id, meta->contentType, *bytes, source.is_raw_text(id));
    }
    return copy;
}

json entry_dto_json(const package::FbdPackagePayloadEntry& entry, const model::Document& doc) {
    return json{
        {"entryId", entry.entryId},
        {"docId", entry.docId},
        {"fileName", entry.fileName},
        {"stem", entry.stem},
        {"extension", entry.extension},
        {"size", entry.size},
        {"originatedFromZip", entry.originatedFromZip},
        {"hadFbd", entry.hadFbd},
        {"droppedExtraImages", entry.droppedExtraImages},
        {"document", model::to_json(doc)},
    };
}

// Creates a blank FB2 2.1 document with empty title-info (so Remove confirmation stays silent
// until metadata is added) and standard auto-filled document-info details.
model::Document make_blank_package_document(const std::string& doc_id, BinaryStore& store,
                                            model::NodeIdAllocator& ids,
                                            const std::string& ui_language) {
    model::Document doc;
    doc.docId = doc_id;
    doc.fileKind = model::FileKind::fbd;
    doc.sourceEncoding = "utf-8";
    doc.schemaHint = model::SchemaHint::v21;
    // FB2 2.1 XSD requires <document-info><author> to carry either (first-name, last-name) or
    // nickname; empty first-name/last-name keeps the description visually blank while validating
    // cleanly as soon as the user fills in title-info.
    model::Person doc_author;
    doc_author.firstName = "";
    doc_author.lastName = "";
    doc.description.documentInfo.authors.push_back(std::move(doc_author));
    model::fill_in_document_details(doc, model::details_context_now(true, ui_language));
    package::normalize_package_fbd(doc, store, ids);
    return doc;
}

struct SaveEntrySnapshot {
    std::string entryId;
    std::string docId;
    std::string fileName;
    std::string fbdEntryName;
    std::string extension;
    package::PayloadSourceKind sourceKind = package::PayloadSourceKind::disk_file;
    std::optional<fs::path> sourceDiskPath;
    std::optional<std::string> sourceZipEntryName;
    model::Document document;
    std::shared_ptr<BinaryStore> store;
    model::NodeIdAllocator ids;
    std::string xlinkPrefix = "l";
    bool coverConverted = false;
    std::optional<std::string> updatedCoverHref;
    std::string serializedFbdBytes;
};

struct SaveJobContext {
    std::string packageId;
    fs::path targetPath;
    std::string targetUtf8;
    std::optional<fs::path> sourceZipPath;
    bool preserveNonManaged = false;
    bool force = false;
    images::ConversionPolicy policy;
    std::vector<package::FbdPackagePreservedZipEntry> preservedEntries;
    std::vector<SaveEntrySnapshot> entries;
};

json perform_package_save(Services& services, SaveJobContext& job, rpc::JobControl& control) {
    control.check_cancelled();
    control.progress("validate", 0, 100);

    json entry_validations = json::array();
    int total_error_count = 0;

    const std::size_t entry_count = job.entries.size();
    for (std::size_t i = 0; i < entry_count; ++i) {
        control.check_cancelled();
        SaveEntrySnapshot& entry = job.entries[i];
        package::normalize_package_fbd(entry.document, *entry.store, entry.ids);
        const model::ValidationReport validation =
            validation::validate_document(entry.document, entry.store.get(), entry.xlinkPrefix);
        total_error_count += validation.errorCount;
        entry_validations.push_back(json{
            {"entryId", entry.entryId},
            {"fileName", entry.fileName},
            {"errorCount", validation.errorCount},
            {"warningCount", validation.warningCount},
            {"validation", model::to_json(validation)},
        });
        control.progress("validate", static_cast<std::int64_t>(((i + 1) * 15) / entry_count), 100);
    }

    if (total_error_count > 0 && !job.force) {
        return json{
            {"needsConfirmation", true},
            {"path", job.targetUtf8},
            {"totalErrorCount", total_error_count},
            {"entryValidations", std::move(entry_validations)},
        };
    }

    json updated_binaries = json::object();
    json updated_cover_hrefs = json::object();

    for (SaveEntrySnapshot& entry : job.entries) {
        control.check_cancelled();
        const images::ConvertStoreResult conv = images::convert_store(*entry.store, job.policy);
        if (!conv.converted.empty()) {
            entry.coverConverted = true;
            // Ensure cover binary ID matches the converted JPEG/PNG content type.
            const std::vector<std::string> ids = entry.store->ids();
            if (!ids.empty()) {
                const std::string cur_id = ids.front();
                if (const auto meta = entry.store->meta(cur_id)) {
                    const std::string canonical_id =
                        meta->contentType == "image/png" ? "cover.png" : "cover.jpg";
                    if (cur_id != canonical_id) {
                        entry.store->rename(cur_id, canonical_id);
                    }
                    entry.store->set_reference_counts({{canonical_id, 1}});
                    model::ImageRef ref;
                    ref.href = "#" + canonical_id;
                    entry.document.description.titleInfo.coverpage = {ref};
                    entry.document.binaries.clear();
                    if (auto new_meta = entry.store->meta(canonical_id)) {
                        new_meta->referenceCount = 1;
                        entry.document.binaries.push_back(*new_meta);
                        updated_binaries[entry.entryId] = json::array({model::to_json(*new_meta)});
                    }
                    entry.updatedCoverHref = ref.href;
                    updated_cover_hrefs[entry.entryId] = ref.href;
                }
            }
        }

        fb2::WriteOptions write_opts;
        write_opts.encoding = "utf-8";
        write_opts.xlink_prefix = entry.xlinkPrefix;
        const std::string xml_text =
            fb2::write_document(entry.document, entry.store.get(), write_opts).text;
        entry.serializedFbdBytes = fb2::encode_document(xml_text, "utf-8");
    }

    package::PackageZipWritePlan plan;
    plan.targetZipPath = job.targetPath;
    plan.sourceZipPath = job.sourceZipPath;
    plan.preserveNonManaged = job.preserveNonManaged;
    plan.preservedEntries = job.preservedEntries;

    for (const SaveEntrySnapshot& entry : job.entries) {
        package::PackageZipWriteEntry payload_item;
        payload_item.entryName = entry.fileName;
        payload_item.sourceKind = entry.sourceKind;
        payload_item.diskPath = entry.sourceDiskPath;
        payload_item.sourceZipRawName = entry.sourceZipEntryName;
        payload_item.isMemory = false;
        payload_item.compressDeflate = should_deflate_payload(entry.extension);
        plan.managedEntries.push_back(std::move(payload_item));

        package::PackageZipWriteEntry fbd_item;
        fbd_item.entryName = entry.fbdEntryName;
        fbd_item.isMemory = true;
        fbd_item.memoryBytes = entry.serializedFbdBytes;
        fbd_item.compressDeflate = true;
        plan.managedEntries.push_back(std::move(fbd_item));
    }

    control.progress("pack", 15, 100);
    try {
        package::write_package_zip_atomic(
            plan,
            [&control](std::uint64_t done, std::uint64_t total) {
                const std::int64_t pct =
                    total > 0 ? 15 + static_cast<std::int64_t>((done * 80) / total) : 95;
                control.progress("pack", std::min<std::int64_t>(pct, 95), 100);
            },
            [&control]() { return control.cancelled(); });
    } catch (const package::ZipWriteError& e) {
        if (e.reason == "cancelled") {
            throw rpc::RpcError(rpc::codes::kCancelled, "package save cancelled",
                                json{{"path", job.targetUtf8}});
        }
        throw package_save_failed(e.reason, e.what(), job.targetUtf8,
                                  e.entry.empty() ? std::nullopt
                                                  : std::optional<std::string>(e.entry));
    }

    control.progress("finalize", 96, 100);

    // Commit updated package state back to the loop thread after atomic replacement succeeds.
    auto shared_job = std::make_shared<SaveJobContext>(std::move(job));
    on_loop_thread(
        services,
        [&services, shared_job] {
            package::FbdPackageSession* pkg = services.packages.find(shared_job->packageId);
            if (pkg != nullptr) {
                pkg->zipPath = shared_job->targetPath;
                if (!shared_job->preserveNonManaged) {
                    pkg->preservedEntries.clear();
                }
                pkg->removedSourceEntries.clear();

                std::map<std::string, const SaveEntrySnapshot*> by_id;
                for (const SaveEntrySnapshot& snap : shared_job->entries) {
                    by_id.emplace(snap.entryId, &snap);
                }

                for (package::FbdPackagePayloadEntry& e : pkg->entries) {
                    e.sourceKind = package::PayloadSourceKind::zip_entry;
                    e.sourceDiskPath.reset();
                    e.sourceZipEntryName = e.fileName;
                    e.sourceFbdEntryName = e.fbdEntryName;
                    e.originatedFromZip = true;
                    e.hadFbd = true;

                    const auto it = by_id.find(e.entryId);
                    if (it != by_id.end()) {
                        if (session::DocumentSession* s = services.documents.find(e.docId)) {
                            s->snapshot = it->second->document;
                            if (it->second->coverConverted) {
                                for (const std::string& old_id : s->binaries->ids()) {
                                    services.previews.invalidate_prefix(s->docId + "/" + old_id +
                                                                        "@");
                                }
                                s->binaries = it->second->store;
                            }
                        }
                    }
                }
            }
            services.recent.touch(shared_job->targetUtf8, std::nullopt);
            return 0;
        },
        &control);

    control.progress("finalize", 100, 100);
    json result{
        {"needsConfirmation", false},
        {"path", shared_job->targetUtf8},
        {"totalErrorCount", total_error_count},
        {"entryValidations", std::move(entry_validations)},
    };
    if (!updated_binaries.empty()) {
        result["updatedBinaries"] = std::move(updated_binaries);
    }
    if (!updated_cover_hrefs.empty()) {
        result["updatedCoverHrefs"] = std::move(updated_cover_hrefs);
    }
    return result;
}

}  // namespace

void register_package_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("package.create", [&services](const json&, rpc::RpcContext&) {
        package::FbdPackageSession& pkg = services.packages.create();
        return json{
            {"packageId", pkg.packageId},
            {"path", nullptr},
            {"entries", json::array()},
        };
    });

    router.add_method("package.addFiles", [&services](const json& params, rpc::RpcContext&) {
        const std::string package_id = rpc::params::string(params, "packageId");
        package::FbdPackageSession* pkg = services.packages.find(package_id);
        if (pkg == nullptr) {
            throw package_not_found(package_id);
        }
        const json* paths_param = rpc::params::opt_field(params, "paths");
        if (paths_param == nullptr || !paths_param->is_array()) {
            throw rpc::invalid_params("paths must be an array of file paths",
                                      json{{"field", "paths"}});
        }

        std::map<std::string, std::string> existing_stems;
        for (const package::FbdPackagePayloadEntry& e : pkg->entries) {
            existing_stems.emplace(e.stemKey, e.fileName);
        }

        const std::string ui_lang = ui_language_setting(services);
        json added = json::array();
        json rejected = json::array();

        for (const json& item : *paths_param) {
            if (!item.is_string()) {
                throw rpc::invalid_params("paths items must be strings", json{{"field", "paths"}});
            }
            const std::string raw_path = item.get<std::string>();
            const std::string abs_utf8 = absolute_utf8_path(raw_path);
            const fs::path disk_path = platform::path_from_utf8(abs_utf8);
            const package::CandidateFileCheck check =
                package::validate_candidate_payload(disk_path, existing_stems);
            if (!check.accepted) {
                json rej{
                    {"path", raw_path},
                    {"fileName", check.fileName},
                    {"reason", package::file_reject_reason_name(check.reason)},
                };
                if (!check.conflictWith.empty()) {
                    rej["conflictWith"] = check.conflictWith;
                }
                rejected.push_back(std::move(rej));
                continue;
            }

            session::DocumentSession& s = services.documents.create();
            model::Document doc =
                make_blank_package_document(s.docId, *s.binaries, s.ids, ui_lang);
            s.fileKind = model::FileKind::fbd;
            s.sourceEncoding = "utf-8";
            s.xlinkPrefix = "l";
            s.schemaHint = model::SchemaHint::v21;
            s.sourceOnly = false;
            s.snapshot = doc;

            package::FbdPackagePayloadEntry entry;
            entry.entryId = services.packages.next_entry_id();
            entry.docId = s.docId;
            entry.fileName = check.fileName;
            entry.stem = check.stem;
            entry.stemKey = check.stemKey;
            entry.extension = check.extension;
            entry.fbdEntryName = check.stem + ".fbd";
            entry.size = check.size;
            entry.sourceKind = package::PayloadSourceKind::disk_file;
            entry.sourceDiskPath = disk_path;
            entry.originatedFromZip = false;
            entry.hadFbd = false;
            entry.droppedExtraImages = 0;

            existing_stems.emplace(entry.stemKey, entry.fileName);
            added.push_back(entry_dto_json(entry, doc));
            pkg->entries.push_back(std::move(entry));
        }

        return json{
            {"added", std::move(added)},
            {"rejected", std::move(rejected)},
        };
    });

    router.add_method("package.removeEntry", [&services](const json& params, rpc::RpcContext&) {
        const std::string package_id = rpc::params::string(params, "packageId");
        const std::string entry_id = rpc::params::string(params, "entryId");
        package::FbdPackageSession* pkg = services.packages.find(package_id);
        if (pkg == nullptr) {
            throw package_not_found(package_id);
        }
        const auto it = std::find_if(
            pkg->entries.begin(), pkg->entries.end(),
            [&](const package::FbdPackagePayloadEntry& e) { return e.entryId == entry_id; });
        if (it == pkg->entries.end()) {
            throw rpc::RpcError(rpc::codes::kPackageNotFound, "unknown package entry",
                                json{{"packageId", package_id}, {"entryId", entry_id}});
        }
        if (it->originatedFromZip) {
            if (it->sourceZipEntryName) {
                pkg->removedSourceEntries.insert(*it->sourceZipEntryName);
            }
            if (it->sourceFbdEntryName) {
                pkg->removedSourceEntries.insert(*it->sourceFbdEntryName);
            }
        }
        const std::string doc_id = it->docId;
        pkg->entries.erase(it);
        services.documents.close(doc_id);
        services.previews.invalidate_prefix(doc_id + "/");
        return json::object();
    });

    router.add_method("package.save", [&services](const json& params, rpc::RpcContext& ctx) {
        const std::string package_id = rpc::params::string(params, "packageId");
        package::FbdPackageSession* pkg = services.packages.find(package_id);
        if (pkg == nullptr) {
            throw package_not_found(package_id);
        }
        const std::string raw_path = rpc::params::string(params, "path");
        if (raw_path.empty()) {
            throw rpc::invalid_params("path is required", json{{"field", "path"}});
        }
        const std::string target_utf8 = absolute_utf8_path(raw_path);
        if (pkg->entries.empty()) {
            throw package_save_failed("emptyPackage", "cannot save an empty package", target_utf8);
        }

        std::map<std::string, model::Document> provided_docs;
        const json* entries_param = rpc::params::opt_field(params, "entries");
        if (entries_param != nullptr) {
            if (!entries_param->is_array()) {
                throw rpc::invalid_params("entries must be an array", json{{"field", "entries"}});
            }
            for (const json& item : *entries_param) {
                if (!item.is_object()) {
                    throw rpc::invalid_params("entry item must be an object",
                                              json{{"field", "entries"}});
                }
                const std::string eid = rpc::params::string(item, "entryId");
                const json& doc_json = rpc::params::object_field(item, "document");
                try {
                    provided_docs.emplace(eid, model::document_from_json(doc_json));
                } catch (const model::CodecError& e) {
                    throw rpc::invalid_params("entries.document: " + e.detail,
                                              json{{"field", "entries.document" + e.path}});
                }
            }
        }

        auto job = std::make_shared<SaveJobContext>();
        job->packageId = package_id;
        job->targetUtf8 = target_utf8;
        job->targetPath = platform::path_from_utf8(target_utf8);
        job->sourceZipPath = pkg->zipPath;
        job->preserveNonManaged =
            pkg->zipPath.has_value() && package::same_target_path(*pkg->zipPath, job->targetPath);
        job->force = rpc::params::boolean_or(params, "force", false);
        job->policy = services.conversion_policy();
        if (job->preserveNonManaged) {
            job->preservedEntries = pkg->preservedEntries;
        }

        for (const package::FbdPackagePayloadEntry& e : pkg->entries) {
            session::DocumentSession* s = services.documents.find(e.docId);
            if (s == nullptr) {
                throw package_save_failed("ioError", "entry document session is missing",
                                          target_utf8, e.fileName);
            }
            SaveEntrySnapshot snap;
            snap.entryId = e.entryId;
            snap.docId = e.docId;
            snap.fileName = e.fileName;
            snap.fbdEntryName = e.fbdEntryName;
            snap.extension = e.extension;
            snap.sourceKind = e.sourceKind;
            snap.sourceDiskPath = e.sourceDiskPath;
            snap.sourceZipEntryName = e.sourceZipEntryName;
            const auto doc_it = provided_docs.find(e.entryId);
            if (doc_it != provided_docs.end()) {
                snap.document = doc_it->second;
            } else if (s->snapshot) {
                snap.document = *s->snapshot;
            }
            snap.document.docId = e.docId;
            snap.store = clone_binary_store(*s->binaries);
            snap.ids = s->ids;
            snap.xlinkPrefix = s->xlinkPrefix.empty() ? "l" : s->xlinkPrefix;
            job->entries.push_back(std::move(snap));
        }

        const std::string job_id =
            ctx.jobs.start([&services, job](rpc::JobControl& control) -> json {
                return perform_package_save(services, *job, control);
            });
        return json{{"jobId", job_id}};
    });

    router.add_method("package.close", [&services](const json& params, rpc::RpcContext&) {
        const std::string package_id = rpc::params::string(params, "packageId");
        const std::vector<std::string> doc_ids = services.packages.close(package_id);
        for (const std::string& doc_id : doc_ids) {
            services.documents.close(doc_id);
            services.previews.invalidate_prefix(doc_id + "/");
        }
        return json::object();
    });
}

}  // namespace mfbe::server
