// macOS keyboard layouts through Text Input Services (see keyboard_layout.h; research R4.3):
// the enabled, select-capable keyboard input sources - the user's input menu - named by their
// input source id and localised name, the current one from TISCopyCurrentKeyboardInputSource,
// and TISSelectInputSource as the switch, verified by reading the current source again. Best
// effort, as the constitution sets for macOS: a non-zero OSStatus is a refusal with the status;
// noErr without a visible change (per-document input sources, an inactive application) is
// `activated: false` without a reason. Called on the main thread (the CEF UI thread). The TIS
// functions live in HIToolbox inside the Carbon umbrella framework and speak CoreFoundation
// (every reference obtained here is released by hand, no autorelease pool is needed); nothing
// needs an entitlement or the accessibility permission.

#include "keyboard_layout.h"

#import <Carbon/Carbon.h>
#include <cstring>
#include <string>
#include <vector>

namespace mfbe::shell::detail {

namespace {

std::string utf8(CFStringRef text) {
    if (text == nullptr) {
        return {};
    }
    if (const char* fast = CFStringGetCStringPtr(text, kCFStringEncodingUTF8)) {
        return fast;
    }
    const CFIndex length = CFStringGetLength(text);
    const CFIndex size = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    std::string buffer(static_cast<size_t>(size), '\0');
    if (!CFStringGetCString(text, buffer.data(), size, kCFStringEncodingUTF8)) {
        return {};
    }
    buffer.resize(std::strlen(buffer.c_str()));
    return buffer;
}

std::string stringProperty(TISInputSourceRef source, CFStringRef property) {
    return utf8(static_cast<CFStringRef>(TISGetInputSourceProperty(source, property)));
}

// The enabled, select-capable keyboard input sources (the mode-less parent of an input method
// is not select-capable and is left out). The caller releases the array; null when the system
// answers nothing.
CFArrayRef copyKeyboardSources() {
    const void* keys[] = {kTISPropertyInputSourceCategory, kTISPropertyInputSourceIsEnabled,
                          kTISPropertyInputSourceIsSelectCapable};
    const void* values[] = {kTISCategoryKeyboardInputSource, kCFBooleanTrue, kCFBooleanTrue};
    CFDictionaryRef filter =
        CFDictionaryCreate(kCFAllocatorDefault, keys, values, 3, &kCFTypeDictionaryKeyCallBacks,
                           &kCFTypeDictionaryValueCallBacks);
    if (filter == nullptr) {
        return nullptr;
    }
    CFArrayRef sources = TISCreateInputSourceList(filter, false);
    CFRelease(filter);
    return sources;
}

TISInputSourceRef sourceAt(CFArrayRef sources, CFIndex index) {
    return static_cast<TISInputSourceRef>(
        const_cast<void*>(CFArrayGetValueAtIndex(sources, index)));
}

std::string currentSourceId() {
    TISInputSourceRef current = TISCopyCurrentKeyboardInputSource();
    if (current == nullptr) {
        return {};
    }
    std::string id = stringProperty(current, kTISPropertyInputSourceID);
    CFRelease(current);
    return id;
}

}  // namespace

KeyboardLayoutListing platformListKeyboardLayouts() {
    KeyboardLayoutListing listing;
    CFArrayRef sources = copyKeyboardSources();
    if (sources == nullptr) {
        listing.reason = "unsupported";
        return listing;
    }
    const CFIndex count = CFArrayGetCount(sources);
    for (CFIndex i = 0; i < count; ++i) {
        TISInputSourceRef source = sourceAt(sources, i);
        std::string id = stringProperty(source, kTISPropertyInputSourceID);
        if (id.empty()) {
            continue;
        }
        std::string name = stringProperty(source, kTISPropertyLocalizedName);
        if (name.empty()) {
            name = id;
        }
        listing.layouts.push_back(KeyboardLayoutEntry{std::move(id), std::move(name)});
    }
    CFRelease(sources);
    if (listing.layouts.empty()) {
        listing.reason = "unsupported";
        return listing;
    }
    listing.supported = true;
    const std::string current = currentSourceId();
    if (!current.empty()) {
        listing.current = current;
    }
    return listing;
}

KeyboardLayoutOutcome platformActivateKeyboardLayout(const std::string& id,
                                                     std::uintptr_t /*windowHandle*/) {
    KeyboardLayoutOutcome outcome;
    // The source comes from a fresh list: an id the system no longer lists is not installed.
    CFArrayRef sources = copyKeyboardSources();
    if (sources == nullptr) {
        outcome.reason = "unsupported";
        return outcome;
    }
    TISInputSourceRef target = nullptr;
    const CFIndex count = CFArrayGetCount(sources);
    for (CFIndex i = 0; i < count; ++i) {
        TISInputSourceRef source = sourceAt(sources, i);
        if (stringProperty(source, kTISPropertyInputSourceID) == id) {
            target = source;
            break;
        }
    }
    if (target == nullptr) {
        CFRelease(sources);
        outcome.reason = "notInstalled";
        return outcome;
    }
    const OSStatus status = TISSelectInputSource(target);
    CFRelease(sources);
    if (status != noErr) {
        outcome.reason = "refused";
        outcome.systemCode = static_cast<long long>(status);
        return outcome;
    }
    // noErr, and the current source now is the one asked for: activated; otherwise the system
    // kept its own choice - completed, no reason (best effort).
    outcome.activated = currentSourceId() == id;
    return outcome;
}

}  // namespace mfbe::shell::detail
