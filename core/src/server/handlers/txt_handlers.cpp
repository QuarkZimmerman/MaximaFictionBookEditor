// Feature 017 (specs/017-txt-export-import/contracts/rpc-api.md): the TXT export's and import's
// methods. txt.encodings answers the encodings and the lists of English, Russian and Ukrainian
// books (D11, DP-2) - the one source the export dialog, the settings and the tests read.

#include "server/services.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/single_byte.hpp>
#include <mfbe/text_encoding.hpp>
#include <mfbe/utf8_paths.hpp>

#include <cctype>
#include <filesystem>
#include <fstream>
#include <functional>
#include <memory>
#include <random>
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
    // D13: a ZIP archive with <stem>.txt and the book's <stem>.fbd, pre-built on the loop thread
    // so concurrent txt.export worker threads never touch DocumentRegistry.
    bool zip = false;
    std::string fbd_bytes;
};

// The file's bytes and the summary's replacements (D10, D12, D16); the TXT, or the ZIP with the
// FBD.
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
    if (job.zip) {
        // D13 (as the PDF export's archive, 016 D25): <stem>.txt and <stem>.fbd at the archive's
        // top, named after it; the archive replaces the target only when complete.
        const std::string stem = platform::utf8_from_path(job.path.stem());
        atomic_file::write_atomic(
            job.path, archive::zip_entries({{stem + ".txt", bytes, false, false},
                                            {stem + ".fbd", job.fbd_bytes, false, false}}));
    } else {
        atomic_file::write_atomic(job.path, bytes);
    }
    return json{{"path", platform::utf8_from_path(job.path)},
                {"replaced", replaced},
                {"leftOut", left_out}};
}

// --- The TXT import's session (txtImport.*, DP-10; as pdfImport.*) -----------------------------

constexpr std::uintmax_t kMaxTextBytes = 128ULL * 1024 * 1024;  // as the Markdown import (D26)

rpc::RpcError refused(const std::string& reason, json data = json::object()) {
    data["reason"] = reason;
    return rpc::RpcError(rpc::codes::kTextImportRefused, "", std::move(data));
}

std::string new_token() {
    static const char kHex[] = "0123456789abcdef";
    std::random_device rd;
    std::string token;
    for (int i = 0; i < 32; ++i) {
        token.push_back(kHex[rd() & 0x0F]);
    }
    return token;
}

std::string lower_ascii(std::string s) {
    for (char& c : s) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return s;
}

bool has_extension(const std::string& name, const std::string& ext) {
    const std::string l = lower_ascii(name);
    return l.size() >= ext.size() && l.compare(l.size() - ext.size(), ext.size(), ext) == 0;
}

Services::TxtImportSession session_of(Services& services, const json& params) {
    const std::string token = rpc::params::string(params, "token");
    std::lock_guard lock(services.txt_import.mutex);
    const auto it = services.txt_import.sessions.find(token);
    if (it == services.txt_import.sessions.end()) {
        throw rpc::RpcError(rpc::codes::kTxtImportUnknownToken, "", json{{"token", token}});
    }
    return it->second;
}

// D36: an FB2 or FBD book is refused by its root element, whatever its name.
bool looks_like_fictionbook(const std::string& utf8) {
    const std::size_t at = utf8.find('<');
    if (at == std::string::npos) {
        return false;
    }
    const std::string head = utf8.substr(at, 4096);
    return head.rfind("<?xml", 0) == 0 ? head.find("<FictionBook") != std::string::npos
                                       : head.rfind("<FictionBook", 0) == 0;
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
        job->zip = params.value("zip", false);
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
        if (job->zip) {
            // D13: build the companion FBD on the event-loop thread while DocumentRegistry is
            // exclusively owned here, matching mobi.write.commit (Feature 019 thread-safety fix).
            if (rpc::params::opt_field(params, "document") == nullptr) {
                throw rpc::invalid_params("document is required for a ZIP archive",
                                          json{{"field", "document"}});
            }
            const fs::path work = services.dirs.state / "txt-export" / new_token();
            std::error_code ec;
            fs::create_directories(work, ec);
            fs::path fbd = work / job->path.stem();
            fbd += ".fbd";  // path-text: an ASCII extension
            try {
                write_description_file(services, doc_id, params, platform::utf8_from_path(fbd));
                job->fbd_bytes = atomic_file::read_file(fbd);
            } catch (...) {
                fs::remove_all(work, ec);
                throw;
            }
            fs::remove_all(work, ec);
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

    // Feature 017 (D23 to D26, D31, D36, DP-9, DP-10): the TXT import's session. begin lists an
    // archive's TXT and FBD files first (the interface asks which TXT, D31) and holds the TXT
    // chosen; read decodes it (BOM, UTF-8, else the judge among D11's encodings, else the
    // question); the file and its archive are never written; end removes the session's folder.
    router.add_method("txtImport.begin", [&services](const json& params, rpc::RpcContext&) {
        const fs::path path = platform::path_from_utf8(rpc::params::string(params, "path"));
        const auto entry = rpc::params::opt_string(params, "entry");
        const fs::path root = services.dirs.state / "txt-import";
        std::error_code ec;
        {
            std::lock_guard lock(services.txt_import.mutex);
            if (!services.txt_import.cleaned) {
                for (const auto& old : fs::directory_iterator(root, ec)) {
                    fs::remove_all(old.path(), ec);
                }
                services.txt_import.cleaned = true;
            }
        }
        if (!path.is_absolute() || !fs::is_regular_file(path, ec)) {
            throw rpc::RpcError(
                rpc::codes::kDocIoError, "",
                json{{"path", platform::utf8_from_path(path)}, {"reason", "file not found"}});
        }
        const archive::Kind kind = archive::detect_kind(path);
        if (archive::is_other_archive(kind)) {
            throw refused("otherArchive", json{{"kind", archive::kind_name(kind)}});
        }
        Services::TxtImportSession session;
        const std::string token = new_token();
        session.folder = root / token;
        session.file = path;
        if (kind == archive::Kind::zip) {
            if (!entry) {
                json txts = json::array(), fbds = json::array();
                try {
                    for (const archive::Entry& e : archive::list(path).entries) {
                        if (e.directory) {
                            continue;
                        }
                        const json item{{"entry", e.name}, {"size", e.size}};
                        if (has_extension(e.name, ".txt")) {
                            txts.push_back(item);
                        } else if (has_extension(e.name, ".fbd")) {
                            fbds.push_back(item);
                        }
                    }
                } catch (const archive::ArchiveError& e) {
                    throw refused(archive::reason_name(e.reason));
                }
                if (txts.empty()) {
                    throw refused("noTxtInArchive");
                }
                return json{{"archive", {{"txts", txts}, {"fbds", fbds}}}};
            }
            fs::create_directories(session.folder, ec);
            fs::permissions(session.folder, fs::perms::owner_all, fs::perm_options::replace, ec);
            try {
                const std::string bytes = archive::read_entry(path, *entry);
                session.file = session.folder / "source.txt";
                std::ofstream(session.file, std::ios::binary) << bytes;
            } catch (const archive::ArchiveError& e) {
                fs::remove_all(session.folder, ec);
                throw refused(archive::reason_name(e.reason));
            }
            session.archive = path;
        }
        std::lock_guard lock(services.txt_import.mutex);
        services.txt_import.sessions.emplace(token, std::move(session));
        return json{{"token", token}};
    });

    router.add_method("txtImport.read", [&services](const json& params, rpc::RpcContext&) {
        const Services::TxtImportSession session = session_of(services, params);
        std::error_code ec;
        if (const std::uintmax_t size = fs::file_size(session.file, ec);
            !ec && size > kMaxTextBytes) {
            throw refused("tooLarge", json{{"limit", kMaxTextBytes}});
        }
        std::string bytes;
        try {
            bytes = fb2::read_file_bytes(session.file);
        } catch (const fb2::IoFailure& e) {
            throw rpc::RpcError(rpc::codes::kDocIoError, "",
                                json{{"path", e.path}, {"reason", e.reason}});
        }
        if (bytes.find_first_not_of(" \t\r\n\f\v") == std::string::npos) {
            throw refused("empty");
        }
        if (text::looks_binary(bytes)) {
            throw refused("binary");
        }
        const std::string wanted = rpc::params::string_or(params, "encoding", "");
        json answer;
        if (!wanted.empty()) {
            std::optional<std::string> decoded = text::decode_text(bytes, wanted);
            if (!decoded) {
                throw rpc::invalid_params("unknown encoding", json{{"field", "encoding"}});
            }
            answer =
                json{{"text", std::move(*decoded)}, {"encoding", wanted}, {"source", "chosen"}};
        } else {
            text::TextReading reading = text::read_text(bytes, text::txt_candidates());
            if (!reading.decided) {
                return json{{"needsEncoding", json{{"candidates", reading.candidates}}}};
            }
            answer = json{{"text", std::move(reading.utf8)},
                          {"encoding", reading.encoding},
                          {"source", reading.source}};
        }
        if (looks_like_fictionbook(answer["text"].get_ref<const std::string&>())) {
            throw refused("fictionBook");
        }
        return answer;
    });

    router.add_method("txtImport.extractFbd", [&services](const json& params, rpc::RpcContext&) {
        const Services::TxtImportSession session = session_of(services, params);
        if (!session.archive) {
            throw rpc::invalid_params("the session has no archive", json{{"field", "token"}});
        }
        const std::string entry = rpc::params::string(params, "entry");
        try {
            const std::string bytes = archive::read_entry(*session.archive, entry);
            const fs::path out = session.folder / ("fbd-" + new_token().substr(0, 8) + ".fbd");
            std::ofstream(out, std::ios::binary) << bytes;
            return json{{"path", platform::utf8_from_path(out)}};
        } catch (const archive::ArchiveError& e) {
            throw refused(archive::reason_name(e.reason));
        }
    });

    router.add_method("txtImport.end", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        std::lock_guard lock(services.txt_import.mutex);
        const auto it = services.txt_import.sessions.find(token);
        if (it != services.txt_import.sessions.end()) {
            std::error_code ec;
            fs::remove_all(it->second.folder, ec);
            services.txt_import.sessions.erase(it);
        }
        return json::object();
    });
}

}  // namespace mfbe::server
