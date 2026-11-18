// Feature 017 (specs/017-txt-export-import/contracts/rpc-api.md): the TXT export's and import's
// methods. txt.encodings answers the encodings and the lists of English, Russian and Ukrainian
// books (D11, DP-2) - the one source the export dialog, the settings and the tests read.

#include "server/services.hpp"

#include <mfbe/rpc.hpp>
#include <mfbe/single_byte.hpp>

#include <string>
#include <vector>

namespace mfbe::server {
namespace {

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

}  // namespace

void register_txt_handlers(rpc::RpcRouter& router, Services& /*services*/) {
    router.add_method("txt.encodings",
                      [](const json&, rpc::RpcContext&) { return encodings_answer(); });
}

}  // namespace mfbe::server
