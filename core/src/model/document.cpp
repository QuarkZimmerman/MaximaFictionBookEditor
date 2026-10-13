// Document model helpers (T016). See mfbe/document.hpp.
#include <mfbe/document.hpp>
#include <mfbe/version.hpp>

#include <algorithm>
#include <array>
#include <cctype>

namespace mfbe {
const char* core_version() {
    return version::kVersion;
}
}  // namespace mfbe

namespace mfbe::model {

std::string Node::node_id() const {
    auto it = attrs.find("nodeId");
    if (it == attrs.end() || !it->second.is_string()) {
        return {};
    }
    return it->second.get<std::string>();
}

std::optional<std::string> Node::attr_string(const std::string& name) const {
    auto it = attrs.find(name);
    if (it == attrs.end() || !it->second.is_string()) {
        return std::nullopt;
    }
    return it->second.get<std::string>();
}

bool is_leaf_type(const std::string& type) {
    static constexpr std::array<const char*, 4> kLeaves{"empty-line", "image", "inline-image",
                                                        "raw-xml"};
    return std::any_of(kLeaves.begin(), kLeaves.end(),
                       [&](const char* leaf) { return type == leaf; });
}

bool is_structural_type(const std::string& type) {
    return type != "text";
}

const char* to_string(FileKind kind) {
    switch (kind) {
        case FileKind::fb2:
            return "fb2";
        case FileKind::fbd:
            return "fbd";
        case FileKind::xml:
            return "xml";
    }
    return "xml";
}

const char* to_string(SchemaHint hint) {
    switch (hint) {
        case SchemaHint::v21:
            return "2.1";
        case SchemaHint::legacy:
            return "legacy";
        case SchemaHint::unknown:
            return "unknown";
    }
    return "unknown";
}

const char* to_string(Severity severity) {
    return severity == Severity::error ? "error" : "warning";
}

std::optional<FileKind> file_kind_from_string(std::string_view text) {
    if (text == "fb2") {
        return FileKind::fb2;
    }
    if (text == "fbd") {
        return FileKind::fbd;
    }
    if (text == "xml") {
        return FileKind::xml;
    }
    return std::nullopt;
}

std::optional<SchemaHint> schema_hint_from_string(std::string_view text) {
    if (text == "2.1") {
        return SchemaHint::v21;
    }
    if (text == "legacy") {
        return SchemaHint::legacy;
    }
    if (text == "unknown") {
        return SchemaHint::unknown;
    }
    return std::nullopt;
}

std::optional<Severity> severity_from_string(std::string_view text) {
    if (text == "error") {
        return Severity::error;
    }
    if (text == "warning") {
        return Severity::warning;
    }
    return std::nullopt;
}

FileKind file_kind_from_extension(std::string_view extension) {
    std::string lower(extension);
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (lower == ".fb2" || lower == "fb2") {
        return FileKind::fb2;
    }
    if (lower == ".fbd" || lower == "fbd") {
        return FileKind::fbd;
    }
    return FileKind::xml;
}

}  // namespace mfbe::model
