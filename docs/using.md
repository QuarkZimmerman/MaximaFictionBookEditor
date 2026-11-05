# Using Maxima Fiction Book Editor

Short notes on features that are not obvious from the menus. Installing and the command line:
[installing.md](installing.md).

## Several books at once

Start the editor again to open a second window with a new document; each window is a copy of
its own, with its own book and undo history. A book opened from the file manager while the
editor runs goes to the window you used last: an untouched new document takes it at once,
otherwise the window asks whether to open it there or in a new window (*New window* is the
default). A book that is already open is never opened twice - its window comes to the front.
*Settings > Other* remembers how a book from outside should open.

## Backups

Saving over a book keeps its previous version beside it as `<name>.bak` - one backup, replaced
by the next save. *Settings > Other > Keep Backup Copy of the Previous Version (.bak)* turns
it off. When
the backup cannot be made the book is still saved, and the status bar says so.

## Books in ZIP archives

A `.zip` (or `.fb2.zip`) opens like a book, by every route: *File > Open*, the file manager,
the command line, dragging it onto the window and *Recent files*. An archive with several books
asks which one to open; each book of an archive has its own entry in *Recent files*, and the
window title shows the book with its archive. The editor never writes into an archive behind
your back: saving a book from an archive always opens *Save As*, whose *Save as ZIP archive*
box (ticked for such a book) puts it into a ZIP archive; replacing an archive that holds other
files asks first, so nothing in it is lost without a word.

## Notes and links

Resting the pointer on a note mark for half a second shows the note's text in a tooltip.
Ctrl+click (Cmd+click on macOS) on a link follows it: a link inside the book jumps there, a web
address opens in the system's browser. *Edit > Go to footnote or reference* (Ctrl+Backspace,
Cmd+Backspace on macOS) then returns to the link the jump started from.

## Paste as plain text

*Edit > Paste as plain text* (Ctrl+Shift+V, Cmd+Shift+V on macOS) pastes only the clipboard's
text: lines become paragraphs, without formatting, links, pictures or tables, in one undo step.
It is also in the context menus, next to *Paste*.

## The status bar

Besides the message, the element path and INS/OVR, the status bar shows the line and column (in
the Source view), the counts of the selection, the character before the caret - its code such as
`U+00A0` and `&#160;` with its name or script (a double-click copies the code) -, the book's
encoding and the result of the last validation, which says *not checked* after any change; a
click on it validates. A right-click on the status bar chooses the panes shown.

## Completion in the Source view

After an element name and a space the Source view offers that element's attributes; accepting
one writes `name=""` and offers its values: after `#` the book's ids or pictures, alignments,
link types, genres and languages. Ctrl+Space opens the list where it applies. *Settings > View >
Completion in the Source view (tags, attributes, values)* turns it off.

## Spelling

The Body view is checked against the dictionary of the book's language (`title-info/lang`), or
the interface language's when the book's has none, plus the dictionaries ticked under *Also
use* in *Settings > View* - English and Russian by default. A word counts as correct when any
of these dictionaries knows it. The Spelling dialog can change the set for the session.

## The Links bar's Href list

With the caret in a link, the arrow of the *Href* («Ссылка») box lists every place of the book
a link can lead to - sections, footnotes, comments, every element with an id - in book order;
with a picture selected it lists the book's images. Alt+Down or F4 open the list, typing
narrows it, Enter or a click applies the choice as one undo step. Typing any address still
works. *Style > Link…* lists the same places in the same order.

## Pictures

In the Description view a click on the cover's thumbnail shows the cover at its natural size;
*Choose…* beside it picks another one. A thumbnail of the Binary objects list shows its picture
the same way.

*Rename…* on a row of the Binary objects list gives a picture a new id: a letter or `_` first,
then letters, digits, `.`, `-` and `_`, and no other element of the book may have it. Every
reference follows - the text, tables, the annotation and the cover - and one Undo gives the old
id back.

*Add > Image* puts the picture where the caret is: at the start of a paragraph before it,
inside it between its two halves, at its end after it, and in place of an empty paragraph.
*Add > Binary Object…* with several files adds each one on its own; when some fail, or are in a
format that is converted to JPEG or PNG on save, a summary lists them.

## The AI assistant at work

While the assistant works on a request, the pointer over the document shows a small atom with
turning electrons, and the banner above the text and the status bar show the same atom: the
book cannot be edited until the answer arrives, but reading, scrolling, selecting, copying and
Find still work. The atom stands still when the system asks for reduced motion.
