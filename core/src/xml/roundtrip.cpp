// Structural document comparison and the round-trip procedure (T046). See mfbe/roundtrip.hpp.
#include <mfbe/atomic_file.hpp>
#include <mfbe/document_details.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/image_probe.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/roundtrip.hpp>
#include <mfbe/utf8_paths.hpp>
#include <mfbe/validator.hpp>

#include <algorithm>
#include <chrono>
#include <map>
#include <sstream>

namespace mfbe::roundtrip {
namespace {

using model::Node;
using nlohmann::json;

/* ----------------------------------------------------------------------------------------- */
/* Normalisation                                                                             */
/* ----------------------------------------------------------------------------------------- */

bool person_empty(const model::Person& p) {
    return !p.firstName && !p.middleName && !p.lastName && !p.nickname && p.homePages.empty() &&
           p.emails.empty() && !p.id;
}

void drop_empty_persons(std::vector<model::Person>& list) {
    list.erase(std::remove_if(list.begin(), list.end(), person_empty), list.end());
}

void normalise_annotation(std::optional<Node>& node) {
    if (node && node->content.empty() && !node->attrs.count("id") && !node->attrs.count("lang")) {
        node.reset();
    }
}

void normalise_title_info(model::TitleInfo& info) {
    drop_empty_persons(info.authors);
    drop_empty_persons(info.translators);
    normalise_annotation(info.annotation);
    for (auto& g : info.genres) {
        if (g.match == 100) {
            g.match.reset();
        }
    }
    if (info.keywords && info.keywords->empty()) {
        info.keywords.reset();
    }
    if (info.srcLang && info.srcLang->empty()) {
        info.srcLang.reset();
    }
    if (info.date && info.date->text.empty() && (!info.date->value || info.date->value->empty()) &&
        (!info.date->lang || info.date->lang->empty())) {
        info.date.reset();
    }
}

void normalise_description(model::Description& d) {
    normalise_title_info(d.titleInfo);
    if (d.srcTitleInfo) {
        normalise_title_info(*d.srcTitleInfo);
    }
    drop_empty_persons(d.documentInfo.authors);
    drop_empty_persons(d.documentInfo.publishers);
    normalise_annotation(d.documentInfo.history);
    const auto clear_empty = [](std::optional<std::string>& s) {
        if (s && s->empty()) {
            s.reset();
        }
    };
    clear_empty(d.documentInfo.programUsed);
    clear_empty(d.documentInfo.srcOcr);
    if (d.publishInfo) {
        auto& p = *d.publishInfo;
        clear_empty(p.bookName);
        clear_empty(p.publisher);
        clear_empty(p.city);
        clear_empty(p.year);
        clear_empty(p.isbn);
        if (!p.bookName && !p.publisher && !p.city && !p.year && !p.isbn && p.sequences.empty()) {
            d.publishInfo.reset();
        }
    }
}

// JSON of a description part without nodeIds (for readable diffs).
void strip_node_ids(json& j) {
    if (j.is_object()) {
        j.erase("nodeId");
        for (auto& [k, v] : j.items()) {
            strip_node_ids(v);
        }
    } else if (j.is_array()) {
        for (auto& v : j) {
            strip_node_ids(v);
        }
    }
}

// Cuts at a UTF-8 character boundary so the excerpt stays valid text.
std::string excerpt(const std::string& text, std::size_t max = 60) {
    if (text.size() <= max) {
        return text;
    }
    std::size_t cut = max - 3;
    while (cut > 0 && (static_cast<unsigned char>(text[cut]) & 0xC0) == 0x80) {
        --cut;
    }
    return text.substr(0, cut) + "...";
}

void diff_json(const json& a, const json& b, const std::string& where, Comparison& out,
               std::size_t max) {
    if (out.differences.size() >= max) {
        out.truncated = true;
        return;
    }
    if (a.type() != b.type()) {
        out.differences.push_back(
            {where, "type differs: " + std::string(a.type_name()) + " vs " + b.type_name()});
        return;
    }
    if (a.is_object()) {
        for (const auto& [k, v] : a.items()) {
            if (!b.contains(k)) {
                out.differences.push_back({where + "/" + k, "missing after round trip"});
                continue;
            }
            diff_json(v, b[k], where + "/" + k, out, max);
        }
        for (const auto& [k, v] : b.items()) {
            if (!a.contains(k)) {
                out.differences.push_back({where + "/" + k, "appeared after round trip"});
            }
        }
        return;
    }
    if (a.is_array()) {
        if (a.size() != b.size()) {
            out.differences.push_back({where, "count differs: " + std::to_string(a.size()) +
                                                  " vs " + std::to_string(b.size())});
            return;
        }
        for (std::size_t i = 0; i < a.size(); ++i) {
            diff_json(a[i], b[i], where + "[" + std::to_string(i + 1) + "]", out, max);
        }
        return;
    }
    if (a != b) {
        const std::string av =
            a.is_string() ? "\"" + excerpt(a.get<std::string>(), 70) + "\"" : a.dump();
        const std::string bv =
            b.is_string() ? "\"" + excerpt(b.get<std::string>(), 70) + "\"" : b.dump();
        out.differences.push_back({where, av + " vs " + bv});
    }
}

/* ----------------------------------------------------------------------------------------- */
/* Body tree                                                                                 */
/* ----------------------------------------------------------------------------------------- */

std::map<std::string, json> attrs_without_node_id(const Node& n) {
    std::map<std::string, json> attrs = n.attrs;
    attrs.erase("nodeId");
    return attrs;
}

std::vector<model::Mark> sorted_marks(const std::vector<model::Mark>& marks) {
    std::vector<model::Mark> sorted = marks;
    std::sort(sorted.begin(), sorted.end(), [](const model::Mark& a, const model::Mark& b) {
        if (a.type != b.type) {
            return a.type < b.type;
        }
        return a.attrs.dump() < b.attrs.dump();
    });
    return sorted;
}

void compare_nodes(const Node& a, const Node& b, const std::string& where, Comparison& out,
                   std::size_t max) {
    if (out.differences.size() >= max) {
        out.truncated = true;
        return;
    }
    ++out.nodes_compared;
    if (a.type != b.type) {
        out.differences.push_back({where, "node type " + a.type + " became " + b.type});
        return;
    }
    if (a.is_text()) {
        if (a.text != b.text) {
            out.differences.push_back(
                {where, "text \"" + excerpt(a.text) + "\" became \"" + excerpt(b.text) + "\""});
        }
        if (sorted_marks(a.marks) != sorted_marks(b.marks)) {
            out.differences.push_back({where, "marks differ"});
        }
        return;
    }
    const auto aa = attrs_without_node_id(a);
    const auto ba = attrs_without_node_id(b);
    if (aa != ba) {
        std::string detail;
        for (const auto& [k, v] : aa) {
            auto it = ba.find(k);
            if (it == ba.end()) {
                detail += " -" + k;
            } else if (it->second != v) {
                detail += " ~" + k;
            }
        }
        for (const auto& [k, v] : ba) {
            if (!aa.count(k)) {
                detail += " +" + k;
            }
        }
        out.differences.push_back({where, "attributes differ:" + detail});
    }
    if (a.content.size() != b.content.size()) {
        out.differences.push_back({where, "child count " + std::to_string(a.content.size()) +
                                              " became " + std::to_string(b.content.size())});
        return;
    }
    std::map<std::string, std::size_t> counters;
    for (std::size_t i = 0; i < a.content.size(); ++i) {
        const Node& child = a.content[i];
        std::string child_where;
        if (child.is_text()) {
            child_where = where + "/text()[" + std::to_string(i + 1) + "]";
        } else {
            const std::size_t index = ++counters[child.type];
            child_where = where + "/" + child.type + "[" + std::to_string(index) + "]";
        }
        compare_nodes(child, b.content[i], child_where, out, max);
    }
}

std::map<std::string, std::vector<std::string>> extras_by_slot(const model::Document& d) {
    std::map<std::string, std::vector<std::string>> out;
    for (const Node& n : d.extras) {
        out[n.attr_string("slot").value_or("FictionBook")].push_back(
            n.attr_string("xml").value_or(""));
    }
    return out;
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* compare()                                                                                 */
/* ----------------------------------------------------------------------------------------- */

Comparison compare(const model::Document& a, const BinaryStore& store_a, const model::Document& b,
                   const BinaryStore& store_b, std::size_t max) {
    Comparison out;

    // Description: compare the normalised JSON forms field by field.
    model::Description da = a.description;
    model::Description db = b.description;
    normalise_description(da);
    normalise_description(db);
    // The document details the editor fills in on load (feature 002, constitution principle
    // IV) are not compared.
    for (model::DocumentInfo* info : {&da.documentInfo, &db.documentInfo}) {
        info->id.clear();
        info->version.clear();
        info->programUsed.reset();
        info->date.text.clear();
        info->date.value.reset();
    }
    json ja = model::to_json(da);
    json jb = model::to_json(db);
    strip_node_ids(ja);
    strip_node_ids(jb);
    diff_json(ja, jb, "description", out, max);

    if (a.stylesheets != b.stylesheets) {
        out.differences.push_back({"stylesheets", "stylesheets differ"});
    }

    if (a.bodies.size() != b.bodies.size()) {
        out.differences.push_back({"bodies", "body count " + std::to_string(a.bodies.size()) +
                                                 " became " + std::to_string(b.bodies.size())});
    } else {
        for (std::size_t i = 0; i < a.bodies.size(); ++i) {
            compare_nodes(a.bodies[i], b.bodies[i], "body[" + std::to_string(i + 1) + "]", out,
                          max);
        }
    }

    const auto ea = extras_by_slot(a);
    const auto eb = extras_by_slot(b);
    if (ea != eb) {
        out.differences.push_back({"extras", "preserved unknown XML differs"});
    }

    const auto ids_a = store_a.ids();
    const auto ids_b = store_b.ids();
    if (ids_a != ids_b) {
        out.differences.push_back({"binaries", "binary ids/order differ (" +
                                                   std::to_string(ids_a.size()) + " vs " +
                                                   std::to_string(ids_b.size()) + ")"});
    } else {
        for (const auto& id : ids_a) {
            ++out.binaries_compared;
            const auto ma = store_a.meta(id);
            const auto mb = store_b.meta(id);
            if (!ma || !mb) {
                continue;
            }
            if (ma->contentType != mb->contentType) {
                out.differences.push_back({"binary[" + id + "]", "content type differs"});
            }
            if (store_a.is_raw_text(id) != store_b.is_raw_text(id)) {
                out.differences.push_back({"binary[" + id + "]", "raw/decoded state differs"});
            }
            if (store_a.bytes(id) != store_b.bytes(id)) {
                out.differences.push_back({"binary[" + id + "]", "bytes differ"});
            }
            if (out.differences.size() >= max) {
                out.truncated = true;
                break;
            }
        }
    }
    return out;
}

/* ----------------------------------------------------------------------------------------- */
/* run()                                                                                     */
/* ----------------------------------------------------------------------------------------- */

namespace {

std::int64_t ms_since(std::chrono::steady_clock::time_point t0) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() -
                                                                 t0)
        .count();
}

}  // namespace

Report run(const std::filesystem::path& input, const std::filesystem::path& out_dir,
           const std::string& encoding, const images::ConversionPolicy& policy) {
    const auto started = std::chrono::steady_clock::now();
    Report report;
    report.path = platform::utf8_from_path(input);
    report.output_encoding = encoding;

    BinaryStore store_a;
    model::NodeIdAllocator ids_a;
    fb2::ReadResult first;
    try {
        const auto t0 = std::chrono::steady_clock::now();
        first = fb2::read_file(input, store_a, ids_a);
        report.open_ms = ms_since(t0);
    } catch (const fb2::ParseFailure& e) {
        report.failure = e.error.message;
        report.failure_line = e.error.line;
        report.failure_column = e.error.column;
        report.total_ms = ms_since(started);
        return report;
    } catch (const fb2::IoFailure& e) {
        report.failure = e.reason;
        report.total_ms = ms_since(started);
        return report;
    }
    report.opened = true;
    std::error_code ec;
    report.input_bytes = static_cast<std::int64_t>(std::filesystem::file_size(input, ec));
    report.input_encoding = first.document.sourceEncoding;
    report.input_schema_hint = model::to_string(first.document.schemaHint);
    for (const auto& w : first.warnings) {
        report.warnings.push_back(w.code);
    }

    // Convert non-JPEG/PNG images in place exactly as doc.save does (FR-110); the comparison
    // below then sees the converted bytes on both sides.
    const auto t1 = std::chrono::steady_clock::now();
    const images::ConvertStoreResult conversion = images::convert_store(store_a, policy);
    for (const images::Converted& c : conversion.converted) {
        report.converted_ids.push_back(c.id);
    }
    report.convert_ms = ms_since(t1);

    // Write.
    fb2::WriteOptions options;
    options.encoding = encoding;
    options.xlink_prefix = first.xlink_prefix;
    // Open and save as the editor does: the document details filled in on load are written.
    model::Document edited = first.document;
    model::fill_in_document_details(edited, model::details_context_now(false));
    const fb2::WriteResult written = fb2::write_document(edited, &store_a, options);
    const std::string bytes = fb2::encode_document(written.text, options.encoding);
    std::filesystem::create_directories(out_dir, ec);
    const std::filesystem::path out_path = out_dir / input.filename();
    try {
        atomic_file::write_atomic(out_path, bytes);
    } catch (const atomic_file::WriteError& e) {
        report.failure = "cannot write " + platform::utf8_from_path(out_path) + ": " + e.reason;
        report.total_ms = ms_since(started);
        return report;
    }
    report.written_path = platform::utf8_from_path(out_path);
    report.output_bytes = static_cast<std::int64_t>(bytes.size());
    report.write_ms = ms_since(t1);

    // Re-open and compare.
    BinaryStore store_b;
    model::NodeIdAllocator ids_b;
    fb2::ReadResult second;
    try {
        const auto t2 = std::chrono::steady_clock::now();
        fb2::ReadOptions ro;
        ro.compute_schema_hint = false;
        second = fb2::read_file(out_path, store_b, ids_b, ro);
        report.reopen_ms = ms_since(t2);
    } catch (const fb2::ParseFailure& e) {
        report.failure = "written file is not well-formed: " + e.error.message;
        report.failure_line = e.error.line;
        report.failure_column = e.error.column;
        report.total_ms = ms_since(started);
        return report;
    } catch (const fb2::IoFailure& e) {
        report.failure = e.reason;
        report.total_ms = ms_since(started);
        return report;
    }
    report.reopened = true;
    report.comparison = compare(first.document, store_a, second.document, store_b);
    report.identical = report.comparison.identical();

    // Validate the written document (model-based: schema + consistency).
    const auto t3 = std::chrono::steady_clock::now();
    report.validation =
        validation::validate_document(second.document, &store_b, second.xlink_prefix);
    report.validate_ms = ms_since(t3);
    report.valid = report.validation.errorCount == 0;

    for (const auto& meta : store_b.list()) {
        ++report.binary_count;
        const std::string sniffed = store_b.sniffed_type(meta.id);
        if (store_b.is_raw_text(meta.id) || !meta.decodable) {
            report.undecodable_ids.push_back(meta.id);
        } else if (!images::is_jpeg_or_png(sniffed)) {
            report.non_jpeg_png_ids.push_back(meta.id);
        }
    }
    report.total_ms = ms_since(started);
    return report;
}

int Report::exit_code() const {
    if (!opened || !reopened) {
        return 4;
    }
    if (!identical) {
        return 3;
    }
    return valid ? 0 : 1;
}

json Report::to_json(std::size_t max_issues) const {
    json j;
    j["path"] = path;
    j["opened"] = opened;
    j["reopened"] = reopened;
    j["identical"] = identical;
    j["valid"] = valid;
    j["exitCode"] = exit_code();
    if (failure) {
        json f{{"message", *failure}};
        if (failure_line) {
            f["line"] = *failure_line;
        }
        if (failure_column) {
            f["column"] = *failure_column;
        }
        j["failure"] = f;
    }
    if (written_path) {
        j["writtenPath"] = *written_path;
    }
    j["inputEncoding"] = input_encoding;
    j["outputEncoding"] = output_encoding;
    j["inputSchemaHint"] = input_schema_hint;
    j["warnings"] = warnings;
    json diffs = json::array();
    for (const auto& d : comparison.differences) {
        diffs.push_back(d.where + ": " + d.what);
    }
    j["differences"] = diffs;
    j["differencesTruncated"] = comparison.truncated;
    j["nodesCompared"] = comparison.nodes_compared;
    json v;
    v["errorCount"] = validation.errorCount;
    v["warningCount"] = validation.warningCount;
    v["durationMs"] = validation.durationMs;
    json issues = json::array();
    for (const auto& issue : validation.issues) {
        if (issues.size() >= max_issues) {
            break;
        }
        issues.push_back(model::to_json(issue));
    }
    v["issues"] = issues;
    j["validation"] = v;
    j["binaries"] = json{{"count", binary_count},
                         {"converted", converted_ids.size()},
                         {"convertedIds", converted_ids},
                         {"nonJpegPng", non_jpeg_png_ids.size()},
                         {"nonJpegPngIds", non_jpeg_png_ids},
                         {"undecodable", undecodable_ids.size()},
                         {"undecodableIds", undecodable_ids}};
    j["bytes"] = json{{"input", input_bytes}, {"output", output_bytes}};
    j["timingsMs"] = json{{"open", open_ms},     {"convert", convert_ms},   {"write", write_ms},
                          {"reopen", reopen_ms}, {"validate", validate_ms}, {"total", total_ms}};
    return j;
}

std::string Report::summary(std::size_t max_issues) const {
    std::ostringstream out;
    out << path << "\n";
    if (!opened) {
        out << "  open failed: " << failure.value_or("unknown error");
        if (failure_line) {
            out << " (line " << *failure_line << ", column " << failure_column.value_or(0) << ")";
        }
        out << "\n";
        return out.str();
    }
    out << "  opened: " << input_bytes << " bytes, " << input_encoding << ", schema hint "
        << input_schema_hint << ", " << binary_count << " binaries, " << open_ms << " ms\n";
    if (!warnings.empty()) {
        out << "  warnings:";
        for (const auto& w : warnings) {
            out << " " << w;
        }
        out << "\n";
    }
    if (written_path) {
        out << "  written: " << *written_path << " (" << output_bytes << " bytes, "
            << output_encoding << ", " << write_ms << " ms)\n";
    }
    if (!reopened) {
        out << "  re-open failed: " << failure.value_or("unknown error") << "\n";
        return out.str();
    }
    out << "  structural comparison: " << (identical ? "identical" : "DIFFERENT") << " ("
        << comparison.nodes_compared << " nodes, " << comparison.binaries_compared << " binaries";
    if (!identical) {
        out << ", " << comparison.differences.size() << (comparison.truncated ? "+" : "")
            << " differences";
    }
    out << ")\n";
    for (const auto& d : comparison.differences) {
        out << "    " << d.where << ": " << d.what << "\n";
    }
    out << "  validation: " << (valid ? "valid" : "INVALID") << " (" << validation.errorCount
        << " errors, " << validation.warningCount << " warnings, " << validate_ms << " ms)\n";
    std::size_t shown = 0;
    for (const auto& issue : validation.issues) {
        if (shown++ >= max_issues) {
            out << "    ...\n";
            break;
        }
        out << "    " << (issue.severity == model::Severity::error ? "error" : "warning");
        if (issue.line) {
            out << " line " << *issue.line;
        }
        out << ": " << issue.code;
        for (const auto& [k, v] : issue.params) {
            out << " " << k << "=" << (v.is_string() ? v.get<std::string>() : v.dump());
        }
        out << "\n";
    }
    if (!converted_ids.empty()) {
        out << "  image binaries converted to JPEG/PNG: " << converted_ids.size() << " ("
            << convert_ms << " ms)\n";
    }
    if (!non_jpeg_png_ids.empty()) {
        out << "  image binaries not JPEG/PNG after save: " << non_jpeg_png_ids.size() << "\n";
    }
    out << "  total: " << total_ms << " ms\n";
    return out.str();
}

}  // namespace mfbe::roundtrip
