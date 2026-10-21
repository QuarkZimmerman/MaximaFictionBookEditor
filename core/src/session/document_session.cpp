// Document session registry (T024). See mfbe/document_session.hpp.
#include <mfbe/document_session.hpp>
#include <mfbe/rpc.hpp>

namespace mfbe::session {

DocumentSession& DocumentRegistry::create() {
    auto session = std::make_unique<DocumentSession>();
    session->docId = "d" + std::to_string(next_id_++);
    DocumentSession& ref = *session;
    sessions_[ref.docId] = std::move(session);
    return ref;
}

DocumentSession* DocumentRegistry::find(const std::string& doc_id) {
    auto it = sessions_.find(doc_id);
    return it == sessions_.end() ? nullptr : it->second.get();
}

const DocumentSession* DocumentRegistry::find(const std::string& doc_id) const {
    auto it = sessions_.find(doc_id);
    return it == sessions_.end() ? nullptr : it->second.get();
}

DocumentSession& DocumentRegistry::require(const std::string& doc_id) {
    DocumentSession* s = find(doc_id);
    if (s == nullptr) {
        throw rpc::RpcError(rpc::codes::kDocNotFound, "", nlohmann::json{{"docId", doc_id}});
    }
    return *s;
}

bool DocumentRegistry::close(const std::string& doc_id) {
    return sessions_.erase(doc_id) > 0;
}

std::vector<std::string> DocumentRegistry::ids() const {
    std::vector<std::string> out;
    out.reserve(sessions_.size());
    for (const auto& [id, session] : sessions_) {
        out.push_back(id);
    }
    return out;
}

DocumentSession* DocumentRegistry::find_by_path(const std::string& path) {
    for (auto& [id, session] : sessions_) {
        if (session->path && *session->path == path) {
            return session.get();
        }
    }
    return nullptr;
}

void DocumentRegistry::remember_position(const std::string& doc_id,
                                         const std::optional<settings::Position>& position) {
    if (DocumentSession* s = find(doc_id)) {
        s->position = position;
    }
}

std::optional<settings::Position> DocumentRegistry::position(const std::string& doc_id) const {
    const DocumentSession* s = find(doc_id);
    return s == nullptr ? std::nullopt : s->position;
}

}  // namespace mfbe::session
