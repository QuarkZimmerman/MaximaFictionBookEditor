// Dialog request/result JSON shapes and the queued test provider (T025).
#include <mfbe/dialog_provider.hpp>
#include <mfbe/recent_files.hpp>

#include <algorithm>
#include <cctype>
#include <stdexcept>

namespace mfbe {
namespace {

using json = nlohmann::json;

const json& require_object(const json& j) {
    if (j.is_null()) {
        static const json empty = json::object();
        return empty;
    }
    if (!j.is_object()) {
        throw std::invalid_argument("expected an object");
    }
    return j;
}

std::string str_or(const json& o, const char* key, const std::string& fallback = "") {
    auto it = o.find(key);
    if (it == o.end() || it->is_null()) {
        return fallback;
    }
    if (!it->is_string()) {
        throw std::invalid_argument(std::string(key) + " must be a string");
    }
    return it->get<std::string>();
}

std::optional<std::string> opt_str(const json& o, const char* key) {
    auto it = o.find(key);
    if (it == o.end() || it->is_null()) {
        return std::nullopt;
    }
    if (!it->is_string()) {
        throw std::invalid_argument(std::string(key) + " must be a string");
    }
    return it->get<std::string>();
}

int index_or(const json& o, const char* key, int fallback) {
    auto it = o.find(key);
    if (it == o.end() || it->is_null()) {
        return fallback;
    }
    if (!it->is_number_integer() || it->get<long long>() < 0 || it->get<long long>() > 1000) {
        throw std::invalid_argument(std::string(key) + " must be a non-negative integer");
    }
    return it->get<int>();
}

bool bool_or(const json& o, const char* key, bool fallback) {
    auto it = o.find(key);
    if (it == o.end() || it->is_null()) {
        return fallback;
    }
    if (!it->is_boolean()) {
        throw std::invalid_argument(std::string(key) + " must be a boolean");
    }
    return it->get<bool>();
}

std::vector<std::string> strings_or(const json& o, const char* key) {
    std::vector<std::string> out;
    auto it = o.find(key);
    if (it == o.end() || it->is_null()) {
        return out;
    }
    if (!it->is_array()) {
        throw std::invalid_argument(std::string(key) + " must be an array of strings");
    }
    for (const auto& item : *it) {
        if (!item.is_string()) {
            throw std::invalid_argument(std::string(key) + " must be an array of strings");
        }
        out.push_back(item.get<std::string>());
    }
    return out;
}

std::vector<FileFilter> filters_from_json(const json& o) {
    std::vector<FileFilter> out;
    auto it = o.find("filters");
    if (it == o.end() || it->is_null()) {
        return out;
    }
    if (!it->is_array()) {
        throw std::invalid_argument("filters must be an array");
    }
    for (const auto& item : *it) {
        const json& f = require_object(item);
        FileFilter filter;
        filter.name = str_or(f, "name");
        filter.extensions = strings_or(f, "extensions");
        out.push_back(std::move(filter));
    }
    return out;
}

json filters_to_json(const std::vector<FileFilter>& filters) {
    json arr = json::array();
    for (const auto& f : filters) {
        arr.push_back(to_json(f));
    }
    return arr;
}

}  // namespace

bool offers_fictionbook_files(const std::vector<FileFilter>& filters) {
    for (const auto& filter : filters) {
        for (const auto& raw : filter.extensions) {
            std::string extension = raw;
            if (extension.rfind("*.", 0) == 0) {
                extension.erase(0, 2);
            } else if (extension.rfind('.', 0) == 0) {
                extension.erase(0, 1);
            }
            std::transform(extension.begin(), extension.end(), extension.begin(),
                           [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            if (extension == "fb2" || extension == "fbd") {
                return true;
            }
        }
    }
    return false;
}

json to_json(const FileFilter& f) {
    return json{{"name", f.name}, {"extensions", f.extensions}};
}

json to_json(const OpenFileRequest& r) {
    json j{{"title", r.title},
           {"filters", filters_to_json(r.filters)},
           {"multiple", r.multiple},
           {"selectedFilter", r.selectedFilter}};
    if (r.folder) {
        j["folder"] = *r.folder;
    }
    if (r.defaultPath) {
        j["defaultPath"] = *r.defaultPath;
    }
    return j;
}

json to_json(const OpenFileResult& r) {
    return json{{"paths", r.paths}};
}

json to_json(const SaveFileRequest& r) {
    json j{{"title", r.title}, {"filters", filters_to_json(r.filters)}};
    if (r.defaultPath) {
        j["defaultPath"] = *r.defaultPath;
    }
    j["encodingChoices"] = r.encodingChoices;
    if (r.selectedEncoding) {
        j["selectedEncoding"] = *r.selectedEncoding;
    }
    if (r.encodingLabel) {
        j["encodingLabel"] = *r.encodingLabel;
    }
    j["selectedFilter"] = r.selectedFilter;
    if (r.folder) {
        j["folder"] = *r.folder;
    }
    return j;
}

json to_json(const SaveFileResult& r) {
    json j = json::object();
    if (r.path) {
        j["path"] = *r.path;
    }
    if (r.encoding) {
        j["encoding"] = *r.encoding;
    }
    return j;
}

json to_json(const PickFolderRequest& r) {
    return json{{"title", r.title}};
}

json to_json(const PickFolderResult& r) {
    json j = json::object();
    if (r.path) {
        j["path"] = *r.path;
    }
    return j;
}

json to_json(const MessageRequest& r) {
    return json{{"text", r.text}, {"caption", r.caption}, {"buttons", r.buttons}};
}

json to_json(const MessageResult& r) {
    return json{{"button", r.button}};
}

json to_json(const ReleaseResult& r) {
    if (r.release) {
        return json{
            {"tag", r.release->tag}, {"version", r.release->version}, {"url", r.release->url}};
    }
    return json{{"error", {{"reason", r.error}}}};
}

OpenFileRequest open_file_request_from_json(const json& j) {
    const json& o = require_object(j);
    OpenFileRequest r;
    r.title = str_or(o, "title");
    r.filters = filters_from_json(o);
    r.multiple = bool_or(o, "multiple", false);
    r.selectedFilter = index_or(o, "selectedFilter", 0);
    r.folder = opt_str(o, "folder");
    r.defaultPath = opt_str(o, "defaultPath");
    r.documentDialog = offers_fictionbook_files(r.filters);
    return r;
}

OpenFileResult open_file_result_from_json(const json& j) {
    const json& o = require_object(j);
    OpenFileResult r;
    r.paths = strings_or(o, "paths");
    if (auto single = opt_str(o, "path"); single && r.paths.empty()) {
        r.paths.push_back(*single);  // tolerate {path} for single selections
    }
    return r;
}

SaveFileRequest save_file_request_from_json(const json& j) {
    const json& o = require_object(j);
    SaveFileRequest r;
    r.title = str_or(o, "title");
    r.filters = filters_from_json(o);
    r.defaultPath = opt_str(o, "defaultPath");
    r.encodingChoices = strings_or(o, "encodingChoices");
    r.selectedEncoding = opt_str(o, "selectedEncoding");
    r.encodingLabel = opt_str(o, "encodingLabel");
    r.selectedFilter = index_or(o, "selectedFilter", 0);
    r.documentDialog = offers_fictionbook_files(r.filters);
    return r;
}

SaveFileResult save_file_result_from_json(const json& j) {
    const json& o = require_object(j);
    SaveFileResult r;
    r.path = opt_str(o, "path");
    r.encoding = opt_str(o, "encoding");
    return r;
}

PickFolderRequest pick_folder_request_from_json(const json& j) {
    PickFolderRequest r;
    r.title = str_or(require_object(j), "title");
    return r;
}

PickFolderResult pick_folder_result_from_json(const json& j) {
    PickFolderResult r;
    r.path = opt_str(require_object(j), "path");
    return r;
}

MessageRequest message_request_from_json(const json& j) {
    const json& o = require_object(j);
    MessageRequest r;
    r.text = str_or(o, "text");
    r.caption = str_or(o, "caption");
    r.buttons = strings_or(o, "buttons");
    return r;
}

MessageResult message_result_from_json(const json& j) {
    MessageResult r;
    r.button = str_or(require_object(j), "button");
    return r;
}

ReleaseResult release_result_from_json(const json& j) {
    const json& o = require_object(j);
    ReleaseResult r;
    if (auto error = o.find("error"); error != o.end() && !error->is_null()) {
        r.error = str_or(require_object(*error), "reason");
        if (r.error.empty()) {
            throw std::invalid_argument("error.reason must be a non-empty string");
        }
        return r;
    }
    auto result = o.find("result");
    const json& info = result != o.end() ? require_object(*result) : o;
    ReleaseInfo release;
    release.tag = str_or(info, "tag");
    if (release.tag.empty()) {
        throw std::invalid_argument("tag must be a non-empty string");
    }
    const std::string fallback = release.tag[0] == 'v' ? release.tag.substr(1) : release.tag;
    release.version = str_or(info, "version", fallback);
    release.url = str_or(
        info, "url",
        "https://github.com/QuarkZimmerman/MaximaFictionBookEditor/releases/tag/" + release.tag);
    r.release = std::move(release);
    return r;
}

ReleaseResult release_from_github(int http_status, std::string_view body) {
    ReleaseResult r;
    if (http_status != 200) {
        r.error = "http";
        return r;
    }
    const json answer = json::parse(body, nullptr, false);
    const auto flag = [&answer](const char* name) {
        const auto it = answer.find(name);
        return it != answer.end() && it->is_boolean() && it->get<bool>();
    };
    const auto tag = answer.is_object() ? answer.find("tag_name") : answer.end();
    if (!answer.is_object() || tag == answer.end() || !tag->is_string() ||
        tag->get<std::string>().empty() || flag("draft") || flag("prerelease")) {
        r.error = "format";
        return r;
    }
    return release_result_from_json(json{{"tag", tag->get<std::string>()}});
}

/* ----------------------------------------------------------------------------------------- */
/* QueuedDialogProvider                                                                       */
/* ----------------------------------------------------------------------------------------- */

std::size_t QueuedDialogProvider::enqueue(const std::string& method, json result) {
    std::lock_guard<std::mutex> lock(mutex_);
    queue_.push_back(Queued{method, std::move(result)});
    return queue_.size();
}

std::size_t QueuedDialogProvider::pending() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return queue_.size();
}

void QueuedDialogProvider::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    queue_.clear();
}

std::vector<std::string> QueuedDialogProvider::missed() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return missed_;
}

std::vector<std::string> QueuedDialogProvider::opened_paths() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return opened_paths_;
}

std::vector<json> QueuedDialogProvider::dialog_requests() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return requests_;
}

std::size_t QueuedDialogProvider::beeps() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return beeps_;
}

std::size_t QueuedDialogProvider::enqueue_release(ReleaseResult result) {
    std::lock_guard<std::mutex> lock(mutex_);
    releases_.push_back(std::move(result));
    return releases_.size();
}

std::vector<json> QueuedDialogProvider::network_requests() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return network_requests_;
}

void QueuedDialogProvider::record_restart(std::optional<std::string> reopen,
                                          std::vector<std::string> argv) {
    json request{{"argv", std::move(argv)}};
    if (reopen) {
        request["reopen"] = std::move(*reopen);
    }
    std::lock_guard<std::mutex> lock(mutex_);
    restart_requests_.push_back(std::move(request));
}

std::vector<json> QueuedDialogProvider::restart_requests() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return restart_requests_;
}

void QueuedDialogProvider::record(json request, const char* method, const char* mode) {
    request["method"] = method;
    request["mode"] = mode;
    std::lock_guard<std::mutex> lock(mutex_);
    requests_.push_back(std::move(request));
}

std::optional<json> QueuedDialogProvider::take(const std::string& method) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (queue_.empty() || queue_.front().method != method) {
        missed_.push_back(method);
        return std::nullopt;
    }
    json result = std::move(queue_.front().result);
    queue_.pop_front();
    return result;
}

void QueuedDialogProvider::open_file(const OpenFileRequest& request,
                                     Callback<OpenFileResult> done) {
    record(to_json(request), "dialog.openFile", request.multiple ? "openMultiple" : "open");
    auto answer = take("dialog.openFile");
    if (!answer) {
        throw DialogUnavailable("no queued answer for dialog.openFile");
    }
    done(open_file_result_from_json(*answer));
}

void QueuedDialogProvider::save_file(const SaveFileRequest& request,
                                     Callback<SaveFileResult> done) {
    record(to_json(request), "dialog.saveFile", "save");
    auto answer = take("dialog.saveFile");
    if (!answer) {
        throw DialogUnavailable("no queued answer for dialog.saveFile");
    }
    done(save_file_result_from_json(*answer));
}

void QueuedDialogProvider::pick_folder(const PickFolderRequest& request,
                                       Callback<PickFolderResult> done) {
    record(to_json(request), "dialog.pickFolder", "folder");
    auto answer = take("dialog.pickFolder");
    if (!answer) {
        throw DialogUnavailable("no queued answer for dialog.pickFolder");
    }
    done(pick_folder_result_from_json(*answer));
}

void QueuedDialogProvider::message(const MessageRequest&, Callback<MessageResult> done) {
    auto answer = take("dialog.message");
    if (!answer) {
        throw DialogUnavailable("no queued answer for dialog.message");
    }
    done(message_result_from_json(*answer));
}

bool QueuedDialogProvider::open_path(const std::string& path) {
    std::lock_guard<std::mutex> lock(mutex_);
    opened_paths_.push_back(path);
    return true;
}

void QueuedDialogProvider::beep() {
    std::lock_guard<std::mutex> lock(mutex_);
    ++beeps_;
}

void QueuedDialogProvider::latest_release(Callback<ReleaseResult> done) {
    std::optional<ReleaseResult> answer;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        network_requests_.push_back(
            json{{"method", "app.latestRelease"}, {"at", settings::now_iso8601_utc()}});
        if (!releases_.empty()) {
            answer = std::move(releases_.front());
            releases_.pop_front();
        }
    }
    if (!answer) {
        throw DialogUnavailable("no queued answer for app.latestRelease");
    }
    done(std::move(*answer));
}

}  // namespace mfbe
