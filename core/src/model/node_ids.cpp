// Node ids, paths and remap tables (T017). See mfbe/node_ids.hpp.
#include <mfbe/node_ids.hpp>

#include <charconv>

namespace mfbe::model {
namespace {

// Roots of a document in a stable order with their path prefixes.
template <typename Doc, typename Fn>
void for_each_root(Doc& document, Fn fn) {
    for (std::size_t i = 0; i < document.bodies.size(); ++i) {
        fn(document.bodies[i], "body[" + std::to_string(i + 1) + "]");
    }
    if (document.description.titleInfo.annotation) {
        fn(*document.description.titleInfo.annotation, "title-info/annotation[1]");
    }
    if (document.description.srcTitleInfo && document.description.srcTitleInfo->annotation) {
        fn(*document.description.srcTitleInfo->annotation, "src-title-info/annotation[1]");
    }
    if (document.description.documentInfo.history) {
        fn(*document.description.documentInfo.history, "document-info/history[1]");
    }
    for (std::size_t i = 0; i < document.description.outputs.size(); ++i) {
        fn(document.description.outputs[i], "output[" + std::to_string(i + 1) + "]");
    }
    for (std::size_t i = 0; i < document.extras.size(); ++i) {
        fn(document.extras[i], "extra[" + std::to_string(i + 1) + "]");
    }
}

// Depth-first walk; `fn(node, path)` returns false to stop. Returns false when stopped.
template <typename NodeT, typename Fn>
bool walk(NodeT& node, const std::string& path, Fn& fn) {
    if (!node.is_text()) {
        if (!fn(node, path)) {
            return false;
        }
    }
    std::map<std::string, std::size_t> counters;
    for (auto& child : node.content) {
        if (child.is_text()) {
            continue;
        }
        const std::size_t index = ++counters[child.type];
        if (!walk(child, path + "/" + child.type + "[" + std::to_string(index) + "]", fn)) {
            return false;
        }
    }
    return true;
}

template <typename Doc, typename Fn>
void walk_document(Doc& document, Fn fn) {
    bool go_on = true;
    for_each_root(document, [&](auto& root, const std::string& prefix) {
        if (go_on) {
            go_on = walk(root, prefix, fn);
        }
    });
}

std::size_t assign_missing(Node& node, NodeIdAllocator& allocator, bool force) {
    std::size_t count = 0;
    auto fn = [&](Node& n, const std::string&) {
        if (force || n.node_id().empty()) {
            n.set_node_id(allocator.next());
            ++count;
        }
        return true;
    };
    walk(node, "", fn);
    return count;
}

}  // namespace

std::string NodeIdAllocator::next() {
    return "n" + std::to_string(next_++);
}

void NodeIdAllocator::reserve(const std::string& id) {
    if (id.size() < 2 || id[0] != 'n') {
        return;
    }
    std::uint64_t value = 0;
    const char* begin = id.data() + 1;
    const char* end = id.data() + id.size();
    const auto [ptr, ec] = std::from_chars(begin, end, value);
    if (ec == std::errc() && ptr == end && value >= next_) {
        next_ = value + 1;
    }
}

void NodeIdAllocator::adopt(const Document& document) {
    visit_nodes(document, [&](const Node& node, const std::string&) {
        reserve(node.node_id());
        return true;
    });
}

std::size_t assign_node_ids(Node& root, NodeIdAllocator& allocator) {
    return assign_missing(root, allocator, false);
}

std::size_t assign_node_ids(Document& document, NodeIdAllocator& allocator) {
    std::size_t count = 0;
    for_each_root(document, [&](Node& root, const std::string&) {
        count += assign_missing(root, allocator, false);
    });
    return count;
}

std::size_t reassign_node_ids(Document& document, NodeIdAllocator& allocator) {
    std::size_t count = 0;
    for_each_root(document, [&](Node& root, const std::string&) {
        count += assign_missing(root, allocator, true);
    });
    return count;
}

void visit_nodes(const Document& document, const NodeVisitor& visitor) {
    walk_document(document,
                  [&](const Node& node, const std::string& path) { return visitor(node, path); });
}

std::string node_path(const Document& document, const std::string& node_id) {
    std::string result;
    if (node_id.empty()) {
        return result;
    }
    visit_nodes(document, [&](const Node& node, const std::string& path) {
        if (node.node_id() == node_id) {
            result = path;
            return false;
        }
        return true;
    });
    return result;
}

std::optional<std::string> node_id_at_path(const Document& document, const std::string& path) {
    std::optional<std::string> result;
    visit_nodes(document, [&](const Node& node, const std::string& p) {
        if (p == path) {
            result = node.node_id();
            return false;
        }
        return true;
    });
    return result;
}

const Node* find_node(const Document& document, const std::string& node_id) {
    const Node* found = nullptr;
    if (node_id.empty()) {
        return found;
    }
    visit_nodes(document, [&](const Node& node, const std::string&) {
        if (node.node_id() == node_id) {
            found = &node;
            return false;
        }
        return true;
    });
    return found;
}

Node* find_node(Document& document, const std::string& node_id) {
    Node* found = nullptr;
    if (node_id.empty()) {
        return found;
    }
    walk_document(document, [&](Node& node, const std::string&) {
        if (node.node_id() == node_id) {
            found = &node;
            return false;
        }
        return true;
    });
    return found;
}

std::map<std::string, std::string> node_paths(const Document& document) {
    std::map<std::string, std::string> result;
    visit_nodes(document, [&](const Node& node, const std::string& path) {
        const std::string id = node.node_id();
        if (!id.empty()) {
            result.emplace(id, path);
        }
        return true;
    });
    return result;
}

std::optional<std::string> RemapTable::map(const std::string& old_id) const {
    auto it = old_to_new.find(old_id);
    if (it == old_to_new.end()) {
        return std::nullopt;
    }
    return it->second;
}

nlohmann::json RemapTable::to_json() const {
    nlohmann::json j;
    j["map"] = old_to_new;
    j["unmappedOld"] = unmapped_old;
    j["unmappedNew"] = unmapped_new;
    return j;
}

RemapTable build_remap(const Document& old_document, const Document& new_document) {
    RemapTable table;
    std::map<std::string, std::string> new_by_path;  // path -> new id
    visit_nodes(new_document, [&](const Node& node, const std::string& path) {
        new_by_path.emplace(path, node.node_id());
        return true;
    });
    std::map<std::string, bool> new_used;
    visit_nodes(old_document, [&](const Node& node, const std::string& path) {
        const std::string old_id = node.node_id();
        if (old_id.empty()) {
            return true;
        }
        auto it = new_by_path.find(path);
        if (it != new_by_path.end() && !it->second.empty()) {
            table.old_to_new[old_id] = it->second;
            new_used[it->second] = true;
        } else {
            table.unmapped_old.push_back(old_id);
        }
        return true;
    });
    for (const auto& [path, id] : new_by_path) {
        if (!id.empty() && !new_used.count(id)) {
            table.unmapped_new.push_back(id);
        }
    }
    return table;
}

}  // namespace mfbe::model
