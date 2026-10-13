// mfbe-core: headless core executable (T023) - contracts/cli.md §2.
//
//   mfbe-core serve [--port N] [--token HEX] [--ui DIR] [--open FILE]... [--data-dir DIR]
//                   [--resources DIR] [--test-hooks] [--log-level error|warn|info|debug]
//   mfbe-core validate FILE... [--json] [--resources DIR]
//                       exit 0 = every file well-formed and valid (warnings allowed),
//                       1 = parse errors or validation errors, 2 = usage
//   mfbe-core roundtrip FILE --out DIR [--encoding utf-8] [--json] [--resources DIR]
//                       open -> save unchanged -> re-open -> structural comparison -> validate;
//                       exit 0 = identical and valid, 1 = identical but invalid,
//                       3 = structural differences, 4 = could not open, 2 = usage
//   mfbe-core convert-images FILE --out DIR|FILE2 [--format jpeg|png] [--quality N] [--json]
//                       open -> convert every non-JPEG/PNG image binary (same ids) -> write
//                       DIR/<name> (or FILE2 when --out names a file / ends with .fb2/.fbd);
//                       prints one line per converted binary; exit 0 ok, 4 could not open
//   mfbe-core --version | --help
// Exit codes (serve): 0 normal, 1 fatal error at start-up, 2 command-line error.
#include <mfbe/atomic_file.hpp>
#include <mfbe/binary_store.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/encodings.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/genres.hpp>
#include <mfbe/images.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/resources.hpp>
#include <mfbe/roundtrip.hpp>
#include <mfbe/validator.hpp>
#include <mfbe/version.hpp>

#include <CLI/CLI.hpp>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <exception>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <system_error>
#include <vector>

namespace {

constexpr int kExitOk = 0;
constexpr int kExitFatal = 1;
constexpr int kExitUsage = 2;

struct ServeArgs {
    int port = 0;
    std::string token;
    std::string ui;
    std::vector<std::string> open;
    std::string data_dir;
    std::string resources;
    bool test_hooks = false;
    std::string log_level = "error";
};

std::atomic<mfbe::CoreServer*> g_server{nullptr};
std::atomic<bool> g_terminate_requested{false};

int run_serve(const ServeArgs& args) {
    mfbe::log::set_console_level(args.log_level);
    // Install before any thread exists so the signal mask is inherited (POSIX sigwait model).
    mfbe::signals::install_termination_handler([] {
        g_terminate_requested = true;
        if (mfbe::CoreServer* s = g_server.load()) {
            s->stop();
        }
    });
    mfbe::CoreServerOptions options;
    options.port = args.port;
    options.token = args.token;
    options.ui_dir = args.ui;
    options.data_dir = args.data_dir;
    options.resources_dir = args.resources;
    options.test_hooks = args.test_hooks;
    options.open_paths = args.open;

    std::unique_ptr<mfbe::CoreServer> server;
    try {
        server = mfbe::CoreServer::start(options);
    } catch (const std::exception& e) {
        std::fprintf(stderr, "mfbe-core: cannot start: %s\n", e.what());
        return kExitFatal;
    }
    // Exactly one JSON line on stdout when ready.
    nlohmann::json ready{{"port", server->port()},
                         {"token", server->token()},
                         {"pid", mfbe::platform::current_pid()}};
    std::printf("%s\n", ready.dump().c_str());
    std::fflush(stdout);

    g_server.store(server.get());
    if (g_terminate_requested.load()) {
        server->stop();  // signal arrived while starting up
    }
    server->wait();
    g_server.store(nullptr);
    server.reset();
    mfbe::log::shutdown();
    return kExitOk;
}

// Points the validator at the resources root and installs the effective genre list (schema +
// bundled extension + per-user layers) so `genre.unknown` matches the editor's behaviour.
void apply_resources_override(const std::string& resources) {
    std::filesystem::path root = resources;
    if (!root.empty()) {
        mfbe::validation::set_schema_dir(root / "schema");
    } else {
        root = mfbe::validation::schema_dir().parent_path();
    }
    mfbe::resources::Roots roots;
    const mfbe::platform::Dirs dirs = mfbe::platform::resolve_dirs();
    roots.user_data = dirs.data;
    roots.portable = dirs.portable;
    roots.bundled_resources = root;
    const mfbe::resources::ResourceLayers layers(roots);
    mfbe::genres::install_genre_validator(std::make_shared<const mfbe::genres::GenreCatalog>(
        mfbe::genres::load_catalog(mfbe::validation::schema_genres(), root / "genres", layers)));
}

int run_convert_images(const std::string& file, const std::string& out, const std::string& format,
                       int quality, bool as_json) {
    mfbe::images::ConversionPolicy policy;
    policy.preferred =
        mfbe::images::format_from_string(format).value_or(mfbe::images::Format::jpeg);
    policy.jpeg_quality = quality;
    mfbe::BinaryStore store;
    mfbe::model::NodeIdAllocator ids;
    mfbe::fb2::ReadResult read;
    try {
        mfbe::fb2::ReadOptions options;
        options.compute_schema_hint = false;
        read = mfbe::fb2::read_file(file, store, ids, options);
    } catch (const mfbe::fb2::ParseFailure& e) {
        std::fprintf(stderr, "mfbe-core convert-images: %s:%d:%d: %s\n", file.c_str(), e.error.line,
                     e.error.column, e.error.message.c_str());
        return 4;
    } catch (const mfbe::fb2::IoFailure& e) {
        std::fprintf(stderr, "mfbe-core convert-images: %s: %s\n", e.path.c_str(),
                     e.reason.c_str());
        return 4;
    }
    const auto started = std::chrono::steady_clock::now();
    const mfbe::images::ConvertStoreResult result = mfbe::images::convert_store(store, policy);
    const auto convert_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                                std::chrono::steady_clock::now() - started)
                                .count();
    // --out names a directory unless it ends with a document extension or is an existing file.
    std::filesystem::path target(out);
    std::error_code ec;
    const std::string ext = target.extension().string();
    const bool is_file = std::filesystem::is_regular_file(target, ec) ||
                         ((ext == ".fb2" || ext == ".fbd" || ext == ".xml") &&
                          !std::filesystem::is_directory(target, ec));
    if (!is_file) {
        std::filesystem::create_directories(target, ec);
        target /= std::filesystem::path(file).filename();
    } else if (target.has_parent_path()) {
        std::filesystem::create_directories(target.parent_path(), ec);
    }
    mfbe::fb2::WriteOptions options;
    options.encoding =
        read.document.sourceEncoding.empty() ? "utf-8" : read.document.sourceEncoding;
    if (!mfbe::encoding::is_supported(options.encoding)) {
        options.encoding = "utf-8";
    }
    options.xlink_prefix = read.xlink_prefix;
    mfbe::update_reference_counts(read.document, store);
    const std::string text = mfbe::fb2::write_document(read.document, &store, options).text;
    try {
        mfbe::atomic_file::write_atomic(target, mfbe::fb2::encode_document(text, options.encoding));
    } catch (const mfbe::atomic_file::WriteError& e) {
        std::fprintf(stderr, "mfbe-core convert-images: cannot write %s: %s\n", e.path.c_str(),
                     e.reason.c_str());
        return kExitFatal;
    }
    if (as_json) {
        nlohmann::json converted = nlohmann::json::array();
        for (const auto& c : result.converted) {
            converted.push_back(
                {{"id", c.id}, {"from", c.from}, {"to", c.to}, {"size", c.meta.size}});
        }
        nlohmann::json j{{"path", file},
                         {"writtenPath", target.string()},
                         {"converted", converted},
                         {"failed", result.failed},
                         {"binaries", store.size()},
                         {"convertMs", convert_ms}};
        std::printf("%s\n", j.dump().c_str());
    } else {
        for (const auto& c : result.converted) {
            std::printf("%s: %s -> %s (%lld bytes)\n", c.id.c_str(), c.from.c_str(), c.to.c_str(),
                        static_cast<long long>(c.meta.size));
        }
        for (const auto& id : result.failed) {
            std::printf("%s: not decodable, kept unchanged\n", id.c_str());
        }
        std::printf("%s: %zu of %zu binaries converted in %lld ms -> %s\n", file.c_str(),
                    result.converted.size(), store.size(), static_cast<long long>(convert_ms),
                    target.string().c_str());
    }
    std::fflush(stdout);
    return kExitOk;
}

// Peak resident set size in bytes (Linux VmHWM; 0 elsewhere).
long long peak_rss_bytes() {
#ifdef __linux__
    std::ifstream status("/proc/self/status");
    std::string line;
    while (std::getline(status, line)) {
        if (line.rfind("VmHWM:", 0) == 0) {
            long long kb = 0;
            std::sscanf(line.c_str() + 6, "%lld", &kb);
            return kb * 1024;
        }
    }
#endif
    return 0;
}

std::string issue_line(const std::string& path, const mfbe::model::ValidationIssue& issue) {
    std::string out = path + ":" + std::to_string(issue.line.value_or(0)) + ":" +
                      std::to_string(issue.column.value_or(0)) + ": " +
                      (issue.severity == mfbe::model::Severity::error ? "error" : "warning") +
                      ": " + issue.code;
    for (const auto& [k, v] : issue.params) {
        out += " " + k + "=" + (v.is_string() ? v.get<std::string>() : v.dump());
    }
    return out;
}

int run_validate(const std::vector<std::string>& files, bool as_json,
                 const std::string& resources) {
    apply_resources_override(resources);
    std::string schema_error;
    if (!mfbe::validation::schema_ready(&schema_error)) {
        std::fprintf(stderr, "mfbe-core validate: %s\n", schema_error.c_str());
        return kExitFatal;
    }
    nlohmann::json results = nlohmann::json::array();
    bool any_errors = false;
    for (const auto& file : files) {
        nlohmann::json entry{{"path", file}};
        mfbe::BinaryStore store;
        mfbe::model::NodeIdAllocator ids;
        try {
            mfbe::fb2::ReadOptions options;
            options.compute_schema_hint = false;
            const mfbe::fb2::ReadResult read = mfbe::fb2::read_file(file, store, ids, options);
            mfbe::model::ValidationReport report =
                mfbe::validation::validate_document(read.document, &store, read.xlink_prefix);
            // Reader warnings (encoding mismatch, binary problems) belong to the report too,
            // unless the consistency checks already reported the same thing.
            for (const auto& w : read.warnings) {
                const bool duplicate =
                    std::any_of(report.issues.begin(), report.issues.end(),
                                [&](const mfbe::model::ValidationIssue& existing) {
                                    return existing.code == w.code && existing.params == w.params;
                                });
                if (!duplicate) {
                    report.issues.push_back(w);
                }
            }
            mfbe::validation::finalize_report(report);
            any_errors = any_errors || report.errorCount > 0;
            entry["wellFormed"] = true;
            entry["encoding"] = read.document.sourceEncoding;
            entry["report"] = mfbe::model::to_json(report);
            if (!as_json) {
                for (const auto& issue : report.issues) {
                    std::printf("%s\n", issue_line(file, issue).c_str());
                }
                std::printf("%s: %s (%d errors, %d warnings, %lld ms)\n", file.c_str(),
                            report.errorCount == 0 ? "valid" : "INVALID", report.errorCount,
                            report.warningCount, static_cast<long long>(report.durationMs));
            }
        } catch (const mfbe::fb2::ParseFailure& e) {
            any_errors = true;
            entry["wellFormed"] = false;
            entry["parseError"] = nlohmann::json{
                {"line", e.error.line}, {"column", e.error.column}, {"message", e.error.message}};
            if (!as_json) {
                std::printf("%s:%d:%d: error: xml.notWellFormed %s\n", file.c_str(), e.error.line,
                            e.error.column, e.error.message.c_str());
                std::printf("%s: NOT WELL-FORMED\n", file.c_str());
            }
        } catch (const mfbe::fb2::IoFailure& e) {
            any_errors = true;
            entry["wellFormed"] = false;
            entry["ioError"] = nlohmann::json{{"path", e.path}, {"reason", e.reason}};
            if (!as_json) {
                std::printf("%s: cannot read: %s\n", file.c_str(), e.reason.c_str());
            }
        }
        results.push_back(std::move(entry));
    }
    if (as_json) {
        std::printf("%s\n",
                    results.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace).c_str());
    }
    std::fflush(stdout);
    return any_errors ? kExitFatal : kExitOk;
}

int run_roundtrip(const std::string& file, const std::string& out_dir, const std::string& encoding,
                  bool as_json, const std::string& resources) {
    apply_resources_override(resources);
    const auto canonical = mfbe::encoding::normalize_name(encoding);
    if (!canonical || !mfbe::encoding::is_supported(*canonical)) {
        std::fprintf(stderr, "mfbe-core roundtrip: unsupported encoding '%s'\n", encoding.c_str());
        return kExitUsage;
    }
    const mfbe::roundtrip::Report report = mfbe::roundtrip::run(file, out_dir, *canonical);
    if (as_json) {
        nlohmann::json j = report.to_json();
        j["peakRssBytes"] = peak_rss_bytes();
        std::printf("%s\n",
                    j.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace).c_str());
    } else {
        std::printf("%s", report.summary().c_str());
        std::printf("  peak RSS: %lld bytes\n", peak_rss_bytes());
    }
    std::fflush(stdout);
    return report.exit_code();
}

// CLI11 reports unexpected arguments as "The following argument was not expected: X";
// extract X so the message matches the contract.
std::string first_unexpected(const std::string& what) {
    const std::string marker = "not expected: ";
    const auto pos = what.find(marker);
    if (pos == std::string::npos) {
        return "";
    }
    std::string rest = what.substr(pos + marker.size());
    const auto nl = rest.find('\n');
    if (nl != std::string::npos) {
        rest = rest.substr(0, nl);
    }
    const auto space = rest.find(' ');
    if (space != std::string::npos) {
        rest = rest.substr(0, space);
    }
    return rest;
}

}  // namespace

int main(int argc, char** argv) {
    CLI::App app{"Maxima Fiction Book Editor - headless core", "mfbe-core"};
    app.set_version_flag("--version", std::string("mfbe-core ") + mfbe::version::kVersion + " (" +
                                          mfbe::version::kBuildId + ")");
    app.require_subcommand(0, 1);
    app.set_help_all_flag("--help-all", "Show help for every command");

    ServeArgs serve_args;
    CLI::App* serve = app.add_subcommand("serve", "Run the loopback JSON-RPC server");
    serve->add_option("--port", serve_args.port, "listen port (default: OS-assigned)")
        ->check(CLI::Range(0, 65535));
    serve->add_option("--token", serve_args.token, "session token (default: generated)");
    serve->add_option("--ui", serve_args.ui, "serve the built UI bundle from <dir>")
        ->check(CLI::ExistingDirectory);
    serve->add_option("--open", serve_args.open, "pre-open a document")->allow_extra_args(false);
    serve->add_option("--data-dir", serve_args.data_dir, "override per-user data/config root");
    serve->add_option("--resources", serve_args.resources, "override bundled resources root")
        ->check(CLI::ExistingDirectory);
    serve->add_flag("--test-hooks", serve_args.test_hooks,
                    "enable test.* RPC methods and the queued dialog provider");
    serve->add_option("--log-level", serve_args.log_level, "console log level")
        ->check(CLI::IsMember({"error", "warn", "info", "debug"}))
        ->default_val("error");

    std::vector<std::string> validate_files;
    std::string validate_resources;
    CLI::App* validate = app.add_subcommand("validate", "Validate FB2 files (prints a report)");
    validate->add_option("files", validate_files, "FB2 files")->required();
    bool validate_json = false;
    validate->add_flag("--json", validate_json, "JSON output");
    validate->add_option("--resources", validate_resources, "override bundled resources root")
        ->check(CLI::ExistingDirectory);

    std::string roundtrip_file;
    std::string roundtrip_out;
    std::string roundtrip_encoding = "utf-8";
    std::string roundtrip_resources;
    bool roundtrip_json = false;
    CLI::App* roundtrip = app.add_subcommand("roundtrip", "Open + save without edits");
    roundtrip->add_option("file", roundtrip_file, "FB2 file")->required();
    roundtrip->add_option("--out", roundtrip_out, "output directory")->required();
    roundtrip->add_option("--encoding", roundtrip_encoding, "output encoding (default utf-8)");
    roundtrip->add_flag("--json", roundtrip_json, "JSON output (one object)");
    roundtrip->add_option("--resources", roundtrip_resources, "override bundled resources root")
        ->check(CLI::ExistingDirectory);

    std::string convert_file;
    std::string convert_out;
    std::string convert_format = "jpeg";
    int convert_quality = 90;
    bool convert_json = false;
    CLI::App* convert = app.add_subcommand("convert-images", "Convert images to JPEG/PNG");
    convert->add_option("file", convert_file, "FB2 file")->required();
    convert->add_option("--out", convert_out, "output directory (or output file)")->required();
    convert->add_option("--format", convert_format, "jpeg|png (default jpeg)")
        ->check(CLI::IsMember({"jpeg", "png"}));
    convert->add_option("--quality", convert_quality, "JPEG quality 1..100 (default 90)")
        ->check(CLI::Range(1, 100));
    convert->add_flag("--json", convert_json, "JSON output (one object)");

    try {
        app.parse(argc, argv);
    } catch (const CLI::CallForHelp& e) {
        return app.exit(e);
    } catch (const CLI::CallForAllHelp& e) {
        return app.exit(e);
    } catch (const CLI::CallForVersion& e) {
        return app.exit(e);
    } catch (const CLI::ExtrasError& e) {
        const std::string opt = first_unexpected(e.what());
        std::fprintf(stderr, "Invalid command line option: '%s'\n", opt.c_str());
        return kExitUsage;
    } catch (const CLI::ParseError& e) {
        std::fprintf(stderr, "%s\n", e.what());
        std::fprintf(stderr, "Run with --help for usage.\n");
        return kExitUsage;
    }

    if (*serve) {
        return run_serve(serve_args);
    }
    if (*validate) {
        return run_validate(validate_files, validate_json, validate_resources);
    }
    if (*roundtrip) {
        return run_roundtrip(roundtrip_file, roundtrip_out, roundtrip_encoding, roundtrip_json,
                             roundtrip_resources);
    }
    if (*convert) {
        return run_convert_images(convert_file, convert_out, convert_format, convert_quality,
                                  convert_json);
    }
    std::fprintf(stderr, "%s", app.help().c_str());
    return kExitUsage;
}
