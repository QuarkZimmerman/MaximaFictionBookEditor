// The main window's close handshake (feature 003 FR-013 / FR-017): a close request is deferred
// and the UI asked (app.closeRequested) - again on every further request, so that a close
// button pressed after a Cancel asks again at once; app.quit allows the close; a request
// nobody can receive closes at once; after the timeout a connected UI keeps the window (it
// declined or is still asked) while a vanished UI lets it close.
#include "close_handshake.h"

#include <catch2/catch_test_macros.hpp>
#include <chrono>

using mfbe::shell::CloseHandshake;
using Action = CloseHandshake::Action;
using State = CloseHandshake::State;

TEST_CASE("close handshake: the first request is deferred and the UI asked", "[close]") {
    CloseHandshake handshake;
    CHECK(handshake.state() == State::kIdle);
    CHECK(handshake.ticket() == 0);

    CHECK(handshake.onCloseRequested() == Action::kAsk);
    CHECK(handshake.state() == State::kAsking);
    const unsigned ticket = handshake.ticket();
    CHECK(ticket == 1);
    CHECK(handshake.isAsking(ticket));

    // A second click on the close button - the prompt still up (the UI ignores the repeated
    // request) or dismissed with Cancel (it is the next prompt): asked again with a new
    // ticket; the first request's late answers are ignored.
    CHECK(handshake.onCloseRequested() == Action::kAsk);
    const unsigned second = handshake.ticket();
    CHECK(second == ticket + 1);
    CHECK(handshake.isAsking(second));
    CHECK_FALSE(handshake.isAsking(ticket));
    CHECK_FALSE(handshake.onTimeout(ticket, false));
    CHECK_FALSE(handshake.onUndelivered(ticket));
    CHECK(handshake.isAsking(second));
}

TEST_CASE("close handshake: app.quit allows every further close", "[close]") {
    CloseHandshake handshake;
    REQUIRE(handshake.onCloseRequested() == Action::kAsk);
    const unsigned ticket = handshake.ticket();

    handshake.allow();  // the UI finished its prompts and called app.quit
    CHECK(handshake.state() == State::kAllowed);
    CHECK_FALSE(handshake.isAsking(ticket));
    CHECK(handshake.onCloseRequested() == Action::kAllow);
    // Late answers of the asked request change nothing.
    CHECK_FALSE(handshake.onTimeout(ticket, false));
    CHECK_FALSE(handshake.onUndelivered(ticket));
    CHECK(handshake.state() == State::kAllowed);
}

TEST_CASE("close handshake: a forced close without any request is allowed at once", "[close]") {
    CloseHandshake handshake;
    handshake.allow();  // CloseAllBrowsers(true): the core stopped (app.quit) or the OS quits
    CHECK(handshake.onCloseRequested() == Action::kAllow);
}

TEST_CASE("close handshake: a request nobody can receive closes the window", "[close]") {
    CloseHandshake handshake;
    REQUIRE(handshake.onCloseRequested() == Action::kAsk);
    const unsigned ticket = handshake.ticket();

    CHECK(handshake.onUndelivered(ticket));  // no core / no UI client connected
    CHECK(handshake.state() == State::kAllowed);
    CHECK(handshake.onCloseRequested() == Action::kAllow);
}

TEST_CASE("close handshake: after the timeout a connected UI keeps the window", "[close]") {
    CloseHandshake handshake;
    REQUIRE(handshake.onCloseRequested() == Action::kAsk);
    const unsigned first = handshake.ticket();

    // The user declined the save prompt (or is still looking at it): no forced close, and the
    // next close button press asks again with a new ticket.
    CHECK_FALSE(handshake.onTimeout(first, true));
    CHECK(handshake.state() == State::kIdle);
    CHECK_FALSE(handshake.isAsking(first));
    CHECK(handshake.onCloseRequested() == Action::kAsk);
    const unsigned second = handshake.ticket();
    CHECK(second == first + 1);
    CHECK(handshake.isAsking(second));
    // The first request's late timeout is ignored; the second one is still pending.
    CHECK_FALSE(handshake.onTimeout(first, false));
    CHECK(handshake.isAsking(second));
}

TEST_CASE("close handshake: after the timeout a vanished UI lets the window close", "[close]") {
    CloseHandshake handshake;
    REQUIRE(handshake.onCloseRequested() == Action::kAsk);
    const unsigned ticket = handshake.ticket();

    CHECK(handshake.onTimeout(ticket, false));  // the page is gone: nobody will ever answer
    CHECK(handshake.state() == State::kAllowed);
    CHECK(handshake.onCloseRequested() == Action::kAllow);
}

TEST_CASE("close handshake: the answer timeout is ten seconds", "[close]") {
    CHECK(CloseHandshake::kAnswerTimeout == std::chrono::seconds(10));
}
