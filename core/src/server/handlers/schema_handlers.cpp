// schema.* handlers (feature 005, the AI assistant) - rpc-api.md §3.13 of the feature.
//
//   schema.text() -> {files: [{name, text}], notice}   the five XSD files of the FB2 2.1
//       schema as shipped - byte-exact, decoded as UTF-8, read from the validator's schema
//       folder on every call (56 KB) - in the order FictionBook.xsd, FictionBookGenres.xsd,
//       FictionBookLang.xsd, FictionBookLinks.xsd, FictionNotes.xsd, and `notice` = the text
//       of schema/LICENSE.md (BSD 2-clause, Dmitry Gribov), so that the catalogue resource
//       that hands the schema to a model carries its copyright notice. An unreadable file ->
//       1002 doc.ioError {path, reason}. No parameters, independent of any document.
//   schema.element({name}) is reserved for a later minor (its shape is recorded in the
//       contract) and NOT registered in 0.0.5: the core answers methodNotFound and the UI's
//       get_schema tool answers from its generated table.
#include "server/services.hpp"

#include <mfbe/fb2_reader.hpp>
#include <mfbe/validator.hpp>

#include <filesystem>
#include <string>

namespace mfbe::server {
namespace {

using nlohmann::json;

constexpr const char* kSchemaFiles[] = {"FictionBook.xsd", "FictionBookGenres.xsd",
                                        "FictionBookLang.xsd", "FictionBookLinks.xsd",
                                        "FictionNotes.xsd"};
constexpr const char* kNoticeFile = "LICENSE.md";

std::string read_schema_file(const std::filesystem::path& path) {
    try {
        return fb2::read_file_bytes(path);
    } catch (const fb2::IoFailure& e) {
        throw rpc::RpcError(rpc::codes::kDocIoError, "",
                            json{{"path", e.path}, {"reason", e.reason}});
    }
}

}  // namespace

void register_schema_handlers(rpc::RpcRouter& router, Services& /*services*/) {
    router.add_method("schema.text", [](const json&, rpc::RpcContext&) {
        const std::filesystem::path dir = validation::schema_dir();
        json files = json::array();
        for (const char* name : kSchemaFiles) {
            files.push_back(json{{"name", name}, {"text", read_schema_file(dir / name)}});
        }
        return json{{"files", std::move(files)}, {"notice", read_schema_file(dir / kNoticeFile)}};
    });
}

}  // namespace mfbe::server
