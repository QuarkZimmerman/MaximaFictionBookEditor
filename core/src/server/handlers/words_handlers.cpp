// words.* handlers (T135) - contracts/rpc-api.md §3.5.
//
//   words.analyze({docId, document?, includeExclusions?})
//        -> {words: [{word, count, excluded?}], entries: <same>, totalWords, durationMs}
//           | {jobId}   (large books run as a job; `document` defaults to the session snapshot)
//   words.exclusions({add?: string[], remove?: string[]}) -> {words: string[]}
//        error -32602 {field: "add", word, reason} when a word has forbidden characters
#include "server/services.hpp"

#include <mfbe/json_codec.hpp>
#include <mfbe/words.hpp>

#include <memory>
#include <set>

namespace mfbe::server {
namespace {

using nlohmann::json;

// Documents with more body text than this are analysed on a worker thread.
constexpr std::size_t kJobThresholdBytes = 2 * 1024 * 1024;

std::size_t text_size(const model::Document& document) {
    std::size_t total = 0;
    words::visit_text_runs(document, [&](std::string_view text) { total += text.size(); });
    return total;
}

json to_json(const words::AnalyzeResult& result, bool include_exclusions) {
    json list = json::array();
    for (const words::WordStat& w : result.words) {
        json j{{"word", w.word}, {"count", w.count}};
        if (include_exclusions) {
            j["excluded"] = w.excluded;
        }
        list.push_back(std::move(j));
    }
    json out;
    out["words"] = list;               // name used by the UI's Words dialog
    out["entries"] = std::move(list);  // name used by contracts/rpc-api.md §3.5
    out["totalWords"] = result.total_words;
    out["durationMs"] = result.duration_ms;
    return out;
}

}  // namespace

void register_words_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("words.analyze", [&services](const json& params, rpc::RpcContext& ctx) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        auto document = std::make_shared<model::Document>();
        if (const json* doc = rpc::params::opt_field(params, "document")) {
            try {
                *document = model::document_from_json(*doc);
            } catch (const model::CodecError& e) {
                throw rpc::invalid_params("document: " + e.detail,
                                          json{{"field", "document" + e.path}});
            }
        } else if (s.snapshot) {
            *document = *s.snapshot;
        } else {
            throw rpc::invalid_params("document is required", json{{"field", "document"}});
        }
        const bool include = rpc::params::boolean_or(params, "includeExclusions", false);
        // Snapshot of the exclusion list so the job never touches the settings object.
        auto excluded = std::make_shared<std::set<std::string>>(services.exclusions.words().begin(),
                                                                services.exclusions.words().end());
        words::AnalyzeOptions options;
        options.include_exclusions = include;
        options.is_excluded = [excluded](std::string_view word) {
            return excluded->count(std::string(word)) > 0;
        };
        if (text_size(*document) < kJobThresholdBytes) {
            return to_json(words::analyze(*document, options), include);
        }
        const std::string job_id =
            ctx.jobs.start([document, options, include](rpc::JobControl& control) {
                control.progress("analyze", 0, 100);
                json result = to_json(words::analyze(*document, options), include);
                control.progress("done", 100, 100);
                return result;
            });
        return json{{"jobId", job_id}};
    });

    router.add_method("words.exclusions", [&services](const json& params, rpc::RpcContext&) {
        const std::vector<std::string> add = rpc::params::string_array_or(params, "add");
        const std::vector<std::string> remove = rpc::params::string_array_or(params, "remove");
        for (const std::string& word : add) {
            const std::string error = settings::exclusion_word_error(word);
            if (!error.empty()) {
                throw rpc::invalid_params(
                    "invalid exclusion word: " + error,
                    json{{"field", "add"}, {"word", word}, {"reason", error}});
            }
        }
        const std::string error = services.exclusions.apply(add, remove);
        if (!error.empty()) {
            throw rpc::invalid_params("invalid exclusion word: " + error,
                                      json{{"field", "add"}, {"reason", error}});
        }
        return json{{"words", services.exclusions.words()}};
    });
}

}  // namespace mfbe::server
