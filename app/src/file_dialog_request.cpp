#include "file_dialog_request.h"

#include <mfbe/utf8_paths.hpp>

#include <cctype>
#include <filesystem>

namespace mfbe::shell {

namespace {

bool isAsciiLetter(char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

char lower(char c) {
    return static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
}

char upper(char c) {
    return static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
}

const FileFilter* selectedFilter(const FileDialogRequest& request) {
    if (request.filters.empty()) {
        return nullptr;
    }
    return &request.filters[selectedFilterIndex(request)];
}

}  // namespace

std::size_t selectedFilterIndex(const FileDialogRequest& request) {
    if (request.selected_filter < 0 ||
        static_cast<std::size_t>(request.selected_filter) >= request.filters.size()) {
        return 0;
    }
    return static_cast<std::size_t>(request.selected_filter);
}

std::string bareExtension(const std::string& extension) {
    std::string bare = extension;
    if (bare.rfind("*.", 0) == 0) {
        bare.erase(0, 2);
    } else if (bare.rfind('.', 0) == 0) {
        bare.erase(0, 1);
    }
    return bare.empty() ? "*" : bare;
}

bool listsAllFiles(const FileFilter& filter) {
    if (filter.extensions.empty()) {
        return true;
    }
    for (const auto& extension : filter.extensions) {
        if (bareExtension(extension) == "*") {
            return true;
        }
    }
    return false;
}

std::string windowsFilterSpec(const FileFilter& filter) {
    if (listsAllFiles(filter)) {
        return "*.*";
    }
    std::string spec;
    for (const auto& extension : filter.extensions) {
        if (!spec.empty()) {
            spec += ';';
        }
        spec += "*." + bareExtension(extension);
    }
    return spec;
}

unsigned windowsFileTypeIndex(const FileDialogRequest& request) {
    return static_cast<unsigned>(selectedFilterIndex(request)) + 1;
}

std::string defaultExtension(const FileDialogRequest& request) {
    const FileFilter* filter = selectedFilter(request);
    if (request.mode != FileDialogMode::kSave || filter == nullptr || listsAllFiles(*filter)) {
        return {};
    }
    return bareExtension(filter->extensions.front());
}

std::string gtkPattern(const std::string& extension) {
    const std::string bare = bareExtension(extension);
    if (bare == "*") {
        return "*";
    }
    std::string pattern = "*.";
    for (const char c : bare) {
        if (isAsciiLetter(c)) {
            pattern += '[';
            pattern += lower(c);
            pattern += upper(c);
            pattern += ']';
        } else {
            pattern += c;
        }
    }
    return pattern;
}

std::vector<std::string> gtkPatterns(const FileFilter& filter) {
    if (listsAllFiles(filter)) {
        return {"*"};
    }
    std::vector<std::string> patterns;
    for (const auto& extension : filter.extensions) {
        patterns.push_back(gtkPattern(extension));
    }
    return patterns;
}

std::vector<std::string> macExtensions(const FileFilter& filter) {
    std::vector<std::string> extensions;
    if (listsAllFiles(filter)) {
        return extensions;
    }
    for (const auto& extension : filter.extensions) {
        std::string bare = bareExtension(extension);
        for (char& c : bare) {
            c = lower(c);
        }
        extensions.push_back(bare);
    }
    return extensions;
}

ProposedFile proposedFile(const FileDialogRequest& request) {
    if (request.default_path.empty()) {
        return {request.folder, {}};
    }
    const std::filesystem::path path = mfbe::platform::path_from_utf8(request.default_path);
    if (!path.has_parent_path()) {
        return {request.folder, request.default_path};
    }
    return {mfbe::platform::utf8_from_path(path.parent_path()),
            mfbe::platform::utf8_from_path(path.filename())};
}

namespace {

bool endsWithNoCase(const std::string& text, const std::string& ending) {
    if (text.size() < ending.size()) {
        return false;
    }
    for (std::size_t i = 0; i < ending.size(); ++i) {
        char a = text[text.size() - ending.size() + i];
        char b = ending[i];
        if (a >= 'A' && a <= 'Z')
            a = static_cast<char>(a - 'A' + 'a');
        if (b >= 'A' && b <= 'Z')
            b = static_cast<char>(b - 'A' + 'a');
        if (a != b) {
            return false;
        }
    }
    return true;
}

// The plain type's extension ("txt"): its first one; "" for all files or no type.
std::string plainExtension(const FileDialogRequest& request) {
    const std::size_t plain = zipFollowFilter(request, false);
    if (plain >= request.filters.size() || request.filters[plain].extensions.empty()) {
        return {};
    }
    const std::string extension = bareExtension(request.filters[plain].extensions.front());
    return extension == "*" ? std::string() : extension;
}

}  // namespace

std::string zipFollowName(const FileDialogRequest& request, const std::string& name, bool zip) {
    using Rule = FileDialogRequest::ZipRename;
    if (name.empty() || request.zip_rename == Rule::kNone) {
        return name;
    }
    const bool zipped = endsWithNoCase(name, ".zip");
    const std::string plain = plainExtension(request);
    if (request.zip_rename == Rule::kAppend) {
        if (zip) {
            return zipped ? name : name + ".zip";
        }
        return zipped ? name.substr(0, name.size() - 4) : name;
    }
    if (zip) {
        if (zipped) {
            return name;
        }
        if (!plain.empty() && endsWithNoCase(name, "." + plain)) {
            return name.substr(0, name.size() - plain.size() - 1) + ".zip";
        }
        return name + ".zip";
    }
    if (!zipped) {
        return name;
    }
    const std::string stem = name.substr(0, name.size() - 4);
    return plain.empty() ? stem : stem + "." + plain;
}

std::size_t zipFollowFilter(const FileDialogRequest& request, bool zip) {
    const int zip_type = request.zip_filter;
    const bool has_zip =
        zip_type >= 0 && static_cast<std::size_t>(zip_type) < request.filters.size();
    if (zip && has_zip) {
        return static_cast<std::size_t>(zip_type);
    }
    const std::size_t selected = selectedFilterIndex(request);
    return has_zip && selected == static_cast<std::size_t>(zip_type) ? 0 : selected;
}

std::string encodingLabel(const std::string& language) {
    if (language.rfind("ru", 0) == 0) {
        return "Кодировка:";
    }
    return language.rfind("uk", 0) == 0 ? "Кодування:" : "Encoding:";
}

std::size_t selectedEncodingIndex(const FileDialogRequest& request) {
    for (std::size_t i = 0; i < request.encodings.size(); ++i) {
        if (request.encodings[i] == request.selected_encoding) {
            return i;
        }
    }
    return 0;
}

std::string encodingOfItem(const FileDialogRequest& request, unsigned item_id) {
    if (item_id < kEncodingItemBase || item_id - kEncodingItemBase >= request.encodings.size()) {
        return {};
    }
    return request.encodings[item_id - kEncodingItemBase];
}

std::vector<std::string> cefAcceptFilters(const FileDialogRequest& request) {
    std::vector<std::string> filters;
    const FileFilter* filter = selectedFilter(request);
    if (filter == nullptr || listsAllFiles(*filter)) {
        return filters;
    }
    for (const auto& extension : filter->extensions) {
        filters.push_back("." + bareExtension(extension));
    }
    return filters;
}

}  // namespace mfbe::shell
