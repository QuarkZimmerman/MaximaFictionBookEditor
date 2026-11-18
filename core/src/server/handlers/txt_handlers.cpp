// Feature 017 (specs/017-txt-export-import/contracts/rpc-api.md): the TXT export's and import's
// methods. txt.encodings answers the encodings and the lists of English, Russian and Ukrainian
// books (D11, DP-2) - the one source the export dialog, the settings and the tests read.

#include "server/services.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/single_byte.hpp>
#include <mfbe/utf8_paths.hpp>

#include <filesystem>
#include <memory>
#include <string>
#include <vector>

namespace mfbe::server {
namespace {

namespace fs = std::filesystem;
using nlohmann::json;

// D11 (contracts/encodings.md): the lists of a Russian, Ukrainian and English book, UTF-8 first,
// the HTML Standard's suggestion next. Any other book is offered "all".
const std::vector<std::string> kRussian = {"utf-8",      "windows-1251", "koi8-r",        "ibm866",
                                           "iso-8859-5", "koi8-u",       "x-mac-cyrillic"};
const std::vector<std::string> kUkrainian = {"utf-8", "windows-1251", "koi8-u", "x-mac-cyrillic"};
const std::vector<std::string> kEnglish = {"utf-8", "windows-1252", "iso-8859-1", "iso-8859-15",
                                           "macintosh"};

json encodings_answer() {
    json all = json::array({json{{"name", "utf-8"}, {"labelKey", "txt.encoding.utf-8"}}});
    for (const std::string& name : text::single_byte_names()) {
        all.push_back(json{{"name", name}, {"labelKey", "txt.encoding." + name}});
    }
    return json{{"all", all}, {"ru", kRussian}, {"uk", kUkrainian}, {"en", kEnglish}};
}

std::string utf8_of(char32_t c) {
    std::string out;
    if (c < 0x80) {
        out.push_back(static_cast<char>(c));
    } else if (c < 0x800) {
        out.push_back(static_cast<char>(0xC0 | (c >> 6)));
        out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
    } else if (c < 0x10000) {
        out.push_back(static_cast<char>(0xE0 | (c >> 12)));
        out.push_back(static_cast<char>(0x80 | ((c >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (c >> 18)));
        out.push_back(static_cast<char>(0x80 | ((c >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((c >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
    }
    return out;
}

// The text with CR LF line ends: "\n" from the interface, any "\r" it holds dropped (D10).
std::string with_crlf(std::string_view text) {
    std::string out;
    out.reserve(text.size() + text.size() / 32);
    for (const char c : text) {
        if (c == '\r') {
            continue;
        }
        if (c == '\n') {
            out.push_back('\r');
        }
        out.push_back(c);
    }
    return out;
}

struct TxtExport {
    fs::path path;
    std::string text;
    std::string encoding;
    bool bom = false;
};

// The file's bytes and the summary's replacements (D10, D12, D16).
json write_txt(const TxtExport& job) {
    const std::string lines = with_crlf(job.text);
    std::string bytes;
    json replaced = json::array();
    std::size_t left_out = 0;
    if (job.encoding == "utf-8") {
        bytes = job.bom ? std::string("\xEF\xBB\xBF") : std::string();
        bytes += text::utf8_without_soft_hyphens(lines);
    } else {
        const auto encoded = text::encode_single_byte(lines, job.encoding);
        bytes = encoded->bytes;
        for (const auto& r : encoded->replaced) {
            if (r.as.empty()) {
                left_out += r.count;
            }
            replaced.push_back(
                json{{"char", utf8_of(r.character)}, {"count", r.count}, {"as", r.as}});
        }
    }
    atomic_file::write_atomic(job.path, bytes);
    return json{{"path", platform::utf8_from_path(job.path)},
                {"replaced", replaced},
                {"leftOut", left_out}};
}

}  // namespace

void register_txt_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("txt.encodings",
                      [](const json&, rpc::RpcContext&) { return encodings_answer(); });

    // Feature 017 (D10 to D13, DP-4; contracts/rpc-api.md): the laid-out text written in the chosen
    // encoding with CR LF, the byte-order mark only for UTF-8 when asked; atomically; never over
    // the book's own file or the archive it came from (1006, as the other exports).
    router.add_method("txt.export", [&services](const json& params, rpc::RpcContext& ctx) {
        const std::string doc_id = rpc::params::string(params, "docId");
        auto& session = services.documents.require(doc_id);
        auto job = std::make_shared<TxtExport>();
        job->path = fs::absolute(platform::path_from_utf8(rpc::params::string(params, "path")));
        job->text = rpc::params::string(params, "text");
        job->encoding = rpc::params::string_or(params, "encoding", "utf-8");
        job->bom = params.value("bom", false);
        if (job->encoding != "utf-8" && !text::is_single_byte(job->encoding)) {
            throw rpc::invalid_params("unknown encoding", json{{"encoding", job->encoding}});
        }
        if (session.path) {
            std::error_code ec;
            if (fs::equivalent(job->path, platform::path_from_utf8(*session.path), ec)) {
                throw rpc::RpcError(rpc::codes::kDocSameAsOpenFile, "",
                                    json{{"path", platform::utf8_from_path(job->path)}});
            }
        }
        const std::string job_id = ctx.jobs.start([job](rpc::JobControl& control) {
            control.check_cancelled();
            control.progress("write", 0, 1);
            json result = write_txt(*job);
            control.progress("write", 1, 1);
            return result;
        });
        return json{{"jobId", job_id}};
    });
}

}  // namespace mfbe::server
