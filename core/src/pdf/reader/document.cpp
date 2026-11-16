// Feature 016 (DP-5, contracts/page-model.md; tasks T016): document.json - metadata, the editor's
// record, encryption. Outline, links and forms come with the rest of T016.
#include "pdf/reader/reader.hpp"

#include <nlohmann/json.hpp>

#include <Catalog.h>
#include <GlobalParams.h>
#include <PDFDoc.h>
#include <fstream>
#include <regex>

namespace mfbe::pdf_reader {

namespace {

std::string xmp_value(const std::string& xmp, const std::string& name) {
    const std::regex re("<" + name + ">([\\s\\S]*?)</" + name + ">");
    std::smatch m;
    return std::regex_search(xmp, m, re) ? m[1].str() : std::string();
}

}  // namespace

bool write_document(PDFDoc& doc, const Options& options, std::string& error) {
    nlohmann::json out{{"v", 1},
                       {"pages", doc.getNumPages()},
                       {"version", std::to_string(doc.getPDFMajorVersion()) + "." +
                                       std::to_string(doc.getPDFMinorVersion())},
                       {"encrypted", doc.isEncrypted()},
                       {"copyAllowed", doc.okToCopy()}};
    std::string xmp;
    if (Catalog* catalog = doc.getCatalog()) {
        if (auto metadata = catalog->readMetadata()) {
            xmp = metadata->toStr();
        }
    }
    out["metadata"] = {{"xmp", xmp}};
    const std::string version = xmp_value(xmp, "mfbe:recordVersion");
    if (!version.empty()) {
        out["record"] = {{"version", std::atoi(version.c_str())},
                         {"description", xmp_value(xmp, "mfbe:fb2Description")},
                         {"hints", xmp_value(xmp, "mfbe:fb2Hints")}};
    }
    std::ofstream file(options.out / "document.json");
    if (!file) {
        error = "ioError";
        return false;
    }
    file << out.dump();
    return true;
}

}  // namespace mfbe::pdf_reader
