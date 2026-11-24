// Feature 020 (contracts/resource-formats.md, data-model.md §2): OCR language pack discovery,
// Tesseract code <-> FB2 ISO language / script mapping, and binary header validation.
#pragma once

#include <mfbe/resources.hpp>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::ocr {

struct LanguageInfo {
    std::string fb2_lang;
    std::string script;
};

struct LanguagePack {
    std::string code;
    std::string fb2_lang;
    std::string script;
    resources::LayerName layer = resources::LayerName::bundled;
    std::filesystem::path path;
    std::uint64_t size_bytes = 0;
    bool overrides_bundled = false;
    bool bundled = false;
};

struct PassedOver {
    resources::LayerName layer = resources::LayerName::user;
    std::filesystem::path path;
    std::string reason;
};

struct CatalogReport {
    std::vector<LanguagePack> packs;
    bool osd_available = false;
    std::optional<resources::LayerName> osd_layer;
    std::filesystem::path osd_path;
    std::filesystem::path active_folder;
    std::string custom_folder;
    std::optional<std::string> custom_folder_issue;  // "missing" | "unreadable"
    std::vector<PassedOver> passed_over;
};

// True for valid .traineddata file stems matching ^[A-Za-z0-9_.-]{2,32}$ without path traversal.
bool is_valid_traineddata_stem(std::string_view stem);

// True for valid user-selectable OCR language pack codes (same rule, excluding internal "osd").
bool is_valid_pack_code(std::string_view code);

// Maps a Tesseract pack code (e.g. "eng", "rus", "ukr", "deu", "rus_old", custom) to its FB2
// BCP-47/ISO language code and primary script family.
LanguageInfo language_info_for_code(std::string_view code);

// Normalizes Tesseract OSD script names ("Latin", "Cyrillic", "Han", ...) to our script families.
std::string normalize_osd_script(std::string_view osd_script);

// Checks a .traineddata file's size and TessdataManager binary header.
// Returns "" if valid, otherwise "unreadable", "empty", or "corrupt".
std::string validate_traineddata_file(const std::filesystem::path& path);

// Rebuilds the layered OCR catalog fresh from disk (settings > user > portable > bundled).
CatalogReport build_catalog(const resources::ResourceLayers& layers,
                            const std::string& custom_folder_utf8);

// Ordered list of existing, readable OCR directories in descending priority order
// (settings > user > portable > bundled) for passing as repeated --ocr-dir flags.
std::vector<std::filesystem::path> active_ocr_dirs(const resources::ResourceLayers& layers);

nlohmann::json to_json(const LanguagePack& pack);
nlohmann::json to_json(const PassedOver& item);
nlohmann::json to_json(const CatalogReport& report);

}  // namespace mfbe::ocr
