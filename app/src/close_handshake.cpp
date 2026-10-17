#include "close_handshake.h"

namespace mfbe::shell {

CloseHandshake::Action CloseHandshake::onCloseRequested() {
    switch (state_) {
        case State::kAllowed:
            return Action::kAllow;
        case State::kAsking:
            return Action::kIgnore;
        case State::kIdle:
            break;
    }
    state_ = State::kAsking;
    ++ticket_;
    return Action::kAsk;
}

bool CloseHandshake::onUndelivered(unsigned ticket) {
    if (!isAsking(ticket)) {
        return false;
    }
    state_ = State::kAllowed;
    return true;
}

bool CloseHandshake::onTimeout(unsigned ticket, bool ui_connected) {
    if (!isAsking(ticket)) {
        return false;
    }
    if (ui_connected) {
        // The UI is alive: it declined (nothing to do) or still shows its prompt (app.quit
        // follows when the user agrees). Either way the window stays.
        state_ = State::kIdle;
        return false;
    }
    state_ = State::kAllowed;
    return true;
}

void CloseHandshake::allow() {
    state_ = State::kAllowed;
}

}  // namespace mfbe::shell
