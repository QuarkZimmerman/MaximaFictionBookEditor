// Linux (X11) keyboard layouts: the XKB groups of the core keyboard (see keyboard_layout.h;
// research R4.4). Every call opens a Display of its own and closes it before returning, so it may
// run on any thread and never touches Chromium's connection. The dispatch in keyboard_layout.cpp
// calls this only in an X11 session (a Wayland session is reported unsupported before).
//
// The id of a layout is the group's name ("Russian", from xkeyboard-config, English whatever the
// desktop's translation) - the one identifier that survives a reordering of the groups; the index
// is looked up in a fresh list at every request, because XkbLockGroup wraps an out-of-range index
// instead of failing. The switch is the one Alt+Shift makes under X11: the server-wide group of
// the core keyboard, which the session applies as it applies any layout switch (spec FR-092).

#include "keyboard_layout.h"

#include <string>
#include <vector>

// clang-format off: Xlib first, XKBlib depends on it
#include <X11/Xlib.h>

#include <X11/XKBlib.h>
// clang-format on

namespace mfbe::shell::detail {

namespace {

class OwnDisplay {
public:
    OwnDisplay() : display_(XOpenDisplay(nullptr)) {}
    ~OwnDisplay() {
        if (display_ != nullptr) {
            XCloseDisplay(display_);
        }
    }
    OwnDisplay(const OwnDisplay&) = delete;
    OwnDisplay& operator=(const OwnDisplay&) = delete;

    Display* get() const { return display_; }

    // True when the server speaks XKB (the version negotiation XKB clients must do first).
    bool hasXkb() const {
        if (display_ == nullptr) {
            return false;
        }
        int major = XkbMajorVersion;
        int minor = XkbMinorVersion;
        int opcode = 0;
        int event = 0;
        int error = 0;
        return XkbQueryExtension(display_, &opcode, &event, &error, &major, &minor) == True;
    }

private:
    Display* display_;
};

struct Groups {
    std::vector<std::string> names;  // one per group of the core keyboard, in group order
    int current = -1;                // the effective group, -1 when unknown
};

std::string atomName(Display* display, Atom atom, int index) {
    if (atom != 0) {
        if (char* text = XGetAtomName(display, atom)) {
            std::string name(text);
            XFree(text);
            if (!name.empty()) {
                return name;
            }
        }
    }
    return "Group " + std::to_string(index + 1);
}

// The groups of the core keyboard: names from XkbNamesMask, the count from the controls, the
// effective group from XkbGetState. Empty names when the keyboard cannot be read.
Groups readGroups(Display* display) {
    Groups groups;
    XkbDescPtr xkb = XkbGetKeyboard(display, XkbControlsMask | XkbNamesMask, XkbUseCoreKbd);
    if (xkb == nullptr) {
        // Some servers refuse the combined request: ask for the pieces.
        xkb = XkbAllocKeyboard();
        if (xkb == nullptr) {
            return groups;
        }
        xkb->dpy = display;
        xkb->device_spec = XkbUseCoreKbd;
        if (XkbGetControls(display, XkbAllControlsMask, xkb) != Success ||
            XkbGetNames(display, XkbGroupNamesMask, xkb) != Success) {
            XkbFreeKeyboard(xkb, 0, True);
            return groups;
        }
    }
    int count = 0;
    if (xkb->ctrls != nullptr) {
        count = static_cast<int>(xkb->ctrls->num_groups);
    }
    if (count <= 0 || count > XkbNumKbdGroups) {
        // No controls: count the named groups instead.
        count = 0;
        if (xkb->names != nullptr) {
            for (int i = 0; i < XkbNumKbdGroups; ++i) {
                if (xkb->names->groups[i] != 0) {
                    count = i + 1;
                }
            }
        }
    }
    for (int i = 0; i < count; ++i) {
        const Atom atom = xkb->names != nullptr ? xkb->names->groups[i] : 0;
        groups.names.push_back(atomName(display, atom, i));
    }
    XkbFreeKeyboard(xkb, 0, True);

    XkbStateRec state{};
    if (XkbGetState(display, XkbUseCoreKbd, &state) == Success) {
        groups.current = static_cast<int>(state.group);
    }
    return groups;
}

}  // namespace

KeyboardLayoutListing platformListKeyboardLayouts() {
    KeyboardLayoutListing listing;
    OwnDisplay display;
    if (!display.hasXkb()) {
        listing.reason = "noDisplay";
        return listing;
    }
    const Groups groups = readGroups(display.get());
    if (groups.names.empty()) {
        listing.reason = "noDisplay";
        return listing;
    }
    listing.supported = true;
    for (const auto& name : groups.names) {
        listing.layouts.push_back(KeyboardLayoutEntry{name, name});
    }
    if (groups.current >= 0 && groups.current < static_cast<int>(groups.names.size())) {
        listing.current = groups.names[static_cast<std::size_t>(groups.current)];
    }
    return listing;
}

KeyboardLayoutOutcome platformActivateKeyboardLayout(const std::string& id,
                                                     std::uintptr_t /*windowHandle*/) {
    KeyboardLayoutOutcome outcome;
    OwnDisplay display;
    if (!display.hasXkb()) {
        outcome.reason = "unsupported";
        return outcome;
    }
    const Groups groups = readGroups(display.get());
    int index = -1;
    for (std::size_t i = 0; i < groups.names.size(); ++i) {
        if (groups.names[i] == id) {
            index = static_cast<int>(i);
            break;
        }
    }
    if (index < 0) {
        outcome.reason = "notInstalled";  // not in the current list: nothing is locked
        return outcome;
    }
    const Bool locked = XkbLockGroup(display.get(), XkbUseCoreKbd, static_cast<unsigned>(index));
    XSync(display.get(), False);
    if (locked != True) {
        outcome.reason = "refused";
        outcome.systemCode = 0;
        return outcome;
    }
    XkbStateRec state{};
    if (XkbGetState(display.get(), XkbUseCoreKbd, &state) != Success ||
        static_cast<int>(state.group) != index) {
        outcome.reason = "refused";
        outcome.systemCode = static_cast<long long>(state.group);
        return outcome;
    }
    outcome.activated = true;
    return outcome;
}

}  // namespace mfbe::shell::detail
