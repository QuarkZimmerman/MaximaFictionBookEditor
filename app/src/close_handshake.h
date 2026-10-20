// Close handshake of the main window (feature 003 FR-013 / FR-017, rpc-api.md §3.1): the window
// must not close behind the UI's back. A close request the user can still cancel (title-bar
// X, Alt+F4, Cmd+Q, system shutdown...) is deferred: the shell asks the core to emit
// `app.closeRequested`, the UI runs its quit flow - the cancel-script prompt while a script
// runs, then the save prompt - and ends it with `app.quit`, on which the shell closes for
// real. A request while the UI is already asked asks again with a new ticket: the UI ignores
// it while its prompt is up, and after a Cancel it is the next prompt - the user never meets
// a close button that does nothing. A UI that cannot answer (no client connected: page not
// loaded, renderer gone) must not leave a window that cannot be closed: after a timeout the
// shell checks whether a UI is still connected and forces the close when none is; a connected
// UI keeps the window (the user declined, or the prompt is still up).
//
// Pure logic without CEF types so that tests/shell/test_close_handshake.cpp can drive it;
// MfbeClient::OfferCloseToUi feeds it the events and performs the actions. The entry point is
// CefWindowDelegate::CanClose (window.cpp) - with Chrome style CEF never calls
// CefLifeSpanHandler::DoClose, so the handshake must not live there.
#pragma once

#include <chrono>

namespace mfbe::shell {

class CloseHandshake {
public:
    // What the caller must do with a close request.
    enum class Action {
        kAllow,  // let the close proceed (agreed by app.quit, or nobody can answer)
        kAsk,    // cancel this close, ask the UI and start the timeout
    };

    enum class State { kIdle, kAsking, kAllowed };

    // How long the shell waits for the UI before it checks whether a UI is still connected.
    static constexpr std::chrono::milliseconds kAnswerTimeout{10000};

    // A close request arrived. Each kAsk hands out a new ticket (`ticket()`), so that late
    // answers of an earlier request are told apart from the current one.
    Action onCloseRequested();

    // Ticket of the current (or last) ask; 0 before the first one.
    unsigned ticket() const { return ticket_; }

    // True while the request with `ticket` is still waiting for the UI.
    bool isAsking(unsigned ticket) const { return state_ == State::kAsking && ticket_ == ticket; }

    // The request could not be delivered (no core, no UI connected): nobody will answer, the
    // close is allowed. Returns true when the caller must now close the window itself.
    bool onUndelivered(unsigned ticket);

    // The timeout passed without app.quit. `ui_connected` tells whether a UI client is still
    // there: then the request is dropped (the user declined or is still asked) and the window
    // stays; otherwise the close is forced. Returns true when the caller must close the window.
    bool onTimeout(unsigned ticket, bool ui_connected);

    // app.quit (the UI finished its quit flow) or a forced close ordered by the shell: every
    // close from now on is allowed.
    void allow();

    State state() const { return state_; }

private:
    State state_ = State::kIdle;
    unsigned ticket_ = 0;
};

}  // namespace mfbe::shell
