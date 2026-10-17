// Document details filled in on load (feature 002). See mfbe/document_details.hpp.
#include <mfbe/document_details.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/version.hpp>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <ctime>

namespace mfbe::model {

DetailsContext details_context_now(bool is_new, std::string_view ui_language) {
    const std::time_t now = std::time(nullptr);
    std::tm tm{};
#ifdef _WIN32
    localtime_s(&tm, &now);
#else
    localtime_r(&now, &tm);
#endif
    DetailsContext context;
    context.program = std::string(version::kProductName) + " " + version::kVersion;
    context.year = tm.tm_year + 1900;
    context.month = tm.tm_mon + 1;
    context.day = tm.tm_mday;
    context.is_new = is_new;
    context.ui_language = ui_language == "system" || ui_language.empty()
                              ? platform::system_language()
                              : std::string(ui_language);
    context.new_id = [] {
        std::string id = uuid::generate_v4();
        std::transform(id.begin(), id.end(), id.begin(),
                       [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
        return id;
    };
    return context;
}

std::vector<std::string> fill_in_document_details(Document& doc, const DetailsContext& context) {
    std::vector<std::string> filled;
    DocumentInfo& info = doc.description.documentInfo;
    if ((context.is_new || info.id.empty()) && context.new_id) {
        info.id = context.new_id();
        filled.emplace_back("documentInfo.id");
    }
    if (info.version.empty()) {
        info.version = "1.0";
        filled.emplace_back("documentInfo.version");
    }
    if (!info.programUsed || info.programUsed->empty()) {
        info.programUsed = context.program;
        filled.emplace_back("documentInfo.programUsed");
    } else if (info.programUsed->find(version::kProductName) == std::string::npos) {
        *info.programUsed += ", " + context.program;
        filled.emplace_back("documentInfo.programUsed");
    }
    const int month = std::clamp(context.month, 1, 12);
    if (info.date.text.empty()) {
        info.date.text =
            platform::format_long_date(context.year, month, context.day, context.ui_language);
        filled.emplace_back("documentInfo.date.text");
    }
    if (!info.date.value || info.date.value->empty()) {
        char value[16];
        std::snprintf(value, sizeof(value), "%04d-%02d-%02d", context.year, month, context.day);
        info.date.value = value;
        filled.emplace_back("documentInfo.date.value");
    }
    return filled;
}

}  // namespace mfbe::model
