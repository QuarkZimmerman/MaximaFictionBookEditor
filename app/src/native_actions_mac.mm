// macOS clipboard image reader (T139) and system beep; the rest of native_actions.h is in
// native_actions.cpp.

#include "native_actions.h"

#import <Cocoa/Cocoa.h>

namespace mfbe::shell {

namespace {

std::string toBytes(NSData* data) {
    if (data == nil || [data length] == 0) {
        return {};
    }
    return std::string(static_cast<const char*>([data bytes]), [data length]);
}

}  // namespace

std::optional<ClipboardImageData> readClipboardImage() {
    @autoreleasepool {
        NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
        if (pasteboard == nil) {
            return std::nullopt;
        }
        // PNG as provided by the source application (byte-identical).
        std::string png = toBytes([pasteboard dataForType:NSPasteboardTypePNG]);
        if (!png.empty()) {
            return ClipboardImageData{std::move(png), "image/png"};
        }
        // TIFF (screenshots, most Cocoa apps): re-encode as PNG.
        NSData* tiff = [pasteboard dataForType:NSPasteboardTypeTIFF];
        if (tiff != nil && [tiff length] > 0) {
            NSBitmapImageRep* rep = [NSBitmapImageRep imageRepWithData:tiff];
            if (rep != nil) {
                NSData* encoded = [rep representationUsingType:NSBitmapImageFileTypePNG
                                                    properties:@{}];
                std::string bytes = toBytes(encoded);
                if (!bytes.empty()) {
                    return ClipboardImageData{std::move(bytes), "image/png"};
                }
            }
        }
        // A copied image file (Finder): read it as is; the core sniffs the format.
        NSArray<NSURL*>* urls =
            [pasteboard readObjectsForClasses:@[ [NSURL class] ]
                                      options:@{
                                          NSPasteboardURLReadingFileURLsOnlyKey : @YES
                                      }];
        for (NSURL* url in urls) {
            NSString* extension = [[url pathExtension] lowercaseString];
            if ([@[ @"png", @"jpg", @"jpeg", @"gif", @"bmp", @"webp", @"tif", @"tiff" ]
                    containsObject:extension]) {
                std::string bytes = toBytes([NSData dataWithContentsOfURL:url]);
                if (!bytes.empty()) {
                    return ClipboardImageData{std::move(bytes), ""};
                }
            }
        }
        return std::nullopt;
    }
}

void systemBeep() {
    NSBeep();
}

}  // namespace mfbe::shell
