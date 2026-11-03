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

## The AI assistant at work

While the assistant works on a request, the pointer over the document shows a small atom with
turning electrons, and the banner above the text and the status bar show the same atom: the
book cannot be edited until the answer arrives, but reading, scrolling, selecting, copying and
Find still work. The atom stands still when the system asks for reduced motion.
