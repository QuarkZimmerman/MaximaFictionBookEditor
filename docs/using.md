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

A book with validation errors is saved only after a question; when saving opens *Save As*, the
question comes first, so *No* ends the save without choosing a file.

## Books in ZIP archives

A `.zip` (or `.fb2.zip`) opens like a book, by every route: *File > Open*, the file manager,
the command line, dragging it onto the window and *Recent files*. An archive with several books
asks which one to open; each book of an archive has its own entry in *Recent files*, and the
window title shows the book with its archive. The editor never writes into an archive behind
your back: saving a book from an archive always opens *Save As*, whose *Save as ZIP archive*
box (ticked for such a book) puts it into a ZIP archive; replacing an archive that holds other
files asks first, so nothing in it is lost without a word. *File > Open* shows FictionBook
files, descriptors and ZIP archives together by default (*Book files*).

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
works. *Style > Link…* lists the same places in the same order. With a picture selected, a click
on the box opens the list too: each picture shows a preview, and the button beside it shows the
picture enlarged.

To give an empty picture its image, or a picture another one:

1. Make sure the Links bar is shown (*View > Links Bar*).
2. Click the picture in the Body view; an empty picture is the dashed box reading `#undefined`.
   The *Href* box then shows its reference.
3. Click the *Href* box: the book's pictures are listed with their previews.
4. Click the one to show; *Edit > Undo* brings the previous one back.

A picture that is not in the book yet is added first with *Add > Add Binary Object…*.

## Pictures

In the Description view a click on the cover's thumbnail shows the cover at its natural size;
*Choose…* beside it picks another one. A thumbnail of the Binary objects list shows its picture
the same way. *Add > Image* asks whether to insert a picture from a file - the default - or an
empty picture to fill in later.

An empty picture, and one whose file is missing or on the web, shows what it is and how to fill
it: a double-click opens the picture chooser - the book's pictures with a filter, *From file…*
for a new one, and a larger view of the chosen picture. *Change Picture…* and *Show Picture* do
the same from the context menus of the Body view, the Description fields and the cover. Only
pictures the editor can read are added from a file, whatever their names.

Pictures are shown on a white background in both themes, as most readers show them. A picture
with transparent areas has a small switch in its corner that shows it on the page's own background
instead; the choice lasts until the book is closed and is never stored.

## The AI assistant's address

In *Settings > AI assistant*, the button beside your own service's address lists well-known
services - OpenAI, Anthropic, Google Gemini, xAI Grok and OpenRouter - to fill it in; the address
stays editable, and the one typed is the one saved.

*Rename…* on a row of the Binary objects list gives a picture a new id: a letter or `_` first,
then letters, digits, `.`, `-` and `_`, and no other element of the book may have it. Every
reference follows - the text, tables, the annotation and the cover - and one Undo gives the old
id back.

*Add > Image* puts the picture where the caret is: at the start of a paragraph before it,
inside it between its two halves, at its end after it, and in place of an empty paragraph.
*Add > Add Binary Object…* with several files adds each one on its own; when some fail, or are in a
format that is converted to JPEG or PNG on save, a summary lists them.

## The AI assistant at work

While the assistant works on a request, the pointer over the document shows a small atom with
turning electrons, and the banner above the text and the status bar show the same atom: the
book cannot be edited until the answer arrives, but reading, scrolling, selecting, copying and
Find still work. The atom stands still when the system asks for reduced motion.

## Starting

While the editor starts, the status bar says *Starting…* and the menus, toolbars and shortcuts
wait: they work once the start-up book - the file given on the command line, or a new book - is
shown. A message the start-up brings, a file that could not be opened for instance, comes first.

## Tooltips

Every button, field, list and checkbox says what it is for when the pointer rests on it, and a
greyed one also says when it becomes available ("Available when the caret is in a section").
Toolbar buttons show the command's name, its shortcut and what it does. In a menu, the status bar
describes the highlighted entry; it shows its usual text again when the menu closes. Screen
readers read the same texts.

## The Body view's context menu

The *Select …* entries name the elements around the caret in words - paragraph, verse, stanza,
poem, quote, cell, section, notes, history. A right-click outside the selection first moves the
caret to the clicked point, so the menu acts on what was clicked; a right-click on a picture
selects it; a right-click inside the selection keeps it.

## The Document tree

A click on a row - or the arrow keys, Enter, a double-click, *Go To* - brings its element to the
top of the Body view with its heading in full; near the end of the book it goes as far up as the
book allows. The tree keeps the focus.

The tree's context menu has the entries of the clicked row's kind: for a section *Move Up* and
*Move Down*, which swap it, with its subsections, with the section before or after it, *Move
Into*, *Move Out of*, *Merge With*, *Add ▸*, *Delete Section…* and *Scripts ▸*; for a picture
*Change Picture…*, *Show Picture*, *Save Image As…* and *Delete Picture*; for a table *Table
Properties…* and *Delete Table*; for a body *Delete Body…*. Each operation names the section it
involves - *Move Into «Chapter 1»* - and its tooltip says the result. *Move Up* and *Move Down*
are also on the tree's toolbar. The tree's scripts act on the clicked row.

## Markdown files

*File > Import > Markdown File…*, *File > Open* and a drop onto the window make a new book from a
`.md` or `.markdown` file; the Markdown file itself is never changed. The book is new and
unsaved; *Save As* proposes the Markdown file's name with `.fb2` in its folder. The open book
closes only once the new one is ready, after the usual question about unsaved changes.

- Headings become sections, nested by their levels; a single level-1 heading that opens the file
  becomes the book's title. Text before the first heading, or between a heading and its first
  subheading, goes into an untitled section, as FB2 requires. A heading's `{#id}` becomes its
  section's id; links to headings lead to their sections.
- Emphasis, strong, strikethrough, inline code, `~sub~` and `^sup^` keep their styles; links stay
  links; footnotes become notes in a notes body, as *Style > Footnote…* makes them.
- Lists become paragraphs that begin with a bullet, their number or a check box; quotes become
  quotes, code blocks code paragraphs line by line, a horizontal rule a subtitle "* * *", tables
  tables with their header cells and alignment.
- The front matter (a YAML block at the top) fills the description: `title`, `author` or
  `authors`, `date`, `lang`, `description` or `summary`, `keywords` or `tags`, `series` with
  `series_index`, `cover`, `genres` (FB2 genre codes). The rest comes from the template, as
  *File > New* makes it.
- Pictures named by a path or a `file:` address, and `data:` pictures, are added to the book; a
  picture on the web is never downloaded and stays a picture naming its address, like a missing
  file - double-click it to choose one.
- Emoji, check boxes, stars and the other symbols readers' fonts may lack become small pictures
  drawn from the bundled Noto fonts, one per distinct character, with the character as their
  alternative text; GitHub's emoji codes such as `:white_check_mark:` too. Letters of every script
  stay text. Private-use characters (icon fonts) are left out.
- A file in UTF-8 or UTF-16 is read directly, one in an older encoding (windows-1251, KOI8-R,
  CP866 and others) is recognised from its text; the editor asks only when it cannot tell.

What could not come over as written - pictures not added, links to headings that do not exist,
HTML tags left out, characters left out - is listed after the import; otherwise the status bar
says what came in.

## Undo names

*Edit > Undo* and *Redo*, the toolbar's Undo and Redo tooltips and the context menus name the step
they undo or redo: "Undo Merge Sections", "Redo Typing", "Undo Description: Book title". Typing,
deleting and dragging text are steps of their own; a command's step carries the command's name.

## A file that cannot be opened

When a file turns out not to be a book - not FictionBook, broken, an archive without a book -, the
book open in the window stays as it was, with its unsaved changes and its Undo history, and a
message says why the file was refused.

## The AI assistant's thinking effort

*Settings > AI assistant* has a *Thinking effort* list beside the model: *Model's default*, or the
efforts the model offers, for instance *Low*, *Medium* and *High*. The editor learns them from the
service's model list (*Fetch models*) or from its own list of known models; for a model without
any the list is greyed. The chosen effort goes with every request of the assistant - not with *Test
connection* or *Fetch models* - and shows in the banner beside the model; choosing another model
returns it to *Model's default*. Anthropic's models are listed without efforts: the
OpenAI-compatible interface the editor uses ignores them.

