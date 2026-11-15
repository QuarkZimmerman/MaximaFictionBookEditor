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
question comes first, so *No* ends the save without choosing a file. The exports ask the same
question before their save dialog - *File > Export > Export as Markdown…*, *Export as Markdown
ZIP…*, *Export as EPUB…* and *Export as PDF…* -, and *No* ends the export without choosing a file;
*Export as FBD…* asks it about the description it writes.

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
encoding and the result of the last validation. A book is validated as soon as it has loaded, so
the pane shows *Valid* or the number of errors at once; after a change it says *not checked* until
the next validation, and a click on it validates. A right-click on the status bar chooses the panes
shown.

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

The tree shows the book as FictionBook Editor did: rows for the bodies and sections, the book's
Annotation and History, a section's annotation, pictures (in the text too), poems and their stanzas,
subtitles (three blue stars) and tables with their header cells and cells. Titles, epigraphs and
quotes have no rows at first; a row stands under the row of the nearest element above it that has
one. A section's row is captioned with its title, a subtitle's and a cell's with their own text, a
poem's, a quote's or an annotation's with their first words - one line, cut with "…" when long, the
whole caption in the tooltip.

The tree's own menu bar, above the rows, has *Elements* and *Scripts*. *Elements* ticks the kinds of
rows to show - section, body, picture, annotation, history, poem, stanza, title, epigraph, quote,
subtitle, table, header cell, cell -, each entry naming its FB2 element in its tooltip; a change shows
at once, the Body view is untouched, and the choices are kept for the next start. The toolbar - Move
Up, Move Down, Move Right, Move With Children, Move Left, Merge, Delete - is below the tree.

Rows that hold stanzas, cells or what an annotation, a quote or an epigraph contains start closed;
bodies and sections start open. `*` opens every row; when the caret moves into a closed row's element,
its row opens.

A click on a row - or the arrow keys, Enter, a double-click, *Go To* - brings its element to the
top of the Body view with its heading in full; near the end of the book it goes as far up as the
book allows. The tree keeps the focus. In the Source view a click or an arrow key shows the
element's opening tag there and the focus stays in the tree; a double-click or Enter does the same
and puts the focus into the Source view. Edits not yet applied stay as they are, and the Body view
does not move.

The tree's context menu has the entries of the clicked row's kind: for a section *Move Up* and
*Move Down*, which swap it, with its subsections, with the section before or after it, *Move
Into*, *Move Out of*, *Merge With*, *Add ▸*, *Delete Section…* and *Scripts ▸*; for a picture
*Change Picture…*, *Show Picture*, *Save Image As…* and *Delete Picture*; for a table *Table
Properties…* and *Delete Table*; for a body *Delete Body…*. Each operation names the section it
involves - *Move Into «Chapter 1»* - and its tooltip says the result. *Move Up* and *Move Down*
are also on the tree's toolbar. The tree's scripts act on the clicked row. A subtitle's and a stanza's
menu have *Go To*, *Go To Source* and *Delete Subtitle* or *Delete Stanza* - greyed, with the reason,
on a poem's only stanza -, a cell's *Go To* and *Go To Source*.

### Tree scripts

The tree bar's *Scripts* menu lists the tree scripts with their icons, then *Clean*. Choosing one runs
it: the places it finds appear as rows of the tree, each in its place under the nearest row above it,
with the script's icon and its caption; a click on such a row goes to its place. The book does not
change, and the rows are never saved. They stay until *Clean*, the row's own *Clean* (its right-click
menu also has *Go To* and *Go To Source*), the script's next run, or until their element is deleted;
another book clears them. Choosing a script with Ctrl held first removes the other scripts' rows. The
sample *Paragraphs Without a Full Stop* lists the paragraphs that contain no full stop. Tree scripts
are script packages like the Scripts menu's, in the same folders (*Scripts > Open scripts folder*);
the scripting guide (`docs/scripting/en.md`) says how to add or write one.

## Markdown files

*File > Import > Markdown File…* makes a new book from a `.md` or `.markdown` file; the Markdown file
itself is never changed. Markdown is imported, not opened: *File > Open*, a drop onto the window and
the command line refuse a Markdown file like any file that is not a book. The book is new and
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
- A ```` ```mermaid ```` block - a flowchart, a sequence or class diagram and the other Mermaid
  diagrams - becomes a picture where the block stood, drawn by the editor itself without the
  internet: on white, at most twice its own size and at most 1600 px wide, kept as a JPEG or a PNG,
  whichever file is smaller. The diagram's text travels inside the picture file, so *Export as
  Markdown* writes the block back. A block that cannot be drawn stays code and is listed after the
  import; in a quote or a note, where FB2 has no pictures of their own, it stays code too.
- Formulas - `$…$` in a line, `$$…$$` and ```` ```math ```` as a block, as GitHub writes them -
  become pictures drawn by the editor without the internet: one in a line a small picture in that
  line, a block one a picture of its own. A price such as "$5 or $10" and an escaped `\$` stay text.
  The formula's TeX travels inside the picture (and is its alternative text), so *Export as Markdown*
  writes it back; one that cannot be drawn stays as written and is listed after the import.
- A file in UTF-8 or UTF-16 is read directly, one in an older encoding (windows-1251, KOI8-R,
  CP866 and others) is recognised from its text; the editor asks only when it cannot tell.

What could not come over as written - pictures not added, links to headings that do not exist,
HTML tags left out, characters left out - is listed after the import; otherwise the status bar
says what came in.

### Exporting as Markdown

*File > Export > Export as Markdown…* writes the book as one Markdown file; *Export as Markdown ZIP…*
writes a ZIP archive holding the Markdown file and an `images` folder with the pictures as they are.
For the one file, the save dialog asks whether to include the pictures (the box is ticked every
time): they are embedded as JPEG pictures of at most 0.7 MB - a JPEG within that size as it is,
others converted on white, their resolution reduced while too big. An export is a copy made once:
it is no save, nothing remembers it (recent files, folders), and the book stays as it was.

- A YAML header carries the description: `title`, `author`, `translator`, `genres`, `description`
  (the annotation), `keywords`, `date`, `lang`, `src_lang`, `series` with `series_index`, `cover`,
  the source book's, the document's and the publisher's information (`source`, `document`,
  `publish`), the custom information (`custom`) and the stylesheets (`stylesheets`, and Pandoc's
  `header-includes` for other tools). A title page follows: the cover, the book's title, its series
  under it, the authors, a rule.
- Sections become headings by their depth (at most six levels), notes footnotes, quotes, epigraphs
  and annotations quotes, poems their lines with line breaks, subtitles bold lines, a subtitle of
  stars a rule, an empty line a paragraph of a no-break space; strikethrough is `~~`, subscript and
  superscript HTML. Tables are Markdown tables, or HTML tables when cells are merged.
- Named styles stay as `<span class="…">`, with the look the stylesheet gives them imitated in
  Markdown (italic, bold, strikethrough, code) for viewers that ignore the stylesheet.

The export shows a progress bar with *Cancel*; a cancelled export writes no file, and the window
waits for the export before it closes. What could not come over is listed. A one-file export larger
than the 128 MB the import reads is noted: export it as a ZIP to import it again.

Imported again, an exported file gives the book back: the description comes from the header, not
from the title page, which is skipped with the cover; the stylesheets and named styles come back, the
spans losing their imitated look. Markdown other tools wrote comes in too: Pandoc's `abstract`,
`subject`, `publisher`, `identifier`, `cover-image` and `rights` fill their FB2 fields; CSS from
`header-includes`, from local files the header's `css:` names and from `<style>` blocks is translated
to the book's elements (`blockquote` becomes `cite`, `em` `emphasis`, headings `title`; classes and ids
stay); spans and blocks with a class - `<span class>`, `<div class>`, `[text]{.x}`, `::: {.x}` - become
named styles. A stylesheet on the web is never fetched; what the import could not use is listed.

## EPUB books

*File > Export > Export as EPUB…* writes the book as an EPUB 3.3 book; *File > Import > EPUB File…*
makes a new book from an EPUB. Both are copies made once: neither is a save or an open, nothing
remembers them (recent files, folders, settings), and *File > Open* refuses an EPUB, pointing to the
import. Each shows its progress with *Cancel*, and the window does not close while one runs.

### Exporting as EPUB

The save dialog proposes the book's name with `.epub` in its folder. The book is written as the window
has it, edits in the Source view included, and stays as it was.

- A cover page from the description's cover, a title page with the book's title, series, authors and
  annotation, then one page per chapter of the main body - a long chapter is divided between its
  subsections or paragraphs -, the other bodies, and the notes on a page of their own, each note with a
  link back to its first reference.
- Sections, titles, epigraphs, quotes, poems, subtitles, text authors, tables and the inline styles keep
  their structure. Pictures keep their bytes and their alternative text; a block picture's title becomes
  its caption. Links inside the book lead to their targets; links to the web stay as they are.
- The book's stylesheets are translated for EPUB readers over a plain base look; named styles become
  classes of the same names.
- The words the export adds - "Cover", "Title page", "Contents", "Notes" - are in the book's language
  for English, Russian and Ukrainian, else in English.
- The EPUB passes the W3C's EPUBCheck without an error or a warning. It also carries the parts older
  readers use (an NCX table of contents and a guide) and its accessibility data: the schema.org fields
  and a summary saying whether every picture has a text alternative.
- What the export had to fill in - a missing title, language or identifier - and the pictures it left
  out are listed after it; otherwise the status bar says where the file went.

### Importing an EPUB book

The import asks about unsaved changes as *Open* does. The new book is unsaved; *Save As* proposes the
EPUB's name with `.fb2`.

- EPUB 2.0 to 3.3 are read, with the older OEB and DTBook pages they may hold. A book protected by DRM
  is refused with a message; font obfuscation is not DRM. A file that is not a ZIP, a password ZIP, a ZIP
  bomb or a book naming files outside itself is refused with its reason or read without those files;
  nothing outside the EPUB is read and nothing on the web is fetched.
- The reading order gives the text's order, headings give the sections, the table of contents titles the
  pages without a heading. A cover page and a title page that only repeat the description become the
  description and the cover, not text. EPUB 3's and EPUB 2's notes become FB2 notes.
- The description comes from the package: title, authors and translators, language, series, subjects
  (genres where they match), the annotation, the publisher and the ISBN. The roles the Maxima site and
  the FBD Maker know (an editor, an illustrator…) become the custom information they read; other people
  are listed.
- Pictures become JPEG or PNG only: JPEG and PNG as they are; GIF, WebP, BMP and TIFF converted - PNG
  when transparent or of 256 colours or fewer, else JPEG at the quality of *Settings > Other*; SVG
  pictures and drawings are drawn, and an SVG that only frames a picture gives that picture itself; AVIF
  is decoded. A picture of more than 100 megapixels is left out.
- MathML formulas become pictures drawn by the editor, with their text as the alternative; one that
  cannot be drawn keeps its text. Emoji and symbols readers' fonts may lack become small pictures, as in
  the Markdown import.
- The book's classes: italic, bold, struck, raised, lowered or monospaced text becomes those FB2 styles;
  a look FB2 cannot express - centring, small capitals, a size, a colour - becomes a named style with its
  rule in the book's stylesheet; the class most paragraphs carry gives the stylesheet's paragraph rule
  instead of a style on every paragraph.
- Left out and listed: embedded fonts, audio and video (their text and poster picture stay), scripts
  (never run), forms, read-aloud synchronisation, page-number markers and the page list, and the
  positions of fixed-layout pages, whose text and pictures come in reading order.

### Exporting and importing again

A book exported to EPUB and imported again comes back with its text, sections, styles, links, notes,
tables, pictures (byte for byte, with their titles), description, stylesheets and named styles, apart
from these differences:

- the title page and the cover page come back as the description and the cover, not as text;
- ids the export had to change to make them unique keep their new form;
- chapters the export divided into pages are joined again;
- parts of a book that FB2's schema does not allow come back in a valid form;
- pictures nothing in the book shows are not exported, so they do not come back;
- a link to a place the book does not hold comes back as its text.

## PDF export

*File > Export > Export as PDF…* writes the book as a PDF: the book as Preview shows it, on pages of the
size chosen in the save dialog. Like an EPUB export it is a copy made once: the book stays as it was,
and nothing but the chosen page size is remembered - for the open book only, until another book
replaces it. The export is loaded the first time it is used, never at start-up. It shows its progress
with *Cancel*; a cancelled export writes nothing.

### The page size

The save dialog lists nine sizes, *A4*, *B5*, *A5*, *B6* and *A6*, then *Legal*, *Letter*, *Executive*
and *Statement*. It proposes the size the open book was last exported in, else the default of
*Settings > Exports*, format PDF (A4 out of the box). Where the system's save dialog cannot show the list, the
editor asks for the size in a window of its own after the dialog.

### What the PDF holds

- A cover page with the description's cover picture, and a title page as printed books set it: the
  authors and the title large in its upper part, each series in brackets under the title, the
  publisher and the year small at its foot. The annotation follows on a page of its own, without a
  heading (bookmarked *Annotation*). Then the book's bodies as the Body view shows them (the cover
  Preview draws at the top is not printed again): each body and each top-level section after a
  body's first on a new page, so a body's own title shares its page with the first section. The
  document's history ends the book (bookmarked *Revision history*). The page numbers are at the
  foot.
- Notes at the foot of the page that refers to them, under a short rule, each beginning with its title
  and leading back to the reference. A note referred to twice is printed once. Notes nothing refers to
  come after the text.
- Bookmarks: the cover page, the title page, the annotation, the titled sections, nested as the book
  nests them, and the revision history.
  Links inside the book lead to their targets; links to the web stay as written.
- Searchable text: every word can be found and copied, ligatures read as their letters. The structure
  is tagged (headings, paragraphs, pictures with their alternative text, tables, links) for screen
  readers.
- The whole description in the PDF's metadata: title, authors, annotation, keywords, genres, language,
  date, publisher, translators, ISBN, and the series as Calibre reads it. The editor also records the
  description itself and a few hints, so that the book can be recreated from its PDF later.
- The file is archival: PDF/A-2U, checked by the editor before it is written.

The words the export adds - the cover's description, the notes' heading - are in the book's language
(English, Russian or Ukrainian, else English).

### Fonts

The text is printed in the text font of *Settings > Exports* (PDF; Noto Serif out of the box); code in
DejaVu Sans Mono. A font the book's stylesheet names is replaced by the shipped family of the same kind,
so titles set in a sans-serif font stay sans-serif. Characters no shipped font has are drawn with a
system font, and the summary lists them.

### When the export finishes

A summary lists what the PDF could not keep as the book has it: pictures left out (no data, not a
picture, more than 100 megapixels), links to ids the book does not have (written as text), ids used
twice (kept by their first place), a missing title (the file's name is used) or language. A book of
more than 20,000 pages, or more than 100,000 notes, is refused before printing.

### Settings > Exports

*Format* at the top chooses the export whose settings are shown: PDF, EPUB or Markdown. Only the PDF
export has settings of its own for now.

- *Default page size*, *Text font*, *Text size* (smaller, standard, larger, custom) and *Margins*
  (narrow, standard, wide, custom). Beside the text size and the margins their value for the default
  page size is shown, in points and millimetres; with *Custom* that value can be typed (6 to 24 pt,
  5 to 50 mm) and holds for every page size. Beside each its default is shown, with *Reset*; *Reset
  all* puts the page back.
- *Add font from file…* adds a TrueType or OpenType font file (from a collection, the face you choose);
  *Add installed font…* one of the computer's fonts. A font whose licence forbids embedding is refused
  with the reason; one that forbids subsetting is embedded whole. The editor keeps its own copy, in its
  data folder (a portable copy: in `user/fonts/`), so the original may be moved or deleted. *Remove*
  removes an added font; Noto Serif then becomes the text font again.

## The Styles view

*View > Styles*, after the Source view, shows the book's stylesheets - each a group with its type, the
first CSS one marked as the default - and their rules, one per selector. Selecting a rule shows its
declarations in a framed CSS box on the right - empty for a new rule, with a hint of what to type -
that completes the standard property names and, after a colon, the property's keywords; *Apply*
(Ctrl+Enter, Cmd+Enter on macOS) writes them into the rule. After *Add style…* the caret is
already in the new rule's box. *Add style…* opens a dialog with two choices: *Style of an element*, picked from a list of the FB2 elements that typing narrows (a selector such as `epigraph p` may be typed whole), or *Named style*, typed by its name alone - the class's dot is added; every control explains itself in its tooltip. The new rule goes to
the selected stylesheet, else to the default one - a book without a stylesheet gets one for its first
selector -; *Rename…*, *Remove* and *New stylesheet* do what they say. Renaming a class that the text
uses asks whether to rename its uses too.

Only what works in an FB2 book is accepted: selectors made of FB2 elements and classes (`p`,
`section > title`, `p.letter`, `.sign`) - "div > span" is refused because it matches nothing in an FB2
book - and standard CSS properties with valid values - `-webkit-hyphens` and misspelt names are refused
with the reason. A stylesheet of another type, or CSS the editor cannot read, is shown as read and kept
exactly as it was. A property set differently by two stylesheets for the same selector is marked on
both and reported by Validate. Each change is one Undo step; *Save* writes the stylesheets with the
book.

## Named styles

*Style > Named Style ▸* lists the classes of the book's stylesheets by name. With text selected, the
chosen style is put on the selected part of each paragraph; without a selection it becomes the style
of the paragraph, verse, subtitle, text author, table or cell at the caret. *Remove Named Style* takes
it away. The Body view's context menu offers the same submenu. The entries are greyed with the reason
when the book defines no class or nothing at the caret can carry a style. In the Body view styled text
carries a very faint dotted underline. Resting the pointer on it names every style in effect there, the
outermost first ("Named styles: sign, letter"), says which one no stylesheet defines, and shows the
element's id on a line of its own; tables and cells are named too. Preview shows the styles themselves.

*View > Show Book Styles* - also on the Commands toolbar, beside Preview - draws the book's own
stylesheets in the Body view while you edit, as a reader draws them over its own look. It starts off
and is remembered. The book's rules win over the Body view's look; the editor's marks - the caret, the
selection, spelling marks, the ids' tabs, the named-style underline, table marks and search highlights -
stay on top. Colours are drawn as the book sets them, in the dark theme too. What would take an editing
function away is held back or limited: nothing hides text, shrinks it below a readable size, moves it
out of the view or onto other text, fixes, transforms, clips or animates it, blocks the pointer or the
selection, or loads anything but a picture written into the stylesheet (`data:`). Fast mode wins: while
it is on, the entry is greyed with the reason and keeps its check mark. Showing the styles changes
nothing in the book.

## Preview

*View > Preview* (Shift+F5), its toolbar button beside Validate and the small button at the right of
the status bar show the book as an e-book reader does - its stylesheets on top of a reader's usual
look - over the whole window, opened at the caret's element (in the Source view at the selected one).
It scrolls through the whole book; links jump and *Back* (Alt+Left) returns, a note reference opens
the note in a small window. Nothing can be typed, pasted or dropped, and nothing is fetched from the
web. Esc, *Close* or the window's own close button returns to the editor exactly as it was - the
window itself closes only once Preview is closed. A long book shows "Rendering…" with
*Cancel* while Preview builds.

## Ids

An element that has an id - the target of a link such as `#chapter-2` - shows it in the Body view as a
small `#id` tab at its top right: a paragraph, verse, subtitle or text author is also faintly tinted,
a quote, epigraph, poem or annotation faintly outlined, a section shows the tab beside its title, a
table cell a small `#` in its corner (the id in its tooltip). The tabs are not part of the text: they
take no clicks and are never typed into or saved. In the Document tree a section that has an id has a
`#` badge at the right of its row. *View > Show Ids* switches the marks off and on.

## Persons in the description

An author, translator or document author whose fields are all empty is written as FictionBook Editor
wrote it - an author with an empty first and last name -, so the book stays valid. Validate warns when
no author of the book has a name or a nickname, and the Description view's message says what to fill
in.

## Regular expressions in Find and Replace

With *Regular expression* ticked - in the Body view, the Source view and the description's fields -, a
backslash before a character that is not a letter or a digit stands for that character itself, as in
FictionBook Editor: `\—`, `\«` and `\-` find the dash, the quote and the hyphen. An expression that
is not valid says why instead of "Cannot find the string". Every expression that worked before finds
the same matches.

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
returns it to *Model's default*.

For a service on Anthropic's address the editor speaks Anthropic's own interface (its Messages
API) instead of the OpenAI-compatible one, which ignores the effort: Claude models offer the levels
their list names - *Low*, *Medium*, *High*, and *Extra high* and *Max* where the model has them -
and the assistant, its tools and *Test connection* work as with any other service. Its requests ask
for Anthropic's automatic prompt caching, so the next request of a conversation reads the repeated
instructions and earlier turns from Anthropic's cache at a fraction of the price; the other services
cache repeated prompts on their own.

