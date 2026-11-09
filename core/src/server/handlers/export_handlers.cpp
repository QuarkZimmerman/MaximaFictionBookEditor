// Feature 011 (US5, US6; contracts/rpc-api.md `export.markdown`): the Markdown export as a job.
// The interface sends the text it wrote and the pictures it names; the core reads the pictures
// from the book's binary store, writes the one file or the ZIP atomically, reports its progress and
// stops on job.cancel without leaving a file. Nothing of the document, its file, the settings or
// Recent files changes (D32, FR-055).
#include "export/markdown_writer.hpp"
#include "server/services.hpp"

#include <mfbe/rpc.hpp>
#include <mfbe/utf8_paths.hpp>

#include <filesystem>
#include <memory>

namespace mfbe::server {

namespace fs = std::filesystem;
using json = nlohmann::json;

void register_export_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("export.markdown", [&services](const json& params, rpc::RpcContext& ctx) {
        const std::string doc_id = rpc::params::string(params, "docId");
        auto& session = services.documents.require(doc_id);
        const fs::path target = fs::absolute(platform::path_from_utf8(rpc::params::string(params, "path")));
        const std::string form = rpc::params::string_or(params, "form", "md");
        if (form != "md" && form != "zip") {
            throw rpc::invalid_params("form must be \"md\" or \"zip\"", json{{"form", form}});
        }
        // The book's own file - or the archive it was read from - is never written over (D27).
        if (session.path) {
            std::error_code ec;
            if (fs::equivalent(target, platform::path_from_utf8(*session.path), ec)) {
                throw rpc::RpcError(rpc::codes::kDocSameAsOpenFile, "",
                                    json{{"path", platform::utf8_from_path(target)}});
            }
        }
        auto job = std::make_shared<exporting::MarkdownExport>();
        job->path = target;
        job->zip = form == "zip";
        job->text = rpc::params::string(params, "text");
        job->jpeg_quality = services.conversion_policy().jpeg_quality;
        const bool include = params.value("includePictures", true);
        if (const auto it = params.find("pictures"); (job->zip || include) && it != params.end() &&
                                                       it->is_array()) {
            for (const json& picture : *it) {
                if (!picture.is_object()) {
                    continue;
                }
                job->pictures.push_back({picture.value("binaryId", std::string()),
                                         picture.value("name", std::string())});
            }
        }
        const std::shared_ptr<BinaryStore> store = session.binaries;
        const std::string job_id = ctx.jobs.start([job, store](rpc::JobControl& control) {
            exporting::write_markdown_export(
                *job, *store,
                [&control](const std::string& phase, std::size_t done, std::size_t total) {
                    control.check_cancelled();
                    control.progress(phase, static_cast<std::int64_t>(done),
                                     static_cast<std::int64_t>(total));
                });
            return json{{"path", platform::utf8_from_path(job->path)},
                        {"pictures", job->pictures.size()}};
        });
        return json{{"jobId", job_id}};
    });
}

}  // namespace mfbe::server
