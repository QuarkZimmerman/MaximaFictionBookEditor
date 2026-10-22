// ai.* handlers (feature 005, rpc-api.md §3.12):
//
//   ai.services() -> AiServicesResult        the effective list and the state of its files,
//        loaded on the first ai.* call of the core (never at start-up) or at the last reload
//   ai.reloadServices() -> AiServicesResult  re-reads both files, replaces the list in effect,
//        emits resources.changed {what: 'aiServices'}; a running job keeps the entry it resolved
//   ai.createUserServices() -> {path, created}  *Edit list*: a byte-exact copy of the bundled
//        file into <Data>/ai-services.json when absent (never overwritten), then a reload with
//        the notification; 1002 {path, reason} when the copy cannot be written
//   ai.complete({target, body}) -> {jobId}   one chat-completion exchange: POST
//        <address>/chat/completions with the body as given, `model` and `stream: false` forced
//   ai.models({target}) -> {jobId}           GET <address>/models, the list normalised
//   ai.test({target}) -> {jobId}             the fixed one-word completion; `verified`,
//        `model`, and the triple's fingerprint for a verified custom target
//
// The three exchanges are jobs: {jobId} at once, job.progress with the phases connecting |
// waiting | receiving, the outcome - a service failure included - as the result of job.done,
// job.cancel -> job.failed 1090 with nothing logged. The target is resolved synchronously before
// the job exists, in the contract's order: a malformed target or a draft given to ai.complete ->
// invalidParams {field: 'target'}; 1200 ai.noService {reason: disabled (ai.complete only) |
// unknownService | emptyAddress | noModel | noAgreement}. The key comes from the entry, the
// settings or the draft - never from a request's call. One errors-only log entry per failed
// outcome, `ai.<kind>` with {method, targetKind, host, status?}; nothing for a success, a
// cancel, a 429 / 402 / 503-with-Retry-After limit wait or a 3xx (FR-100). Nothing of this
// family touches the network at start-up: the first ai.* call reads the list and creates the
// transport (the HTTP client's one-time initialisation).
#include "server/ai_state.hpp"
#include "server/services.hpp"
#include "util/sha256.hpp"

#include <mfbe/ai_address.hpp>
#include <mfbe/ai_services.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/recent_files.hpp>
#include <mfbe/unicode.hpp>
#include <mfbe/version.hpp>

#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>

namespace mfbe::server {
namespace {

using nlohmann::json;

constexpr std::size_t kMaxKeyChars = 4096;
constexpr std::size_t kMaxModelChars = 256;

enum class Method { complete, models, test };

const char* method_name(Method method) {
    switch (method) {
        case Method::complete:
            return "ai.complete";
        case Method::models:
            return "ai.models";
        case Method::test:
            return "ai.test";
    }
    return "ai.complete";
}

// What a target resolved to: everything a job needs, copied out of the list and the settings
// at resolution time (a reload or a settings change meanwhile changes nothing for the job).
struct ResolvedTarget {
    std::string kind;  // free | custom
    std::optional<std::string> service_id;
    std::string address;  // as written (the agreement key uses it)
    std::string base;     // trailing '/' removed
    std::string host;     // host[:port] - the loggable part
    bool local = false;
    std::string key;
    std::string model;
    bool draft = false;
};

json reload_and_notify(Services& services, rpc::RpcContext& ctx) {
    const auto list = services.ai.reload();
    ctx.notifier.notify("resources.changed", json{{"what", "aiServices"}});
    return list->to_json();
}

rpc::RpcError no_service(const char* reason, json data = json::object()) {
    data["reason"] = reason;
    return rpc::RpcError(rpc::codes::kAiNoService, "", std::move(data));
}

rpc::RpcError bad_target(const char* field = "target") {
    return rpc::invalid_params(std::string(field) + " is malformed", json{{"field", field}});
}

// A string member of the draft checked by the rule of its setting (rpc-api §3.7).
std::string draft_member(const json& target, const char* name, std::size_t max_chars,
                         bool address) {
    const auto it = target.find(name);
    if (it == target.end() || !it->is_string()) {
        throw bad_target();
    }
    const std::string value = it->get<std::string>();
    const std::string field = std::string("target.") + name;
    if (address) {
        if (!value.empty() && !ai::parse_address(value)) {
            throw bad_target(field.c_str());
        }
        return value;
    }
    if (!unicode::is_valid_utf8(value) || ai::has_control_characters(value) ||
        unicode::length(value) > max_chars) {
        throw bad_target(field.c_str());
    }
    return value;
}

// Steps 1-5 of rpc-api §3.12 (step 0, the disabled mode, is ai.complete's and runs first).
ResolvedTarget resolve_target(Services& services, const json& params, Method method) {
    const json* target = rpc::params::opt_field(params, "target");
    if (target == nullptr || !target->is_object()) {
        throw bad_target();
    }
    const auto kind_it = target->find("kind");
    if (kind_it == target->end() || !kind_it->is_string()) {
        throw bad_target();
    }
    const std::string kind = kind_it->get<std::string>();
    ResolvedTarget resolved;
    resolved.kind = kind;
    if (kind == "free") {
        if (target->size() != 2) {
            throw bad_target();
        }
        const auto id_it = target->find("id");
        if (id_it == target->end() || !id_it->is_string()) {
            throw bad_target();
        }
        const std::string id = id_it->get<std::string>();
        const auto list = services.ai.services();
        const ai::ServiceEntry* entry = list->find(id);
        if (entry == nullptr) {
            throw no_service("unknownService", json{{"id", id}});
        }
        resolved.service_id = id;
        resolved.address = entry->address;
        resolved.base = entry->base;
        resolved.host = entry->host;
        resolved.local = entry->local;
        resolved.key = entry->key;
        resolved.model = entry->model;
    } else if (kind == "custom") {
        const bool has_address = target->contains("address");
        const bool has_key = target->contains("key");
        const bool has_model = target->contains("model");
        if (has_address && has_key && has_model && target->size() == 4) {
            if (method == Method::complete) {
                throw bad_target();  // a request takes a stored target only
            }
            resolved.draft = true;
            resolved.address = draft_member(*target, "address", 0, true);
            resolved.key = draft_member(*target, "key", kMaxKeyChars, false);
            resolved.model = draft_member(*target, "model", kMaxModelChars, false);
        } else if (!has_address && !has_key && !has_model && target->size() == 1) {
            services.ai.touch();  // the first ai.* call initialises the family either way
            resolved.address = services.settings.get_string("ai.custom.address");
            resolved.key = services.settings.get_string("ai.custom.key");
            resolved.model = services.settings.get_string("ai.custom.model");
        } else {
            throw bad_target();  // a mix of the draft's members, or an unknown member
        }
        if (resolved.address.empty()) {
            throw no_service("emptyAddress");
        }
        const auto parsed = ai::parse_address(resolved.address);
        if (!parsed) {
            throw no_service("emptyAddress");  // unreachable: the setting is validated
        }
        resolved.base = parsed->base;
        resolved.host = parsed->host;
        resolved.local = parsed->local;
    } else {
        throw bad_target();
    }
    if (method != Method::models && resolved.model.empty()) {
        throw no_service("noModel");
    }
    if (!resolved.local) {
        const std::string agreement_key =
            resolved.kind == "free" ? *resolved.service_id : "custom:" + resolved.address;
        bool agreed = false;
        const json& settings = services.settings.get();
        const auto ai_it = settings.find("ai");
        if (ai_it != settings.end() && ai_it->is_object()) {
            const auto agreements = ai_it->find("agreements");
            if (agreements != ai_it->end() && agreements->is_array()) {
                for (const auto& item : *agreements) {
                    if (item.is_object() && item.value("service", "") == agreement_key &&
                        item.value("host", "") == resolved.host) {
                        agreed = true;
                    }
                }
            }
        }
        if (!agreed) {
            throw no_service("noAgreement", json{{"service", agreement_key}});
        }
    }
    return resolved;
}

// The request of one exchange: the URL, exactly the Definitions' headers and the body.
ai::HttpRequest build_request(Services& services, const ResolvedTarget& target, bool post,
                              std::string body) {
    ai::HttpRequest request;
    request.method = post ? "POST" : "GET";
    request.url = target.base + (post ? "/chat/completions" : "/models");
    if (post) {
        request.headers.emplace_back("Content-Type", "application/json");
    }
    request.headers.emplace_back("Accept", "application/json");
    request.headers.emplace_back("User-Agent",
                                 std::string("MaximaFictionBookEditor/") + version::kVersion);
    if (!target.key.empty()) {
        request.headers.emplace_back("Authorization", "Bearer " + target.key);
    }
    request.body = std::move(body);
    request.connect_ms = services.ai.connect_ms();
    request.total_ms = services.ai.total_ms();
    request.resolve_entries = services.ai.resolve_entries();
    return request;
}

// The log rule (rpc-api Definitions "Logging"): one errors-only entry per failed outcome,
// nothing for a success, a limit wait (429, 402, 503 with Retry-After) or a 3xx.
void log_outcome(Method method, const ResolvedTarget& target, const ai::HttpOutcome& outcome) {
    if (outcome.ok || outcome.kind == "cancelled") {
        return;
    }
    if (outcome.kind == "http" && outcome.status) {
        const int status = *outcome.status;
        if (status == 429 || status == 402 || (status >= 300 && status <= 399) ||
            (status == 503 && outcome.retry_after_seconds.has_value())) {
            return;
        }
    }
    std::map<std::string, std::string> extra{
        {"method", method_name(method)}, {"targetKind", target.kind}, {"host", target.host}};
    if (outcome.status) {
        extra["status"] = std::to_string(*outcome.status);
    }
    log::warning("core", "ai." + outcome.kind, "AI request failed", log::extras(std::move(extra)));
}

AiRequestRecord base_record(Method method, const ResolvedTarget& target) {
    AiRequestRecord record;
    record.at = settings::now_iso8601_utc();
    record.method = method_name(method);
    record.target_kind = target.kind;
    record.service_id = target.service_id;
    record.host = target.host;
    return record;
}

// ai.models: a tolerant normalisation of the service's list (rpc-api §3.12, R3 §6.9).
json normalise_models(const ai::HttpOutcome& outcome) {
    json result = outcome.to_json();
    if (!outcome.ok) {
        return result;
    }
    const json& body = *outcome.body;
    const json* items = nullptr;
    if (body.is_array()) {
        items = &body;
    } else if (body.is_object()) {
        const auto data = body.find("data");
        if (data != body.end() && data->is_array()) {
            items = &*data;
        }
    }
    if (items == nullptr) {
        result["ok"] = false;
        result["kind"] = "format";
        result["message"] = "response is not a model list";
        result["text"] = body.dump().substr(0, ai::kMaxTextBytes);
        result.erase("body");
        return result;
    }
    json models = json::array();
    for (const auto& item : *items) {
        json model;
        if (item.is_string()) {
            model["id"] = item.get<std::string>();
        } else if (item.is_object()) {
            const auto id = item.find("id");
            const auto name = item.find("name");
            if (id != item.end() && id->is_string()) {
                model["id"] = id->get<std::string>();
            } else if (name != item.end() && name->is_string()) {
                model["id"] = name->get<std::string>();
            } else {
                continue;
            }
            const auto positive = [&](const json* value) {
                return value != nullptr && value->is_number_integer() &&
                       value->get<std::int64_t>() > 0;
            };
            const json* context_length =
                item.contains("context_length") ? &item["context_length"] : nullptr;
            if (!positive(context_length) && item.contains("context_window") &&
                item["context_window"].is_object() && item["context_window"].contains("tokens")) {
                context_length = &item["context_window"]["tokens"];
            }
            if (!positive(context_length) && item.contains("max_model_len")) {
                context_length = &item["max_model_len"];
            }
            if (positive(context_length)) {
                model["contextLength"] = context_length->get<std::int64_t>();
            }
            if (item.contains("tools") && item["tools"].is_boolean()) {
                model["tools"] = item["tools"].get<bool>();
            } else if (item.contains("capabilities") && item["capabilities"].is_object() &&
                       item["capabilities"].contains("tools") &&
                       item["capabilities"]["tools"].is_boolean()) {
                model["tools"] = item["capabilities"]["tools"].get<bool>();
            } else if (item.contains("supported_parameters") &&
                       item["supported_parameters"].is_array()) {
                for (const auto& parameter : item["supported_parameters"]) {
                    if (parameter.is_string() && parameter.get<std::string>() == "tools") {
                        model["tools"] = true;
                    }
                }
            }
        } else {
            continue;
        }
        models.push_back(std::move(model));
    }
    result.erase("body");
    result["models"] = std::move(models);
    return result;
}

// ai.test: verified iff ok with a non-empty choices array; the model that answered; the
// fingerprint of the triple used for a verified custom target (the core writes no setting).
json test_result(const ai::HttpOutcome& outcome, const ResolvedTarget& target) {
    json result = outcome.to_json();
    bool verified = false;
    if (outcome.ok && outcome.body->is_object()) {
        const auto choices = outcome.body->find("choices");
        verified = choices != outcome.body->end() && choices->is_array() && !choices->empty();
    }
    result["verified"] = verified;
    if (verified) {
        const auto model = outcome.body->find("model");
        result["model"] = model != outcome.body->end() && model->is_string()
                              ? model->get<std::string>()
                              : target.model;
        if (target.kind == "custom") {
            result["fingerprint"] = util::ai_fingerprint(target.address, target.key, target.model);
        }
    }
    return result;
}

// Starts the exchange as a job and answers {jobId}.
json start_exchange(Services& services, rpc::RpcContext& ctx, Method method, ResolvedTarget target,
                    bool post, std::string body) {
    ai::HttpRequest request = build_request(services, target, post, std::move(body));
    ai::Transport& transport = services.ai.transport();
    const std::string job_id =
        ctx.jobs.start([&services, &transport, method, target = std::move(target),
                        request = std::move(request)](rpc::JobControl& control) -> json {
            // Each phase once, when entered.
            std::string last_phase;
            const ai::ProgressFn progress = [&](const char* phase, std::int64_t done,
                                                std::int64_t total) {
                if (phase != last_phase) {
                    last_phase = phase;
                    control.progress(phase, done, total);
                }
            };
            AiRequestRecord record = base_record(method, target);
            ai::HttpOutcome outcome;
            try {
                outcome = transport.send(request, control, progress);
            } catch (const rpc::RpcError& e) {
                if (e.code == rpc::codes::kCancelled) {
                    record.outcome = "cancelled";
                    services.ai.record(std::move(record));
                }
                throw;
            }
            if (control.cancelled()) {
                record.outcome = "cancelled";
                services.ai.record(std::move(record));
                throw rpc::RpcError(rpc::codes::kCancelled, "", json{{"jobId", control.id()}});
            }
            record.outcome = outcome.ok ? "ok" : outcome.kind;
            record.status = outcome.status;
            record.elapsed_ms = outcome.elapsed_ms;
            services.ai.record(std::move(record));
            log_outcome(method, target, outcome);
            switch (method) {
                case Method::complete:
                    return outcome.to_json();
                case Method::models:
                    return normalise_models(outcome);
                case Method::test:
                    return test_result(outcome, target);
            }
            return outcome.to_json();
        });
    return json{{"jobId", job_id}};
}

// The synchronous part of the three jobs: step 0, the resolution (a refusal is recorded), the
// body, then the job.
json exchange(Services& services, const json& params, rpc::RpcContext& ctx, Method method) {
    services.ai.touch();
    const auto refused = [&](const rpc::RpcError& e) {
        if (e.code != rpc::codes::kAiNoService) {
            return;
        }
        const json* target = rpc::params::opt_field(params, "target");
        const std::string kind =
            target != nullptr && target->is_object() ? target->value("kind", "") : "";
        if (kind != "free" && kind != "custom") {
            return;
        }
        AiRequestRecord record;
        record.at = settings::now_iso8601_utc();
        record.method = method_name(method);
        record.target_kind = kind;
        if (kind == "free" && target->contains("id") && (*target)["id"].is_string()) {
            record.service_id = (*target)["id"].get<std::string>();
        }
        record.outcome = "refused";
        record.reason = e.data.value("reason", "");
        services.ai.record(std::move(record));
    };
    try {
        if (method == Method::complete && services.settings.get_string("ai.mode") == "disabled") {
            throw no_service("disabled");
        }
        ResolvedTarget target = resolve_target(services, params, method);
        if (method == Method::models) {
            return start_exchange(services, ctx, method, std::move(target), false, "");
        }
        json body;
        if (method == Method::test) {
            body = json{
                {"model", target.model},
                {"stream", false},
                {"messages", json::array({json{{"role", "user"},
                                               {"content", "Reply with the single word OK."}}})}};
        } else {
            const json* given = rpc::params::opt_field(params, "body");
            if (given == nullptr || !given->is_object()) {
                throw rpc::invalid_params("body must be an object", json{{"field", "body"}});
            }
            const auto messages = given->find("messages");
            if (messages == given->end() || !messages->is_array()) {
                throw rpc::invalid_params("body.messages must be an array",
                                          json{{"field", "body.messages"}});
            }
            body = *given;
            body["model"] = target.model;
            body["stream"] = false;
        }
        std::string serialised = body.dump(-1, ' ', false, json::error_handler_t::replace);
        if (serialised.size() > ai::kMaxRequestBytes) {
            throw rpc::invalid_params("body is larger than 8 MiB",
                                      json{{"field", "body"}, {"reason", "tooLarge"}});
        }
        return start_exchange(services, ctx, method, std::move(target), true,
                              std::move(serialised));
    } catch (const rpc::RpcError& e) {
        refused(e);
        throw;
    }
}

}  // namespace

void register_ai_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("ai.services", [&services](const json&, rpc::RpcContext&) {
        return services.ai.services()->to_json();
    });

    router.add_method("ai.reloadServices", [&services](const json&, rpc::RpcContext& ctx) {
        return reload_and_notify(services, ctx);
    });

    router.add_method("ai.createUserServices", [&services](const json&, rpc::RpcContext& ctx) {
        services.ai.touch();
        ai::UserCopy copy;
        try {
            copy = ai::create_user_copy(services.ai.bundled_file(), services.ai.user_layer().user);
        } catch (const atomic_file::WriteError& e) {
            throw rpc::RpcError(rpc::codes::kDocIoError, "",
                                json{{"path", e.path}, {"reason", e.reason}});
        }
        reload_and_notify(services, ctx);
        return json{{"path", platform::utf8_from_path(copy.path)}, {"created", copy.created}};
    });

    router.add_method("ai.complete", [&services](const json& params, rpc::RpcContext& ctx) {
        return exchange(services, params, ctx, Method::complete);
    });
    router.add_method("ai.models", [&services](const json& params, rpc::RpcContext& ctx) {
        return exchange(services, params, ctx, Method::models);
    });
    router.add_method("ai.test", [&services](const json& params, rpc::RpcContext& ctx) {
        return exchange(services, params, ctx, Method::test);
    });
}

}  // namespace mfbe::server
