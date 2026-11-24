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

// Target of the file-type pop-up and of the ZIP box (a control does not retain its target: the
// panel's completion handler keeps it alive). The file name and type follow the box (the requester
// after his smoke test of 0.0.12-rc.4): its toggle renames the file and selects the ZIP type or
// the plain one; choosing the ZIP type ticks the box, another type unticks it.
@interface MFBEFileTypeSwitch : NSObject
@property(nonatomic, weak) NSSavePanel* panel;
@property(nonatomic, strong) NSArray<NSArray<UTType*>*>* typesPerFilter;
@property(nonatomic, weak) NSPopUpButton* typePopup;
@property(nonatomic, weak) NSButton* zipBox;
- (void)followRequest:(const mfbe::shell::FileDialogRequest&)request;
- (void)typeChosen:(NSPopUpButton*)sender;
- (void)zipToggled:(NSButton*)sender;
- (void)selectChosen:(NSPopUpButton*)sender;
@end

@implementation MFBEFileTypeSwitch {
    mfbe::shell::FileDialogRequest _request;
    std::string _activePlainExt;
}
- (void)followRequest:(const mfbe::shell::FileDialogRequest&)request {
    _request = request;
    _activePlainExt = mfbe::shell::activeSelectExtension(request);
}
- (void)showType:(NSInteger)index {
    if (index >= 0 && index < static_cast<NSInteger>(self.typesPerFilter.count)) {
        self.panel.allowedContentTypes = self.typesPerFilter[static_cast<NSUInteger>(index)];
    }
}
- (void)renameFor:(BOOL)zip {
    NSString* name = self.panel.nameFieldStringValue;
    if (name.length == 0) {
        return;
    }
    const std::string renamed =
        _activePlainExt.empty()
            ? mfbe::shell::zipFollowName(_request, std::string(name.UTF8String), zip)
            : mfbe::shell::selectFollowName(_request, std::string(name.UTF8String), _activePlainExt,
                                            zip);
    NSString* shown = [NSString stringWithUTF8String:renamed.c_str()];
    if (shown != nil && ![shown isEqualToString:name]) {
        self.panel.nameFieldStringValue = shown;
    }
}
- (void)selectChosen:(NSPopUpButton*)sender {
    const NSInteger selIdx = sender.tag;
    const NSInteger choiceIdx = sender.indexOfSelectedItem;
    if (selIdx < 0 || static_cast<std::size_t>(selIdx) >= _request.selects.size() ||
        choiceIdx < 0) {
        return;
    }
    const auto& sel = _request.selects[static_cast<std::size_t>(selIdx)];
    if (static_cast<std::size_t>(choiceIdx) >= sel.choices.size()) {
        return;
    }
    const std::string& ext = sel.choices[static_cast<std::size_t>(choiceIdx)].extension;
    if (ext.empty()) {
        return;
    }
    _activePlainExt = mfbe::shell::bareExtension(ext);
    const BOOL zip = self.zipBox != nil && self.zipBox.state == NSControlStateValueOn;
    if (!zip) {
        [self renameFor:NO];
        if (self.typePopup != nil) {
            const NSInteger index = static_cast<NSInteger>(
                mfbe::shell::selectFollowFilter(_request, _activePlainExt, false));
            [self.typePopup selectItemAtIndex:index];
            [self showType:index];
        }
    }
}
- (void)typeChosen:(NSPopUpButton*)sender {
    const NSInteger index = sender.indexOfSelectedItem;
    [self showType:index];
    if (self.zipBox == nil || _request.zip_filter < 0 || index < 0) {
        return;
    }
    const BOOL zip = index == _request.zip_filter;
    if ((self.zipBox.state == NSControlStateValueOn) != zip) {
        self.zipBox.state = zip ? NSControlStateValueOn : NSControlStateValueOff;
        [self renameFor:zip];
    }
}
- (void)zipToggled:(NSButton*)sender {
    const BOOL zip = sender.state == NSControlStateValueOn;
    [self renameFor:zip];
    if (self.typePopup != nil && _request.zip_filter >= 0) {
        const NSInteger index = static_cast<NSInteger>(
            _activePlainExt.empty()
                ? mfbe::shell::zipFollowFilter(_request, zip)
                : mfbe::shell::selectFollowFilter(_request, _activePlainExt, zip));
        [self.typePopup selectItemAtIndex:index];
        [self showType:index];
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
        type_switch.typePopup = type_popup;
        [type_switch followRequest:request];
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
    // Feature 018 (DP-5): select dropdowns inside the Save accessory view.
    NSMutableArray<NSPopUpButton*>* select_popups = [NSMutableArray array];
    NSMutableArray<NSStackView*>* select_rows = [NSMutableArray array];
    std::vector<std::string> select_ids;
    std::vector<std::vector<std::string>> select_values;
    if (mode == FileDialogMode::kSave && !request.selects.empty()) {
        if (type_switch == nil) {
            type_switch = [[MFBEFileTypeSwitch alloc] init];
            type_switch.panel = panel;
            [type_switch followRequest:request];
        }
        for (std::size_t s = 0; s < request.selects.size(); ++s) {
            const auto& sel = request.selects[s];
            if (sel.choices.empty()) {
                continue;
            }
            NSPopUpButton* popup = [[NSPopUpButton alloc] initWithFrame:NSZeroRect pullsDown:NO];
            std::vector<std::string> values;
            for (const auto& ch : sel.choices) {
                [popup addItemWithTitle:toNSString(ch.label)];
                values.push_back(ch.value);
            }
            [popup selectItemAtIndex:static_cast<NSInteger>(selectedSelectChoiceIndex(sel))];
            popup.tag = static_cast<NSInteger>(s);
            popup.target = type_switch;
            popup.action = @selector(selectChosen:);
            NSTextField* label = [NSTextField labelWithString:toNSString(sel.label)];
            NSStackView* row = [NSStackView stackViewWithViews:@[ label, popup ]];
            row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
            row.alignment = NSLayoutAttributeCenterY;
            row.spacing = 8;
            [select_popups addObject:popup];
            [select_rows addObject:row];
            select_ids.push_back(sel.id);
            select_values.push_back(std::move(values));
            [rows addObject:row];
        }
    }
    // Feature 009 (DP-8): the "save as ZIP archive" checkbox; shares the row with a lone select
    // dropdown (MOBI export) so the Save sheet stays compact and aligned.
    NSButton* zip_box = nil;
    if (mode == FileDialogMode::kSave && !request.zip_label.empty()) {
        zip_box = [NSButton checkboxWithTitle:toNSString(request.zip_label) target:nil action:nil];
        zip_box.state = request.zip_checked ? NSControlStateValueOn : NSControlStateValueOff;
        if (request.zip_rename != FileDialogRequest::ZipRename::kNone) {
            if (type_switch == nil) {
                type_switch = [[MFBEFileTypeSwitch alloc] init];
                type_switch.panel = panel;
                [type_switch followRequest:request];
            }
            type_switch.zipBox = zip_box;
            zip_box.target = type_switch;
            zip_box.action = @selector(zipToggled:);
        }
        if (select_rows.count == 1 && encoding_popup == nil && request.checks.empty()) {
            [select_rows[0] addArrangedSubview:zip_box];
        } else {
            [rows addObject:zip_box];
        }
    }
    // Feature 017 / Feature 020: checkboxes in both Save and Open accessory views.
    NSMutableArray<NSButton*>* check_boxes = [NSMutableArray array];
    std::vector<std::string>
        check_ids;  // copied into the completion block (the request may not outlive it)
    if (mode != FileDialogMode::kFolder) {
        for (const auto& check : request.checks) {
            check_ids.push_back(check.id);
            NSButton* box = [NSButton checkboxWithTitle:toNSString(check.label)
                                                 target:nil
                                                 action:nil];
            box.state = check.checked ? NSControlStateValueOn : NSControlStateValueOff;
            [check_boxes addObject:box];
            [rows addObject:box];
        }
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
          if (zip_box != nil) {
              result.zip = zip_box.state == NSControlStateValueOn ? 1 : 0;
          }
          if (check_boxes.count > 0) {
              for (NSUInteger k = 0; k < check_boxes.count; ++k) {
                  result.checks.emplace_back(check_ids[k],
                                             check_boxes[k].state == NSControlStateValueOn);
              }
              result.checks_shown = true;
          }
          if (select_popups.count > 0) {
              for (NSUInteger k = 0; k < select_popups.count; ++k) {
                  const NSInteger idx = select_popups[k].indexOfSelectedItem;
                  const auto& vals = select_values[k];
                  if (idx >= 0 && static_cast<std::size_t>(idx) < vals.size()) {
                      result.selects.emplace_back(select_ids[k],
                                                  vals[static_cast<std::size_t>(idx)]);
                  }
              }
              result.selects_shown = true;
          }
      }
      (void)type_switch;  // the pop-up's and the ZIP box's target lives as long as the panel
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
