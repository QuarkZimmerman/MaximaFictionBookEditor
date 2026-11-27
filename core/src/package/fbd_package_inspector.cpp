// Top-level ZIP archive inspection and <stem>.fbd pairing for FBD ZIP package mode (feature 022).
#include <mfbe/fbd_package.hpp>

#include <map>
#include <set>
#include <string>
#include <vector>

namespace mfbe::package {
namespace {

bool is_top_level(const archive::Entry& entry) {
    return !entry.directory && entry.name.find('/') == std::string::npos &&
           entry.name.find('\\') == std::string::npos && !entry.name.empty();
}

FbdPackagePreservedZipEntry to_preserved(const archive::Entry& entry) {
    FbdPackagePreservedZipEntry p;
    p.entryName = entry.name;
    p.rawName = entry.raw_name;
    p.localHeaderOffset = entry.offset;
    p.compressedSize = entry.compressed;
    return p;
}

}  // namespace

FbdPackageInspection inspect_zip_listing(const archive::Listing& listing) {
    FbdPackageInspection out;

    bool any_fb2 = false;
    bool any_fbd = false;
    for (const archive::Book& b : listing.books) {
        if (b.kind == "fb2") {
            any_fb2 = true;
            break;
        }
        if (b.kind == "fbd") {
            any_fbd = true;
        }
    }
    if (any_fb2) {
        out.classification = ZipClassification::fb2_archive;
        return out;
    }

    struct TopFbd {
        const archive::Entry* entry = nullptr;
        std::string stemKey;
    };
    struct TopPayload {
        const archive::Entry* entry = nullptr;
        std::string stem;
        std::string stemKey;
        std::string extension;
        std::string normalizedFileName;
    };

    std::vector<TopFbd> top_fbds;
    std::vector<TopPayload> top_payloads;
    std::vector<const archive::Entry*> ignored_entries;

    for (const archive::Entry& e : listing.entries) {
        if (!is_top_level(e)) {
            ignored_entries.push_back(&e);
            continue;
        }
        auto [stem, ext] = split_name_and_lower_ext(e.name);
        if (ext == "fb2") {
            out.classification = ZipClassification::fb2_archive;
            return out;
        }
        if (ext == "fbd") {
            top_fbds.push_back(TopFbd{&e, make_stem_key(stem)});
            any_fbd = true;
            continue;
        }
        if (is_forbidden_archive_extension(ext)) {
            ignored_entries.push_back(&e);
            continue;
        }
        TopPayload payload;
        payload.entry = &e;
        payload.stem = stem;
        payload.stemKey = make_stem_key(stem);
        payload.extension = ext;
        payload.normalizedFileName = ext.empty() ? stem : (stem + "." + ext);
        top_payloads.push_back(std::move(payload));
    }

    if (top_fbds.empty() || top_payloads.empty()) {
        out.classification =
            any_fbd ? ZipClassification::standalone_fbd : ZipClassification::no_book;
        return out;
    }

    out.classification = ZipClassification::fbd_package;

    // Detect colliding top-level stems among valid payload files (two files would map to one .fbd).
    std::map<std::string, std::string> seen_payload_stems;
    for (const TopPayload& p : top_payloads) {
        auto [it, inserted] = seen_payload_stems.emplace(p.stemKey, p.entry->name);
        if (!inserted) {
            out.duplicateRootStem = true;
            out.duplicateStemDetail = it->second + " / " + p.entry->name;
            return out;
        }
    }

    // Index top-level .fbd entries by case-folded stem (first occurrence wins; extras are ignored).
    std::map<std::string, const archive::Entry*> fbd_by_stem;
    std::set<std::string> matched_fbd_raw_names;
    for (const TopFbd& f : top_fbds) {
        fbd_by_stem.emplace(f.stemKey, f.entry);
    }

    // Single-book + single-FBD fallback (FBDMaker compatibility when stems differ).
    const bool single_fallback = top_payloads.size() == 1 && top_fbds.size() == 1;

    out.pairs.reserve(top_payloads.size());
    for (const TopPayload& p : top_payloads) {
        InspectedPackagePair pair;
        pair.payloadEntryName = p.entry->name;
        pair.fileName = p.normalizedFileName;
        pair.stem = p.stem;
        pair.stemKey = p.stemKey;
        pair.extension = p.extension;
        pair.size = p.entry->size;

        const auto it = fbd_by_stem.find(p.stemKey);
        if (it != fbd_by_stem.end()) {
            pair.fbdEntryName = it->second->name;
            matched_fbd_raw_names.insert(it->second->raw_name);
        } else if (single_fallback) {
            pair.fbdEntryName = top_fbds.front().entry->name;
            matched_fbd_raw_names.insert(top_fbds.front().entry->raw_name);
        }
        out.pairs.push_back(std::move(pair));
    }

    // Unmatched top-level .fbd entries (orphans or duplicates) are preserved untouched on in-place Save.
    for (const TopFbd& f : top_fbds) {
        if (!matched_fbd_raw_names.contains(f.entry->raw_name)) {
            ignored_entries.push_back(f.entry);
        }
    }

    out.preservedEntries.reserve(ignored_entries.size());
    for (const archive::Entry* e : ignored_entries) {
        out.preservedEntries.push_back(to_preserved(*e));
    }
    return out;
}

}  // namespace mfbe::package
