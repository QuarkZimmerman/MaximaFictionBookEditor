// Feature 011 (US8; contracts/rpc-api.md `styles.check`): the style issues of the document's
// stylesheets, or of the ones the Styles view is editing - the same reader as Validate's
// (css_rules.hpp), so the view and Validate never disagree.
#include "server/services.hpp"
#include "xml/css_rules.hpp"

#include <mfbe/json_codec.hpp>
#include <mfbe/rpc.hpp>

namespace mfbe::server {

using json = nlohmann::json;

void register_styles_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("styles.check", [&services](const json& params, rpc::RpcContext&) {
        const std::string doc_id = rpc::params::string(params, "docId");
        auto& session = services.documents.require(doc_id);
        std::vector<model::Stylesheet> sheets;
        if (const auto it = params.find("stylesheets"); it != params.end() && it->is_array()) {
            for (const json& sheet : *it) {
                if (!sheet.is_object()) {
                    throw rpc::invalid_params("stylesheets must be objects {type, text}");
                }
                sheets.push_back({sheet.value("type", std::string("text/css")),
                                  sheet.value("text", std::string())});
            }
        } else if (session.snapshot) {
            sheets = session.snapshot->stylesheets;
        }
        json issues = json::array();
        for (const model::ValidationIssue& issue : css::style_issues(sheets)) {
            issues.push_back(model::to_json(issue));
        }
        return json{{"issues", std::move(issues)}};
    });
}

}  // namespace mfbe::server
