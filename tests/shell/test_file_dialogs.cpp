// Feature 002 (spec FR-010 to FR-013, decision D14): how the shell turns a file dialog request
// into each platform's dialog - Windows filter specs and the 1-based type index, GTK patterns
// that ignore letter case, macOS extension lists, the Save As folder, name and encoding choice,
// and CEF's accept filters for the fallback dialog.
#include "file_dialog_request.h"

#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

using namespace mfbe::shell;

namespace {

// The editor's Open / Save As types (spec FR-010).
std::vector<FileFilter> documentTypes() {
    return {{"FictionBook files (*.fb2)", {"fb2"}},
            {"FictionBook descriptors (*.fbd)", {"fbd"}},
            {"All files (*.*)", {"*"}}};
}

// Image insertion and the cover image file.
std::vector<FileFilter> imageTypes() {
    return {{"Supported images (*.jpg;*.jpeg;*.png)", {"jpg", "jpeg", "png"}},
            {"JPEG (*.jpg)", {"jpg"}},
            {"PNG (*.png)", {"png"}},
            {"Bitmap (*.bmp)", {"bmp"}},
            {"GIF (*.gif)", {"gif"}},
            {"TIFF (*.tif)", {"tif"}},
            {"WebP (*.webp)", {"webp"}}};
}

FileDialogRequest request(FileDialogMode mode, std::vector<FileFilter> filters, int selected) {
    FileDialogRequest r;
    r.mode = mode;
    r.filters = std::move(filters);
    r.selected_filter = selected;
    return r;
}

}  // namespace

TEST_CASE("file dialogs: the selected type is the request's when it names one, else the first",
          "[shell][dialogs]") {
    CHECK(selectedFilterIndex(request(FileDialogMode::kOpen, documentTypes(), 0)) == 0);
    CHECK(selectedFilterIndex(request(FileDialogMode::kSave, documentTypes(), 1)) == 1);
    CHECK(selectedFilterIndex(request(FileDialogMode::kSave, documentTypes(), 2)) == 2);
    CHECK(selectedFilterIndex(request(FileDialogMode::kOpen, documentTypes(), 3)) == 0);
    CHECK(selectedFilterIndex(request(FileDialogMode::kOpen, documentTypes(), -1)) == 0);
    CHECK(selectedFilterIndex(request(FileDialogMode::kOpen, {}, 2)) == 0);
}

TEST_CASE("file dialogs: extensions travel without the dot; '*' lists every file",
          "[shell][dialogs]") {
    CHECK(bareExtension("fb2") == "fb2");
    CHECK(bareExtension(".fb2") == "fb2");
    CHECK(bareExtension("*.fb2") == "fb2");
    CHECK(bareExtension("*") == "*");
    CHECK(bareExtension("*.*") == "*");
    CHECK(bareExtension("") == "*");
    CHECK(listsAllFiles(FileFilter{"All files (*.*)", {"*"}}));
    CHECK(listsAllFiles(FileFilter{"Anything", {}}));
    CHECK_FALSE(listsAllFiles(FileFilter{"FictionBook files (*.fb2)", {"fb2"}}));
}

TEST_CASE("file dialogs: Windows type specs and the 1-based type index", "[shell][dialogs]") {
    const std::vector<FileFilter> documents = documentTypes();
    CHECK(windowsFilterSpec(documents[0]) == "*.fb2");
    CHECK(windowsFilterSpec(documents[1]) == "*.fbd");
    CHECK(windowsFilterSpec(documents[2]) == "*.*");
    const std::vector<FileFilter> images = imageTypes();
    CHECK(windowsFilterSpec(images[0]) == "*.jpg;*.jpeg;*.png");
    CHECK(windowsFilterSpec(images[5]) == "*.tif");
    CHECK(windowsFilterSpec(FileFilter{"Dictionaries (*.dic)", {".dic"}}) == "*.dic");

    CHECK(windowsFileTypeIndex(request(FileDialogMode::kOpen, documents, 0)) == 1);
    // Save As of a descriptor (.fbd) document.
    CHECK(windowsFileTypeIndex(request(FileDialogMode::kSave, documents, 1)) == 2);
    // Add Binary Object: "All files" first, "Supported images" selected (the original's
    // nFilterIndex = 2).
    std::vector<FileFilter> binaries{{"All files (*.*)", {"*"}}};
    binaries.insert(binaries.end(), images.begin(), images.end());
    CHECK(windowsFileTypeIndex(request(FileDialogMode::kOpenMultiple, binaries, 1)) == 2);
    CHECK(windowsFileTypeIndex(request(FileDialogMode::kOpen, documents, 7)) == 1);
}

TEST_CASE("file dialogs: a name typed without an extension gets the selected type's",
          "[shell][dialogs]") {
    CHECK(defaultExtension(request(FileDialogMode::kSave, documentTypes(), 0)) == "fb2");
    CHECK(defaultExtension(request(FileDialogMode::kSave, documentTypes(), 1)) == "fbd");
    CHECK(defaultExtension(request(FileDialogMode::kSave, documentTypes(), 2)).empty());
    CHECK(defaultExtension(request(FileDialogMode::kOpen, documentTypes(), 0)).empty());
    const std::vector<FileFilter> saved_image{{"JPEG files (*.jpg)", {"jpg"}},
                                              {"PNG files (*.png)", {"png"}},
                                              {"All files (*.*)", {"*"}}};
    CHECK(defaultExtension(request(FileDialogMode::kSave, saved_image, 0)) == "jpg");
    CHECK(defaultExtension(request(FileDialogMode::kSave, {}, 0)).empty());
}

TEST_CASE("file dialogs: GTK patterns match extensions in any letter case", "[shell][dialogs]") {
    CHECK(gtkPattern("fb2") == "*.[fF][bB]2");
    CHECK(gtkPattern(".FBD") == "*.[fF][bB][dD]");
    CHECK(gtkPattern("*.tif") == "*.[tT][iI][fF]");
    CHECK(gtkPattern("*") == "*");
    CHECK(gtkPatterns(imageTypes()[0]) ==
          std::vector<std::string>{"*.[jJ][pP][gG]", "*.[jJ][pP][eE][gG]", "*.[pP][nN][gG]"});
    CHECK(gtkPatterns(FileFilter{"All files (*.*)", {"*"}}) == std::vector<std::string>{"*"});
}

TEST_CASE("file dialogs: macOS extension lists are lower case; all files is an empty list",
          "[shell][dialogs]") {
    CHECK(macExtensions(FileFilter{"FictionBook files (*.fb2)", {"FB2"}}) ==
          std::vector<std::string>{"fb2"});
    CHECK(macExtensions(imageTypes()[0]) == std::vector<std::string>{"jpg", "jpeg", "png"});
    CHECK(macExtensions(FileFilter{"All files (*.*)", {"*"}}).empty());
}

TEST_CASE("file dialogs: a dialog opens on the proposed file, or the folder last used with no name",
          "[shell][dialogs]") {
    FileDialogRequest saved = request(FileDialogMode::kSave, documentTypes(), 0);
    saved.default_path = "/книги/Толстой/Война и мир.fb2";
    saved.folder = "/ignored";
    const ProposedFile current = proposedFile(saved);
    CHECK(current.folder == "/книги/Толстой");
    CHECK(current.name == "Война и мир.fb2");

    FileDialogRequest never_saved = request(FileDialogMode::kSave, documentTypes(), 0);
    never_saved.folder = "/книги";
    const ProposedFile last_used = proposedFile(never_saved);
    CHECK(last_used.folder == "/книги");
    CHECK(last_used.name.empty());

    // Save image as: the image's name in the folder the core gave.
    FileDialogRequest image = request(FileDialogMode::kSave, {}, 0);
    image.default_path = "обложка.jpg";
    image.folder = "/книги";
    const ProposedFile named = proposedFile(image);
    CHECK(named.folder == "/книги");
    CHECK(named.name == "обложка.jpg");
    image.folder.clear();
    CHECK(proposedFile(image).folder.empty());
    CHECK(proposedFile(image).name == "обложка.jpg");

    // Save As of a never-saved document (feature 004, FR-050): the name composed from the
    // description - letters, spaces and a hyphen, no separator - travels as a bare name into
    // the folder the core gave, untouched on every platform.
    FileDialogRequest composed = request(FileDialogMode::kSave, documentTypes(), 0);
    composed.default_path = "Толстой Лев - Война и мир.fb2";
    composed.folder = "/книги";
    const ProposedFile proposed = proposedFile(composed);
    CHECK(proposed.folder == "/книги");
    CHECK(proposed.name == "Толстой Лев - Война и мир.fb2");
    composed.folder.clear();
    CHECK(proposedFile(composed).folder.empty());
    CHECK(proposedFile(composed).name == "Толстой Лев - Война и мир.fb2");

    // Open proposing a file (the custom dictionary): its folder and name.
    FileDialogRequest dictionary =
        request(FileDialogMode::kOpen, {{"Dictionaries (*.dic)", {"dic"}}}, 0);
    dictionary.default_path = "/home/пользователь/словари/мой.dic";
    const ProposedFile dic = proposedFile(dictionary);
    CHECK(dic.folder == "/home/пользователь/словари");
    CHECK(dic.name == "мой.dic");
    // Open without one: the folder the core gave, no name.
    FileDialogRequest open = request(FileDialogMode::kOpen, documentTypes(), 0);
    open.folder = "/книги";
    CHECK(proposedFile(open).folder == "/книги");
    CHECK(proposedFile(open).name.empty());
}

TEST_CASE("file dialogs: the Save As encoding choice - label, items, the selected one",
          "[shell][dialogs]") {
    CHECK(encodingLabel("ru") == "Кодировка:");
    CHECK(encodingLabel("ru-RU") == "Кодировка:");
    CHECK(encodingLabel("uk") == "Кодування:");
    CHECK(encodingLabel("en") == "Encoding:");
    CHECK(encodingLabel("") == "Encoding:");

    // The original's order with the document's encoding selected.
    FileDialogRequest save = request(FileDialogMode::kSave, documentTypes(), 0);
    save.encodings = {"utf-8", "utf-16", "windows-1251", "koi8-r"};
    CHECK(selectedEncodingIndex(save) == 0);  // none named: the first
    save.selected_encoding = "windows-1251";
    CHECK(selectedEncodingIndex(save) == 2);
    save.selected_encoding = "koi8-r";
    CHECK(selectedEncodingIndex(save) == 3);
    save.selected_encoding = "iso-8859-5";  // not offered: the first
    CHECK(selectedEncodingIndex(save) == 0);
    CHECK(encodingOfItem(save, kEncodingItemBase) == "utf-8");
    CHECK(encodingOfItem(save, kEncodingItemBase + 2) == "windows-1251");
    CHECK(encodingOfItem(save, kEncodingItemBase + 3) == "koi8-r");
    CHECK(encodingOfItem(save, kEncodingItemBase + 4).empty());
    CHECK(encodingOfItem(save, kEncodingItemBase - 1).empty());
}

TEST_CASE("file dialogs: CEF's fallback dialog gets the selected type's extensions",
          "[shell][dialogs]") {
    CHECK(cefAcceptFilters(request(FileDialogMode::kOpen, documentTypes(), 0)) ==
          std::vector<std::string>{".fb2"});
    CHECK(cefAcceptFilters(request(FileDialogMode::kOpen, imageTypes(), 0)) ==
          std::vector<std::string>{".jpg", ".jpeg", ".png"});
    CHECK(cefAcceptFilters(request(FileDialogMode::kSave, documentTypes(), 2)).empty());
    CHECK(cefAcceptFilters(request(FileDialogMode::kOpen, {}, 0)).empty());
}
