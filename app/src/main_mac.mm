// macOS entry point of the `mfbe` desktop shell (adapted from CEF's tests/cefsimple/
// cefsimple_mac.mm). Sub-processes run from the "mfbe Helper*.app" bundles (helper_main.cpp).
//
// Finder double-click / "Open with" / Dock drops arrive as application:openFiles: events
// (Launch Services keeps one instance per bundle, so this is also the macOS single-instance
// path) and are forwarded to the running core through forwardOpenPaths (app.openPaths).

#include "include/cef_application_mac.h"
#include "include/cef_command_line.h"
#include "include/wrapper/cef_helpers.h"
#include "include/wrapper/cef_library_loader.h"
#include "mfbe_client.h"
#include "shell_runner.h"

#import <Cocoa/Cocoa.h>
#include <string>
#include <vector>

// Receives notifications from the application.
@interface MfbeAppDelegate : NSObject <NSApplicationDelegate>
- (void)createApplication:(id)object;
- (void)tryToTerminateApplication:(NSApplication*)app;
@end

// Provide the CefAppProtocol implementation required by CEF.
@interface MfbeApplication : NSApplication <CefAppProtocol> {
@private
    BOOL handlingSendEvent_;
}
@end

@implementation MfbeApplication
- (BOOL)isHandlingSendEvent {
    return handlingSendEvent_;
}

- (void)setHandlingSendEvent:(BOOL)handlingSendEvent {
    handlingSendEvent_ = handlingSendEvent;
}

- (void)sendEvent:(NSEvent*)event {
    CefScopedSendingEvent sendingEventScoper;
    [super sendEvent:event];
}

// |-terminate:| is the entry point for orderly "quit" operations in Cocoa (application menu,
// Dock menu, logout). Chromium must leave the main run loop to shut down, so instead of
// exit() we ask the delegate to close all browsers; the last OnBeforeClose quits the CEF
// message loop and control returns to main().
- (void)terminate:(id)sender {
    MfbeAppDelegate* delegate = static_cast<MfbeAppDelegate*>([NSApp delegate]);
    [delegate tryToTerminateApplication:self];
    // Return, don't exit. The application is responsible for exiting on its own.
}
@end

@implementation MfbeAppDelegate

// Create the application menu on the UI thread (no nib: a minimal application menu with the
// standard Quit item; the editor's own menus live in the web UI).
- (void)createApplication:(id)object {
    NSMenu* main_menu = [[NSMenu alloc] initWithTitle:@""];
    NSMenuItem* app_item = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    NSMenu* app_menu = [[NSMenu alloc] initWithTitle:@"mfbe"];
    [app_menu addItemWithTitle:@"Quit Maxima Fiction Book Editor"
                        action:@selector(terminate:)
                 keyEquivalent:@"q"];
    [app_item setSubmenu:app_menu];
    [main_menu addItem:app_item];
    [NSApp setMainMenu:main_menu];

    // Set the delegate for application events.
    [[NSApplication sharedApplication] setDelegate:self];
}

- (void)tryToTerminateApplication:(NSApplication*)app {
    mfbe::shell::MfbeClient* client = mfbe::shell::MfbeClient::GetInstance();
    if (client && !client->IsClosing()) {
        client->CloseAllBrowsers(false);
    }
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication*)sender {
    return NSTerminateNow;
}

// Called when the user clicks the app dock icon while the application is already running.
- (BOOL)applicationShouldHandleReopen:(NSApplication*)theApplication hasVisibleWindows:(BOOL)flag {
    mfbe::shell::MfbeClient* client = mfbe::shell::MfbeClient::GetInstance();
    if (client && !client->IsClosing()) {
        client->ShowMainWindow();
    }
    return NO;
}

// Documents opened from the Finder (double-click, "Open with", drop on the Dock icon), at
// launch or while running.
- (void)application:(NSApplication*)sender openFiles:(NSArray<NSString*>*)filenames {
    std::vector<std::string> paths;
    for (NSString* name in filenames) {
        if ([name length] > 0) {
            paths.emplace_back([name fileSystemRepresentation]);
        }
    }
    mfbe::shell::forwardOpenPaths(paths);
    [sender replyToOpenOrPrint:NSApplicationDelegateReplySuccess];
}

// Requests that any state restoration archive be created with secure encoding (macOS 12+).
- (BOOL)applicationSupportsSecureRestorableState:(NSApplication*)app {
    return YES;
}
@end

namespace {

MfbeAppDelegate* g_delegate = nil;

void InstallAppDelegate() {
    g_delegate = [[MfbeAppDelegate alloc] init];
    NSApp.delegate = g_delegate;
    [g_delegate performSelectorOnMainThread:@selector(createApplication:)
                                 withObject:nil
                              waitUntilDone:NO];
}

void ReleaseAppDelegate() {
#if !__has_feature(objc_arc)
    [g_delegate release];
#endif
    g_delegate = nil;
}

}  // namespace

// Entry point function for the browser process.
int main(int argc, char* argv[]) {
    // Load the CEF framework library at runtime instead of linking directly as required by
    // the macOS sandbox implementation.
    CefScopedLibraryLoader library_loader;
    if (!library_loader.LoadInMain()) {
        return 1;
    }

    // Provide CEF with command-line arguments.
    CefMainArgs main_args(argc, argv);

    int exit_code = 0;
    @autoreleasepool {
        // Initialize the MfbeApplication instance.
        [MfbeApplication sharedApplication];

        // If there was an invocation to NSApp prior to this method, then the NSApp will not be
        // a MfbeApplication, but will instead be an NSApplication. Enforce that this does not
        // happen.
        CHECK([NSApp isKindOfClass:[MfbeApplication class]]);

        mfbe::shell::RunHooks hooks;
        hooks.after_cef_initialized = &InstallAppDelegate;
        hooks.after_shutdown = &ReleaseAppDelegate;
        exit_code = mfbe::shell::runBrowserProcess(main_args, argc, argv, nullptr, hooks);
    }  // @autoreleasepool

    return exit_code;
}
