// macOS file dialogs (best effort, decision D14): NSOpenPanel / NSSavePanel as a sheet of the
// editor window, with an accessory view holding the file-type pop-up (it switches
// allowedContentTypes; macOS matches extensions without regard to letter case) and, for Save As,
// the encoding pop-up; the folder and name of the request. Compiled with ARC.
#include "file_dialog_platform.h"

#import <Cocoa/Cocoa.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <memory>
#include <string>
#include <utility>
#include <vector>

// Target of the file-type pop-up (a control does not retain its target: the panel's completion
// handler keeps it alive).
@interface MFBEFileTypeSwitch : NSObject
@property(nonatomic, weak) NSSavePanel* panel;
@property(nonatomic, strong) NSArray<NSArray<UTType*>*>* typesPerFilter;
- (void)typeChosen:(NSPopUpButton*)sender;
@end

@implementation MFBEFileTypeSwitch
- (void)typeChosen:(NSPopUpButton*)sender {
    const NSInteger index = sender.indexOfSelectedItem;
    if (index >= 0 && index < static_cast<NSInteger>(self.typesPerFilter.count)) {
        self.panel.allowedContentTypes = self.typesPerFilter[static_cast<NSUInteger>(index)];
    }
}
@end

namespace mfbe::shell {

namespace {

NSString* toNSString(const std::string& utf8) {
    NSString* text = [[NSString alloc] initWithBytes:utf8.data()
                                              length:utf8.size()
                                            encoding:NSUTF8StringEncoding];
    return text != nil ? text : @"";
}

std::string pathOf(NSURL* url) {
    const char* path = url != nil ? url.fileSystemRepresentation : nullptr;
    return path != nullptr ? std::string(path) : std::string();
}

NSArray<UTType*>* contentTypes(const FileFilter& filter) {
    NSMutableArray<UTType*>* types = [NSMutableArray array];
    for (const auto& extension : macExtensions(filter)) {
        if (UTType* type = [UTType typeWithFilenameExtension:toNSString(extension)]) {
            [types addObject:type];
        }
    }
    return types;  // empty: any file
}

NSWindow* ownerWindow(std::uintptr_t owner) {
    if (owner == 0) {
        return nil;
    }
    id handle = (__bridge id) reinterpret_cast<void*>(owner);
    if ([handle isKindOfClass:[NSView class]]) {
        NSView* view = handle;
        return view.window;
    }
    if ([handle isKindOfClass:[NSWindow class]]) {
        NSWindow* window = handle;
        return window;
    }
    return nil;
}

NSURL* folderURL(const std::string& folder) {
    return [NSURL fileURLWithPath:toNSString(folder) isDirectory:YES];
}

}  // namespace

bool runPlatformFileDialog(std::uintptr_t owner, const FileDialogRequest& request,
                           FileDialogCallback done, std::string* why) {
    const FileDialogMode mode = request.mode;
    NSOpenPanel* open = nil;
    NSSavePanel* panel = nil;
    if (mode == FileDialogMode::kSave) {
        panel = [NSSavePanel savePanel];
        panel.canCreateDirectories = YES;
        panel.allowsOtherFileTypes = YES;
    } else {
        open = [NSOpenPanel openPanel];
        open.canChooseFiles = mode != FileDialogMode::kFolder;
        open.canChooseDirectories = mode == FileDialogMode::kFolder;
        open.canCreateDirectories = mode == FileDialogMode::kFolder;
        open.allowsMultipleSelection = mode == FileDialogMode::kOpenMultiple;
        panel = open;
    }
    if (panel == nil) {
        if (why != nullptr) {
            *why = "no NSOpenPanel / NSSavePanel";
        }
        return false;
    }
    if (!request.title.empty()) {
        panel.title = toNSString(request.title);
        panel.message = toNSString(request.title);  // sheets show the message, not the title
    }

    NSMutableArray<NSView*>* rows = [NSMutableArray array];
    MFBEFileTypeSwitch* type_switch = nil;
    if (mode != FileDialogMode::kFolder && !request.filters.empty()) {
        NSMutableArray<NSArray<UTType*>*>* types = [NSMutableArray array];
        NSPopUpButton* type_popup = [[NSPopUpButton alloc] initWithFrame:NSZeroRect pullsDown:NO];
        for (const auto& filter : request.filters) {
            [type_popup addItemWithTitle:toNSString(filter.name)];
            [types addObject:contentTypes(filter)];
        }
        const NSUInteger selected = selectedFilterIndex(request);
        [type_popup selectItemAtIndex:static_cast<NSInteger>(selected)];
        type_switch = [[MFBEFileTypeSwitch alloc] init];
        type_switch.panel = panel;
        type_switch.typesPerFilter = types;
        type_popup.target = type_switch;
        type_popup.action = @selector(typeChosen:);
        panel.allowedContentTypes = types[selected];
        [rows addObject:type_popup];
    }
    NSPopUpButton* encoding_popup = nil;
    if (mode == FileDialogMode::kSave && !request.encodings.empty()) {
        encoding_popup = [[NSPopUpButton alloc] initWithFrame:NSZeroRect pullsDown:NO];
        for (const auto& encoding : request.encodings) {
            [encoding_popup addItemWithTitle:toNSString(encoding)];
        }
        [encoding_popup selectItemAtIndex:static_cast<NSInteger>(selectedEncodingIndex(request))];
        NSTextField* label = [NSTextField labelWithString:toNSString(request.encoding_label)];
        NSStackView* row = [NSStackView stackViewWithViews:@[ label, encoding_popup ]];
        row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
        [rows addObject:row];
    }
    if (rows.count > 0) {
        NSStackView* accessory = [NSStackView stackViewWithViews:rows];
        accessory.orientation = NSUserInterfaceLayoutOrientationVertical;
        accessory.edgeInsets = NSEdgeInsetsMake(8, 16, 8, 16);
        [accessory setFrameSize:accessory.fittingSize];
        panel.accessoryView = accessory;
        if (open != nil) {
            open.accessoryViewDisclosed = YES;
        }
    }

    // The proposed file: its folder, its name in the name field (save panels show it).
    const ProposedFile file = proposedFile(request);
    if (!file.folder.empty()) {
        panel.directoryURL = folderURL(file.folder);
    }
    if (!file.name.empty()) {
        panel.nameFieldStringValue = toNSString(file.name);
    }

    auto callback = std::make_shared<FileDialogCallback>(std::move(done));
    void (^finish)(NSModalResponse) = ^(NSModalResponse response) {
      FileDialogResult result;
      if (response == NSModalResponseOK) {
          if (open != nil) {
              for (NSURL* url in open.URLs) {
                  std::string path = pathOf(url);
                  if (!path.empty()) {
                      result.paths.push_back(std::move(path));
                  }
              }
          } else {
              std::string path = pathOf(panel.URL);
              if (!path.empty()) {
                  result.paths.push_back(std::move(path));
              }
          }
          if (encoding_popup != nil && encoding_popup.titleOfSelectedItem != nil) {
              result.encoding = encoding_popup.titleOfSelectedItem.UTF8String;
          }
      }
      (void)type_switch;  // the pop-up's target lives as long as the panel
      result.cancelled = result.paths.empty();
      (*callback)(std::move(result));
    };
    if (NSWindow* window = ownerWindow(owner)) {
        [panel beginSheetModalForWindow:window completionHandler:finish];
    } else {
        finish([panel runModal]);
    }
    return true;
}

}  // namespace mfbe::shell
