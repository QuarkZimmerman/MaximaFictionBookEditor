// Copies of the editor, as the shell sees them (feature 008, contracts/shell.md §1-§3).
//
// Plain C++ over the core library's copy registry and copy launch rules
// (mfbe/copy_registry.hpp, mfbe/copy_launch.hpp); compiled in the bridge library, with
// exceptions, so the shell sources call it without any exception crossing.
#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::copies {
class CopyRegistry;
}

namespace mfbe::shell {

struct CopyWindowRect {
    int x = 0;
    int y = 0;
    int w = 0;
    int h = 0;
    bool maximized = false;
};

// What this start does, decided before any engine or core starts (contracts/shell.md §1).
struct CopyStart {
    bool ok = true;       // false: no slot could be taken (64 copies) - the start fails
    bool relay = false;   // hand `payload` to the copy of `slot` and exit
    int slot = 0;         // the receiving copy's slot, or this copy's own one
    std::string payload;  // the --mfbe-request value when relaying
    std::filesystem::path profile_dir;        // the engine profile of `slot`
    std::optional<CopyWindowRect> placement;  // a new copy: beside the last-active copy
};

// `books` are absolute UTF-8 paths. A start with books and a responding copy relays; otherwise
// it takes the lowest free slot (or `forced_slot` > 0) and becomes a new copy.
CopyStart decideCopyStart(const std::filesystem::path& data_dir,
                          const std::vector<std::string>& books, bool force_new_copy,
                          int forced_slot);

// The payload of an activation request for the copy holding `path` (FR-017).
std::string activationPayload(const std::string& path);

struct RelayedRequest {
    std::string kind;  // "open" | "activate"
    std::string request_id;
    std::vector<std::string> paths;
    std::string origin;
    std::string target;
};
// Reads only --mfbe-request from a relayed command line (research R1).
std::optional<RelayedRequest> parseRelayedRequest(const std::vector<std::string>& argv);

// This copy's registry: null for relaying starts and developer (--url) runs.
mfbe::copies::CopyRegistry* copyRegistry();
void copyHeartbeat();
void copyActivated();
void copyWindowChanged(const CopyWindowRect& window);
// Removes this copy's record; the slot lock goes with the process.
void releaseCopy();

// The acknowledgement of a relayed request (FR-011): the page answers app.openRequestAck within
// five seconds, or the books go to a new copy. Thread-safe.
void expectAck(const std::string& request_id);
void markAcked(const std::string& request_id);
// True when the request was acknowledged; forgets it either way.
bool takeAcked(const std::string& request_id);

// Starts a new copy of this program with the books (--mfbe-new-copy), or, with `activate`, a
// start that brings the copy holding the book forward. False with `reason` on failure.
bool spawnCopy(const std::vector<std::string>& books, std::string* reason);

}  // namespace mfbe::shell
