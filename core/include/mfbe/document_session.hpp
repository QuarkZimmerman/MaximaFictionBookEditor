// Document session registry (T024): docId issue, open documents, remembered caret.
//
// Per D4 the UI owns the live document; the core keeps per-document session state: the file
// identity (path, kind, encoding, mtime), the binary store, the node-id allocator, the last
// model snapshot the core produced or received, the caret for "Restore position" and the
// position map of the last Source text serialised or parsed with `positions: true` (feature
// 004 US7, `doc.mapPositions`).
#pragma once

#include <mfbe/binary_store.hpp>
#include <mfbe/document.hpp>
#include <mfbe/node_ids.hpp>
#include <mfbe/position_map.hpp>
#include <mfbe/recent_files.hpp>

#include <chrono>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::session {

struct DocumentSession {
    std::string docId;
    std::optional<std::string> path;  // absolute; nullopt for a new unsaved document
    model::FileKind fileKind = model::FileKind::fb2;
    std::string sourceEncoding = "utf-8";
    std::string xlinkPrefix = "l";  // xlink namespace prefix of the opened file (kept on save)
    model::SchemaHint schemaHint = model::SchemaHint::unknown;
    bool sourceOnly = false;                     // malformed file opened in Source-only mode
    std::optional<std::int64_t> lastKnownMtime;  // seconds since epoch (file time)
    std::optional<std::uintmax_t> lastKnownSize;
    bool watching = false;  // doc.watch enabled
    // Thread-safe; jobs keep their own shared_ptr while the loop thread may swap the store.
    std::shared_ptr<BinaryStore> binaries = std::make_shared<BinaryStore>();
    model::NodeIdAllocator ids;
    std::optional<model::Document> snapshot;  // last model seen by the core (may be absent)
    std::optional<settings::Caret> caret;
    // The current position map with its text (feature 004 US7): recorded by doc.toXml /
    // doc.fromXml with `positions: true`, superseded by the next recording, dropped by a
    // successful doc.fromXml without the flag; absent after open / new.
    std::optional<fb2::PositionMap> positionMap;
    std::uint64_t positionSerial = 0;  // the last serial issued (increasing per session)
    std::chrono::steady_clock::time_point openedAt = std::chrono::steady_clock::now();

    // Installs `map` as the current position map of `text` under a fresh serial, which is
    // returned.
    std::uint64_t record_positions(fb2::PositionMap map, std::string text) {
        map.text = std::move(text);
        map.serial = ++positionSerial;
        positionMap = std::move(map);
        return positionSerial;
    }
};

class DocumentRegistry {
public:
    // Creates a session and returns it (docId "d<counter>").
    DocumentSession& create();
    DocumentSession* find(const std::string& doc_id);
    const DocumentSession* find(const std::string& doc_id) const;
    // Like find() but throws rpc::RpcError(1000 doc.notFound {docId}).
    DocumentSession& require(const std::string& doc_id);
    bool close(const std::string& doc_id);
    std::vector<std::string> ids() const;
    std::size_t size() const { return sessions_.size(); }
    // First open session whose path equals `path` (nullptr when none).
    DocumentSession* find_by_path(const std::string& path);

    // Caret memory (per docId, kept while the document is open).
    void remember_caret(const std::string& doc_id, const std::optional<settings::Caret>& caret);
    std::optional<settings::Caret> caret(const std::string& doc_id) const;

private:
    std::map<std::string, std::unique_ptr<DocumentSession>> sessions_;
    std::uint64_t next_id_ = 1;
};

}  // namespace mfbe::session
