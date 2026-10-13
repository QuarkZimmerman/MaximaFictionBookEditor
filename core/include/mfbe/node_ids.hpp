// Node id allocation, structural paths and remapping after re-parse (T017).
//
// Ids are session-stable strings "n<counter>" issued per document. Paths are XPath-like,
// 1-based among siblings of the same type: "body[1]/section[3]/p[12]". After the Source view
// text is re-parsed the new tree gets fresh ids; `build_remap` pairs old and new ids whose
// structural paths coincide so the UI can translate tree selection / caret / undo entries.
#pragma once

#include <mfbe/document.hpp>

#include <functional>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::model {

class NodeIdAllocator {
public:
    NodeIdAllocator() = default;
    explicit NodeIdAllocator(std::uint64_t next_counter) : next_(next_counter) {}

    // Issues "n<counter>" and advances the counter.
    std::string next();
    // Makes sure future ids never collide with `id` (ids of the form n<digits> are parsed).
    void reserve(const std::string& id);
    // Reserves every nodeId present in `document`.
    void adopt(const Document& document);
    std::uint64_t next_counter() const { return next_; }

private:
    std::uint64_t next_ = 1;
};

// Assigns ids to every structural node lacking one. Returns the number of ids assigned.
std::size_t assign_node_ids(Node& root, NodeIdAllocator& allocator);
std::size_t assign_node_ids(Document& document, NodeIdAllocator& allocator);

// Re-issues ids for every structural node (used after a re-parse). Returns the count.
std::size_t reassign_node_ids(Document& document, NodeIdAllocator& allocator);

// Visits every structural node of the document (bodies, extras, annotation/history, outputs)
// with its path. The callback may return false to stop.
using NodeVisitor = std::function<bool(const Node& node, const std::string& path)>;
void visit_nodes(const Document& document, const NodeVisitor& visitor);

// Path of a node ("" when the id is unknown).
std::string node_path(const Document& document, const std::string& node_id);
std::optional<std::string> node_id_at_path(const Document& document, const std::string& path);
const Node* find_node(const Document& document, const std::string& node_id);
Node* find_node(Document& document, const std::string& node_id);

// Map "nodeId -> path" for a whole document.
std::map<std::string, std::string> node_paths(const Document& document);

struct RemapTable {
    std::map<std::string, std::string> old_to_new;  // only ids whose paths matched
    std::vector<std::string> unmapped_old;          // ids that vanished (no matching path)
    std::vector<std::string> unmapped_new;          // new ids without an old counterpart

    std::optional<std::string> map(const std::string& old_id) const;
    nlohmann::json to_json()
        const;  // {"map": {old: new}, "unmappedOld": [...], "unmappedNew": [...]}
};

RemapTable build_remap(const Document& old_document, const Document& new_document);

}  // namespace mfbe::model
