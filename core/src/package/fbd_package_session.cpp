// FbdPackageSession registry and FB2 2.1 single-cover .fbd normalization (feature 022, T009).
#include <mfbe/fbd_package.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <set>
#include <string>
#include <vector>

namespace mfbe::package {
namespace {

namespace fs = std::filesystem;

std::string cover_extension_for(const model::BinaryMeta& meta, std::string_view fallback_id) {
    if (meta.contentType == "image/png") {
        return "png";
    }
    if (meta.contentType == "image/jpeg" || meta.contentType == "image/jpg") {
        return "jpg";
    }
    auto [_, ext] = split_name_and_lower_ext(fallback_id);
    if (ext == "png") {
        return "png";
    }
    if (ext == "jpeg" || ext == "jpg") {
        return "jpg";
    }
    return ext.empty() ? "jpg" : ext;
}

}  // namespace

std::uint32_t normalize_package_fbd(model::Document& doc, BinaryStore& store,
                                    model::NodeIdAllocator& ids) {
    // Package FBD files always carry minimal empty <body><section/></body> for FB2 2.1 validity,
    // no <stylesheet> blocks, and no top-level FictionBook extras.
    doc.bodies.clear();
    model::Node section;
    section.type = "section";
    section.set_node_id(ids.next());
    model::Node body;
    body.type = "body";
    body.set_node_id(ids.next());
    body.content.push_back(std::move(section));
    doc.bodies.push_back(std::move(body));

    doc.stylesheets.clear();
    std::erase_if(doc.extras, [](const model::Node& n) {
        return n.attr_string("slot").value_or("FictionBook") == "FictionBook";
    });
    doc.fileKind = model::FileKind::fbd;
    doc.sourceEncoding = "utf-8";
    doc.path.reset();

    // Source title info never carries a cover in Package mode.
    std::uint32_t dropped = 0;
    if (doc.description.srcTitleInfo) {
        doc.description.srcTitleInfo->coverpage.clear();
    }

    // Locate the first valid cover binary referenced in titleInfo.coverpage.
    std::optional<std::string> chosen_old_id;
    std::size_t cover_refs_seen = doc.description.titleInfo.coverpage.size();
    for (const model::ImageRef& ref : doc.description.titleInfo.coverpage) {
        if (ref.href.size() > 1 && ref.href[0] == '#') {
            const std::string id = ref.href.substr(1);
            if (store.meta(id).has_value()) {
                chosen_old_id = id;
                break;
            }
        }
    }

    const std::vector<std::string> existing_ids = store.ids();
    if (!chosen_old_id) {
        if (!existing_ids.empty()) {
            dropped += static_cast<std::uint32_t>(existing_ids.size());
        }
        for (const std::string& id : existing_ids) {
            store.remove(id);
        }
        doc.description.titleInfo.coverpage.clear();
        doc.binaries.clear();
        return dropped;
    }

    const auto meta = store.meta(*chosen_old_id);
    const auto bytes = store.bytes(*chosen_old_id);
    const bool raw_text = store.is_raw_text(*chosen_old_id);
    if (!meta || !bytes) {
        for (const std::string& id : existing_ids) {
            store.remove(id);
        }
        doc.description.titleInfo.coverpage.clear();
        doc.binaries.clear();
        return static_cast<std::uint32_t>(existing_ids.size());
    }

    if (existing_ids.size() > 1) {
        dropped += static_cast<std::uint32_t>(existing_ids.size() - 1);
    } else if (cover_refs_seen > 1) {
        dropped += static_cast<std::uint32_t>(cover_refs_seen - 1);
    }

    const std::string ext = cover_extension_for(*meta, *chosen_old_id);
    const std::string canonical_id = "cover." + ext;

    for (const std::string& id : existing_ids) {
        store.remove(id);
    }
    store.put(canonical_id, meta->contentType, *bytes, raw_text);
    store.set_reference_counts({{canonical_id, 1}});

    model::ImageRef cover_ref;
    cover_ref.href = "#" + canonical_id;
    doc.description.titleInfo.coverpage = {cover_ref};

    doc.binaries.clear();
    if (auto stored_meta = store.meta(canonical_id)) {
        stored_meta->referenceCount = 1;
        doc.binaries.push_back(std::move(*stored_meta));
    }
    return dropped;
}

bool same_target_path(const fs::path& a, const fs::path& b) {
    if (a.empty() || b.empty()) {
        return false;
    }
    std::error_code ec;
    if (fs::exists(a, ec) && !ec && fs::exists(b, ec) && !ec) {
        const bool eq = fs::equivalent(a, b, ec);
        if (!ec) {
            return eq;
        }
    }
    const fs::path ca = fs::weakly_canonical(a, ec);
    const fs::path norm_a = ec ? fs::absolute(a).lexically_normal() : ca;
    ec.clear();
    const fs::path cb = fs::weakly_canonical(b, ec);
    const fs::path norm_b = ec ? fs::absolute(b).lexically_normal() : cb;
#ifdef _WIN32
    return make_stem_key(platform::utf8_from_path(norm_a)) ==
           make_stem_key(platform::utf8_from_path(norm_b));
#else
    return norm_a == norm_b;
#endif
}

FbdPackageSession& FbdPackageRegistry::create() {
    std::lock_guard<std::mutex> lock(mutex_);
    auto session = std::make_unique<FbdPackageSession>();
    session->packageId = "pkg_" + std::to_string(next_package_id_++);
    const std::string id = session->packageId;
    auto& ref = *session;
    sessions_.emplace(id, std::move(session));
    return ref;
}

FbdPackageSession* FbdPackageRegistry::find(const std::string& package_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto it = sessions_.find(package_id);
    return it == sessions_.end() ? nullptr : it->second.get();
}

const FbdPackageSession* FbdPackageRegistry::find(const std::string& package_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto it = sessions_.find(package_id);
    return it == sessions_.end() ? nullptr : it->second.get();
}

std::vector<std::string> FbdPackageRegistry::close(const std::string& package_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<std::string> doc_ids;
    const auto it = sessions_.find(package_id);
    if (it == sessions_.end()) {
        return doc_ids;
    }
    for (const FbdPackagePayloadEntry& e : it->second->entries) {
        doc_ids.push_back(e.docId);
    }
    sessions_.erase(it);
    return doc_ids;
}

std::vector<std::string> FbdPackageRegistry::close_all() {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<std::string> doc_ids;
    for (const auto& [_, session] : sessions_) {
        for (const FbdPackagePayloadEntry& e : session->entries) {
            doc_ids.push_back(e.docId);
        }
    }
    sessions_.clear();
    return doc_ids;
}

std::string FbdPackageRegistry::next_entry_id() {
    std::lock_guard<std::mutex> lock(mutex_);
    return "ent_" + std::to_string(next_entry_id_++);
}

}  // namespace mfbe::package
