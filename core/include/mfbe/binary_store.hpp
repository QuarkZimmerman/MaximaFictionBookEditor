// Binary (image) store (T042): the bytes of a document's <binary> objects live here, never in
// the JSON model and never on the JSON-RPC channel (Constitution III, research D4).
//
// - Bytes are decoded from base64 while parsing and stored by id in document order.
// - Metadata (BinaryMeta) is derived on insertion: declared content type (sniffed by magic
//   bytes when the declaration is missing), size, width/height from the image header,
//   `decodable` (format recognised), `willConvert` (decodable and not JPEG/PNG);
//   `referenceCount` is recomputed from the document (update_reference_counts()).
// - Above a per-document memory threshold new payloads are spilled to temporary files so a
//   120 MB image-heavy book does not have to stay resident; bytes() reads them back.
// - Invalid base64 is preserved verbatim (`raw_text`): the original text is written back
//   unchanged on save and the object is reported, never dropped (FR-111).
// Thread-safe (a save job may read while the loop thread serves /binary requests).
#pragma once

#include <mfbe/document.hpp>

#include <cstdint>
#include <filesystem>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace mfbe {

class BinaryStore {
public:
    static constexpr std::int64_t kDefaultSpillThreshold = 32LL * 1024 * 1024;
    static constexpr std::int64_t kNoSpill = INT64_MAX;
    // Payloads smaller than this are never spilled (not worth a file).
    static constexpr std::int64_t kMinSpillSize = 64 * 1024;

    explicit BinaryStore(std::int64_t spill_threshold = kDefaultSpillThreshold);
    virtual ~BinaryStore();
    BinaryStore(const BinaryStore&) = delete;
    BinaryStore& operator=(const BinaryStore&) = delete;

    // Stores bytes under `id` (replacing any previous content, keeping its position and
    // reference count). `raw_text` marks undecodable base64 kept verbatim.
    model::BinaryMeta put(const std::string& id, const std::string& content_type, std::string bytes,
                          bool raw_text = false);
    bool remove(const std::string& id);
    bool contains(const std::string& id) const;
    std::optional<model::BinaryMeta> meta(const std::string& id) const;
    // Updates mutable metadata (reference count, conversion flag); size always follows bytes.
    void update_meta(const model::BinaryMeta& meta);
    // All objects in document (insertion) order.
    std::vector<model::BinaryMeta> list() const;
    std::vector<std::string> ids() const;
    std::size_t size() const;
    // A copy of the bytes (read back from the spill file when needed); nullopt when unknown.
    std::optional<std::string> bytes(const std::string& id) const;
    // True when the stored "bytes" are the original (invalid) base64 text.
    bool is_raw_text(const std::string& id) const;
    // Sniffed MIME type ("" when the format was not recognised).
    std::string sniffed_type(const std::string& id) const;
    // Type to serve over HTTP: sniffed when known, else declared, else octet-stream.
    std::string effective_content_type(const std::string& id) const;
    // Strong ETag for HTTP: hex content hash in quotes ("" when unknown).
    std::string etag(const std::string& id) const;

    std::int64_t total_bytes() const;
    std::int64_t memory_bytes() const;
    std::int64_t spilled_bytes() const;
    std::int64_t spill_threshold() const { return threshold_; }

    // Picks a unique id based on `suggested` (img.png -> img_2.png, ...; "binary" when empty).
    std::string unique_id(const std::string& suggested) const;
    // Default id for a new image: img_<N>.<ext> (N = first free number).
    std::string next_image_id(const std::string& content_type) const;

    // Sets every reference count (ids missing from the map get 0).
    void set_reference_counts(const std::map<std::string, int>& counts);
    void clear();

private:
    struct Entry {
        model::BinaryMeta meta;
        std::string bytes;            // empty when spilled
        std::filesystem::path spill;  // spill file ("" when in memory)
        bool raw_text = false;
        std::string sniffed;
        std::uint64_t hash = 0;
    };
    std::optional<std::string> read_entry(const Entry& entry) const;
    bool spill_entry(Entry& entry, const std::string& id);
    void release_entry(Entry& entry);

    mutable std::mutex mutex_;
    std::vector<std::string> order_;
    std::map<std::string, Entry> entries_;
    std::int64_t threshold_;
    std::int64_t memory_ = 0;
    std::int64_t spilled_ = 0;
    std::filesystem::path spill_dir_;  // created on first spill, removed in the destructor
    std::uint64_t spill_counter_ = 0;
};

// In-memory only variant (tests, small documents).
class MemoryBinaryStore : public BinaryStore {
public:
    MemoryBinaryStore() : BinaryStore(kNoSpill) {}
};

// The parts of a document whose `href="#id"` usages count as references. The whole document
// by default; the description import of feature 004 keeps only what its importable entries
// refer to (the cover pages and the images of the annotations and the history - rpc-api §3.2
// `doc.readDescription`), the FBD export adds the preserved `output` elements it writes.
struct ReferenceRoots {
    bool description = true;  // cover pages; images inside the annotations and the history
    bool outputs = true;      // images inside the preserved <output> elements
    bool bodies = true;       // block and inline images of the bodies and the top-level extras
};

// The ids referenced from `roots` of the document, in document order, each once.
std::vector<std::string> referenced_ids(const model::Document& document, ReferenceRoots roots = {});

// Recomputes referenceCount for every object from the document's `href="#id"` usages
// (block/inline images and cover pages) and mirrors the store into `document.binaries`.
void update_reference_counts(const model::Document& document, BinaryStore& store);
void sync_binaries(model::Document& document, const BinaryStore& store);

}  // namespace mfbe
