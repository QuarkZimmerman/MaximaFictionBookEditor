#include <mfbe/maxima_lookup_client.hpp>
#include <mfbe/maxima_lookup_url.hpp>

#include <algorithm>
#include <array>
#include <cctype>

namespace mfbe::lookup {

namespace {

using nlohmann::json;

constexpr std::array<std::string_view, 8> kPersonRoles = {
    "author",   "translator", "illustrator", "editor",
    "compiler", "designer",   "commentator", "abouttheauthor"};

std::string trim_ascii_copy(std::string_view s) {
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) {
        s.remove_prefix(1);
    }
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) {
        s.remove_suffix(1);
    }
    return std::string(s);
}

std::string get_bounded_string(const json& obj, const char* key) {
    auto it = obj.find(key);
    if (it == obj.end() || !it->is_string()) {
        return {};
    }
    return truncate_utf8_codepoints(it->get<std::string>(), kMaxLookupTextChars);
}

json clamp_positive_id_array(const json& obj, const char* key) {
    json out = json::array();
    auto it = obj.find(key);
    if (it == obj.end() || !it->is_array()) {
        return out;
    }
    for (const auto& item : *it) {
        if (out.size() >= kMaxLookupFilterItems) {
            break;
        }
        if (item.is_number_integer()) {
            const std::int64_t val = item.get<std::int64_t>();
            if (val >= 1) {
                out.push_back(val);
            }
        }
    }
    return out;
}

json clamp_person_name_array(const json& obj, const char* key) {
    json out = json::array();
    auto it = obj.find(key);
    if (it == obj.end() || !it->is_array()) {
        return out;
    }
    for (const auto& item : *it) {
        if (out.size() >= kMaxLookupFilterItems) {
            break;
        }
        if (!item.is_object()) {
            continue;
        }
        std::string last = get_bounded_string(item, "lastName");
        std::string first = get_bounded_string(item, "firstName");
        std::string middle = get_bounded_string(item, "middleName");
        if (trim_ascii_copy(last).empty() && trim_ascii_copy(first).empty() &&
            trim_ascii_copy(middle).empty()) {
            continue;
        }
        out.push_back(json{{"lastName", std::move(last)},
                           {"firstName", std::move(first)},
                           {"middleName", std::move(middle)}});
    }
    return out;
}

json clamp_non_empty_string_array(const json& obj, const char* key) {
    json out = json::array();
    auto it = obj.find(key);
    if (it == obj.end() || !it->is_array()) {
        return out;
    }
    for (const auto& item : *it) {
        if (out.size() >= kMaxLookupFilterItems) {
            break;
        }
        if (!item.is_string()) {
            continue;
        }
        std::string trimmed = trim_ascii_copy(item.get<std::string>());
        if (trimmed.empty()) {
            continue;
        }
        out.push_back(truncate_utf8_codepoints(trimmed, kMaxLookupTextChars));
    }
    return out;
}

bool is_known_v2_error_code(std::string_view code) {
    return code == "unauthorized" || code == "invalid_token" || code == "account_disabled" ||
           code == "https_required" || code == "wrong_version" || code == "rate_limited" ||
           code == "method_not_allowed" || code == "invalid_request" || code == "server_error";
}

std::string map_http_status_to_code(int status) {
    if (status == 401) {
        return "unauthorized";
    }
    if (status == 403) {
        return "account_disabled";
    }
    if (status == 405) {
        return "method_not_allowed";
    }
    if (status == 429) {
        return "rate_limited";
    }
    if (status >= 500 && status <= 599) {
        return "server_error";
    }
    return "http";
}

}  // namespace

std::string truncate_utf8_codepoints(std::string_view input, std::size_t max_codepoints) {
    std::size_t count = 0;
    std::size_t byte_pos = 0;
    while (byte_pos < input.size() && count < max_codepoints) {
        const unsigned char c = static_cast<unsigned char>(input[byte_pos]);
        std::size_t step = 1;
        if ((c & 0x80) == 0) {
            step = 1;
        } else if ((c & 0xE0) == 0xC0) {
            step = 2;
        } else if ((c & 0xF0) == 0xE0) {
            step = 3;
        } else if ((c & 0xF8) == 0xF0) {
            step = 4;
        }
        if (byte_pos + step > input.size()) {
            break;
        }
        byte_pos += step;
        ++count;
    }
    return std::string(input.substr(0, byte_pos));
}

bool is_valid_person_role(std::string_view role) {
    return std::find(kPersonRoles.begin(), kPersonRoles.end(), role) != kPersonRoles.end();
}

json build_verify_request(std::string_view correlation_id) {
    return json{{"task", "verify"}, {"version", "2"}, {"id", std::string(correlation_id)}};
}

bool build_search_request(const json& rpc_params, std::string_view correlation_id, json& out_body,
                          int& out_page, int& out_page_size, std::string& err_reason) {
    if (!rpc_params.is_object() || !rpc_params.contains("kind") ||
        !rpc_params["kind"].is_string()) {
        err_reason = "missing kind";
        return false;
    }
    const std::string kind = rpc_params["kind"].get<std::string>();

    const int page = std::max(0, rpc_params.value("page", 0));
    const int page_size =
        std::clamp(rpc_params.value("pageSize", kDefaultLookupPageSize), 1, kMaxLookupPageSize);
    const std::int64_t raw_first =
        static_cast<std::int64_t>(page) * static_cast<std::int64_t>(page_size);
    const int first_record = static_cast<int>(
        std::clamp<std::int64_t>(raw_first, 0, static_cast<std::int64_t>(kMaxLookupFirstRecord)));
    // Request pageSize + 1 (<= 100) so the core computes an exact hasMore flag without phantom
    // empty trailing pages.
    const int records_per_search = std::min(page_size + 1, kMaxLookupRecordsPerSearch);

    out_page = page;
    out_page_size = page_size;
    out_body = json{{"task", "search"},
                    {"version", "2"},
                    {"id", std::string(correlation_id)},
                    {"firstRecord", first_record},
                    {"recordsPerSearch", records_per_search}};

    if (kind == "person") {
        const std::string role = rpc_params.value("role", std::string{});
        if (!is_valid_person_role(role)) {
            err_reason = "invalid person role";
            return false;
        }
        const std::string last_name = get_bounded_string(rpc_params, "lastName");
        const std::string first_name = get_bounded_string(rpc_params, "firstName");
        const std::string middle_name = get_bounded_string(rpc_params, "middleName");
        if (trim_ascii_copy(last_name).empty() && trim_ascii_copy(first_name).empty()) {
            err_reason = "lastName or firstName required";
            return false;
        }
        out_body["role"] = role;
        out_body["lastName"] = last_name;
        out_body["firstName"] = first_name;
        if (!middle_name.empty()) {
            out_body["middleName"] = middle_name;
        }
        return true;
    }

    if (kind == "authorSeries") {
        const std::string series_name = get_bounded_string(rpc_params, "seriesName");
        std::string narrow = rpc_params.value("narrow", std::string{"all"});
        if (narrow != "all" && narrow != "authors" && narrow != "makers") {
            err_reason = "invalid narrow tab";
            return false;
        }
        if (narrow == "all" && trim_ascii_copy(series_name).empty()) {
            err_reason = "seriesName required on all tab";
            return false;
        }
        out_body["role"] = "series";
        out_body["seriesName"] = series_name;
        out_body["narrow"] = narrow;
        if (rpc_params.contains("parentSeriesId") &&
            rpc_params["parentSeriesId"].is_number_integer()) {
            const std::int64_t pid = rpc_params["parentSeriesId"].get<std::int64_t>();
            if (pid > 0) {
                out_body["parentSeriesId"] = pid;
            }
        }
        if (rpc_params.contains("excludedSeriesId") &&
            rpc_params["excludedSeriesId"].is_number_integer()) {
            const std::int64_t eid = rpc_params["excludedSeriesId"].get<std::int64_t>();
            if (eid > 0) {
                out_body["excludedSeriesId"] = eid;
            }
        }
        json author_ids = clamp_positive_id_array(rpc_params, "authorIds");
        if (!author_ids.empty()) {
            out_body["authorIds"] = std::move(author_ids);
        }
        json author_names = clamp_person_name_array(rpc_params, "authorNames");
        if (!author_names.empty()) {
            out_body["authorNames"] = std::move(author_names);
        }
        json maker_ids = clamp_positive_id_array(rpc_params, "makerIds");
        if (!maker_ids.empty()) {
            out_body["makerIds"] = std::move(maker_ids);
        }
        json maker_names = clamp_person_name_array(rpc_params, "makerNames");
        if (!maker_names.empty()) {
            out_body["makerNames"] = std::move(maker_names);
        }
        return true;
    }

    if (kind == "publisher") {
        const std::string publisher_name = get_bounded_string(rpc_params, "publisherName");
        if (trim_ascii_copy(publisher_name).empty()) {
            err_reason = "publisherName required";
            return false;
        }
        out_body["role"] = "publisher";
        out_body["publisherName"] = publisher_name;
        return true;
    }

    if (kind == "publisherSeries") {
        const std::string series_name = get_bounded_string(rpc_params, "seriesName");
        const bool restrict_flag = rpc_params.value("restrict", false);
        json pub_ids = clamp_positive_id_array(rpc_params, "publisherIds");
        json pub_names = clamp_non_empty_string_array(rpc_params, "publisherNames");
        if (trim_ascii_copy(series_name).empty() &&
            (!restrict_flag || (pub_ids.empty() && pub_names.empty()))) {
            err_reason = "seriesName required unless restrict=true with publisher context";
            return false;
        }
        out_body["role"] = "publisherseries";
        out_body["seriesName"] = series_name;
        if (!pub_ids.empty()) {
            out_body["publisherIds"] = std::move(pub_ids);
        }
        if (!pub_names.empty()) {
            out_body["publisherNames"] = std::move(pub_names);
        }
        if (restrict_flag) {
            out_body["restrict"] = true;
        }
        return true;
    }

    err_reason = "unknown search kind";
    return false;
}

bool build_exists_request(const json& rpc_params, std::string_view correlation_id, json& out_body,
                          std::string& err_reason) {
    if (!rpc_params.is_object() || !rpc_params.contains("kind") ||
        !rpc_params["kind"].is_string()) {
        err_reason = "missing kind";
        return false;
    }
    const std::string kind = rpc_params["kind"].get<std::string>();
    out_body = json{{"task", "exists"}, {"version", "2"}, {"id", std::string(correlation_id)}};

    if (kind == "person") {
        const std::string role = rpc_params.value("role", std::string{});
        if (!is_valid_person_role(role)) {
            err_reason = "invalid person role";
            return false;
        }
        const std::string last_name = get_bounded_string(rpc_params, "lastName");
        const std::string first_name = get_bounded_string(rpc_params, "firstName");
        const std::string middle_name = get_bounded_string(rpc_params, "middleName");
        if (trim_ascii_copy(last_name).empty() && trim_ascii_copy(first_name).empty()) {
            err_reason = "lastName or firstName required";
            return false;
        }
        out_body["role"] = role;
        out_body["lastName"] = last_name;
        out_body["firstName"] = first_name;
        out_body["middleName"] = middle_name;
        return true;
    }

    if (kind == "authorSeries") {
        const std::string series_name = get_bounded_string(rpc_params, "seriesName");
        if (trim_ascii_copy(series_name).empty()) {
            err_reason = "seriesName required";
            return false;
        }
        out_body["role"] = "series";
        out_body["seriesName"] = series_name;
        if (rpc_params.contains("parentSeriesId") &&
            rpc_params["parentSeriesId"].is_number_integer()) {
            const std::int64_t pid = rpc_params["parentSeriesId"].get<std::int64_t>();
            if (pid > 0) {
                out_body["parentSeriesId"] = pid;
            }
        }
        return true;
    }

    if (kind == "publisher") {
        const std::string publisher_name = get_bounded_string(rpc_params, "publisherName");
        if (trim_ascii_copy(publisher_name).empty()) {
            err_reason = "publisherName required";
            return false;
        }
        out_body["role"] = "publisher";
        out_body["publisherName"] = publisher_name;
        return true;
    }

    if (kind == "publisherSeries") {
        const std::string series_name = get_bounded_string(rpc_params, "seriesName");
        if (trim_ascii_copy(series_name).empty()) {
            err_reason = "seriesName required";
            return false;
        }
        out_body["role"] = "publisherseries";
        out_body["seriesName"] = series_name;
        json pub_ids = clamp_positive_id_array(rpc_params, "publisherIds");
        if (!pub_ids.empty()) {
            out_body["publisherIds"] = std::move(pub_ids);
        }
        json pub_names = clamp_non_empty_string_array(rpc_params, "publisherNames");
        if (!pub_names.empty()) {
            out_body["publisherNames"] = std::move(pub_names);
        }
        if (rpc_params.value("restrict", false)) {
            out_body["restrict"] = true;
        }
        return true;
    }

    err_reason = "unknown exists kind";
    return false;
}

MaximaLookupCallResult interpret_v2_response(const net::AiOutcome& outcome,
                                             std::string_view expected_correlation_id) {
    MaximaLookupCallResult res;
    res.retry_after_seconds = outcome.retry_after_seconds;

    if (outcome.kind == net::OutcomeKind::cancelled || outcome.kind == net::OutcomeKind::offline ||
        outcome.kind == net::OutcomeKind::timeout || outcome.kind == net::OutcomeKind::tls ||
        outcome.kind == net::OutcomeKind::format) {
        res.ok = false;
        res.code = std::string(net::outcome_kind_name(outcome.kind));
        res.message = outcome.message;
        return res;
    }

    if (!outcome.body || !outcome.body->is_object()) {
        res.ok = false;
        if (outcome.status.has_value() && *outcome.status != 200) {
            res.code = map_http_status_to_code(*outcome.status);
            res.message = "HTTP " + std::to_string(*outcome.status);
        } else {
            res.code = "format";
            res.message = "Unexpected response format from lookup endpoint";
        }
        return res;
    }

    const json& body = *outcome.body;
    const std::string echoed_id =
        (body.contains("id") && body["id"].is_string()) ? body["id"].get<std::string>() : "";
    if (!echoed_id.empty() && echoed_id != expected_correlation_id) {
        res.ok = false;
        res.code = "format";
        res.message = "Correlation ID mismatch in lookup response";
        return res;
    }

    if (!body.contains("code") || !body["code"].is_string()) {
        res.ok = false;
        if (outcome.status.has_value() && *outcome.status != 200) {
            res.code = map_http_status_to_code(*outcome.status);
            res.message = "HTTP " + std::to_string(*outcome.status);
        } else {
            res.code = "format";
            res.message = "Response is not a Lookup Service v2 payload";
        }
        return res;
    }

    const std::string v2_code = body["code"].get<std::string>();
    const std::string v2_err =
        (body.contains("err") && body["err"].is_string()) ? body["err"].get<std::string>() : "";

    if (outcome.kind == net::OutcomeKind::ok && outcome.status.value_or(0) == 200 &&
        v2_code.empty()) {
        res.ok = true;
        res.payload = body;
        return res;
    }

    res.ok = false;
    if (!v2_code.empty()) {
        res.code = is_known_v2_error_code(v2_code) ? v2_code : "http";
    } else if (outcome.status.has_value()) {
        res.code = map_http_status_to_code(*outcome.status);
    } else {
        res.code = "http";
    }
    res.message = !v2_err.empty()
                      ? v2_err
                      : (outcome.status.has_value() ? ("HTTP " + std::to_string(*outcome.status))
                                                    : outcome.message);
    return res;
}

MaximaLookupClient::MaximaLookupClient(net::HttpClient& http_client) : http_(http_client) {}

MaximaLookupCallResult MaximaLookupClient::execute(
    std::string_view normalized_domain, std::string_view plaintext_token, const json& request_body,
    std::string_view correlation_id, rpc::JobControl& control,
    const std::vector<std::string>& resolve_overrides, const net::ProgressFn& progress) {
    MaximaLookupCallResult res;
    const auto domain_check = normalize_and_validate_domain(normalized_domain);
    if (!domain_check.ok) {
        res.ok = false;
        res.code = domain_check.code;
        res.message = domain_check.code == "httpsRequired"
                          ? "HTTPS is required for remote Maxima Library domains"
                          : "Invalid Maxima Library domain";
        return res;
    }
    if (plaintext_token.empty()) {
        res.ok = false;
        res.code = "emptyToken";
        res.message = "Access token is empty";
        return res;
    }

    net::HttpRequest req;
    req.method = "POST";
    req.url = build_lookup_v2_endpoint(domain_check.normalized_domain);
    req.key = std::string(plaintext_token);
    req.body = request_body.dump();
    req.connect_ms = kLookupConnectTimeoutMs;
    req.total_ms = kLookupTotalTimeoutMs;
    req.resolve_entries = resolve_overrides;

    const net::AiOutcome outcome = http_.perform(req, control, progress);
    return interpret_v2_response(outcome, correlation_id);
}

}  // namespace mfbe::lookup
