# Parity matrix

Traceability review of SC-003 and Constitution I: every menu item, context-menu entry,
toolbar button and dialog control of the original FictionBook Editor 2.7 (`FBE/FBE.rc` of the
reference checkout) mapped to the Maxima Fiction Book Editor command id or component, the
`data-testid`s that reach it and the Playwright journey (`ui/tests/e2e/*.spec.ts`) that
exercises it.

`node tools/parity-check.mjs` re-derives the data behind this table and fails CI when a row
marked implemented names a command id that no longer exists in the UI command registry
(`ui/src/app/commands.ts` plus the feature modules that replace its stubs), when it names a
test id the UI does not produce, when its journey is missing, or when none of the row's
evidence (command id, `menu-<menu>-<item>` / `toolbar-<command>` test ids, the test ids or
hotkeys of the Evidence column) occurs in the listed specs. With the reference checkout
available (`--rc FBE.rc`) it also checks that every RC item has a row.

Legend

| Column | Meaning |
|---|---|
| Original | Resource id in `FBE.rc` (`*` marks original UI that is created in the sources, not in the resource script) |
| MFBE | Command id (`group.name`), component or test id prefix of the equivalent |
| Evidence | Test ids or hotkeys a journey uses for this item |
| Status | `implemented` - same function, same place; `implemented-differently` - same function, different mechanism (note says how); `dropped` - no equivalent, with the reference that justifies it |

Counts and the list of dropped items are at the end.

## 1. Main menu (`IDR_MAINFRAME MENU`)

The eight menus of `ui/src/app/menus.ts` keep the original items, separators and order; labels
and accelerators come from the i18n catalogues (`menu.*`). `us8-language.spec.ts` (1a) walks
every menu and submenu item in both languages, `00-smoke.spec.ts` opens the menus with the
mouse and the keyboard.

### File

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `ID_FILE_NEW` | New | `file.new` (`features/file/fileCommands.ts`) | `menu-file-new`, `toolbar-file.new` | `us1-open-save.spec.ts`, `00-smoke.spec.ts` | implemented | "Save changes to X?" prompt before discarding (scenario 4) |
| `ID_FILE_OPEN` | Open... | `file.open` | `menu-file-open` | `us1-open-save.spec.ts`, `00-smoke.spec.ts`, `us3-file-dialogs.spec.ts` | implemented | the platform's own dialog through `dialog.openFile` with "FictionBook files (*.fb2)" selected, then `*.fbd` and all files, as the original (feature 002); malformed files open Source-only (scenario 3) |
| `ID_FILE_SAVE` | Save | `file.save` | `menu-file-save`, `toolbar-file.save` | `us1-open-save.spec.ts` | implemented | atomic write, validation prompt (`dialog-validation-failed`) |
| `ID_FILE_SAVE_AS` | Save As... | `file.saveAs` | `menu-file-saveAs`, `dialog-encoding` | `us1-open-save.spec.ts`, `us3-file-dialogs.spec.ts` | implemented | the platform's dialog on the document's file with the encoding choice inside it, see `IDD_CUSTOMSAVEDLG` |
| `ID_FILE_VALIDATE` | Validate | `file.validate` | `menu-file-validate`, `validation-panel` | `us1-open-save.spec.ts`, `us4-source-validate.spec.ts` | implemented | result list with line/column/message instead of a message box (FR-010) |
| `IDCANCEL` | Import > "No import plugins installed", Export > "No export plugins installed" | the Import submenu holds the description import of feature 004 (`FILE_IMPORT_DESCRIPTION*` below), the Export submenu its FBD export (`FILE_EXPORT_FBD*` below); no placeholder is left (`menus.ts`) | `menu-file-import`, `menu-file-export` | `us8-language.spec.ts` | dropped | the Import/Export COM plugin interface and the ExportHTML plugin are out of scope (spec.md "Out of scope"); feature 004 replaces the placeholders by the editor's own entries (FR-030 import, FR-040 export), walked by us8 1a |
| `ID_FILE_MRU_FIRST` | Recent Files > ... | dynamic submenu `menu-file-recent` (`features/file/recent.ts`, `doc.recent`) | `menu-file-recent`, `menu-file-recent-recent1` | `us11-launch.spec.ts`, `us1-open-save.spec.ts` | implemented | ten most recent files, persisted by the core |
| `ID_APP_EXIT` | Exit | `file.exit` | `menu-file-exit` | `us1-open-save.spec.ts` | implemented | prompts for unsaved changes, then `app.quit` |

### Edit

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `ID_EDIT_UNDO` | Undo | `edit.undo` (`model/undo.ts` coordinator) | `menu-edit-undo`, `toolbar-edit.undo` | `us2-body-editing.spec.ts`, `us3-description.spec.ts` | implemented | multi-level across views, dialogs and scripts (FR-034) |
| `ID_EDIT_REDO` | Redo | `edit.redo` | `menu-edit-redo`, `toolbar-edit.redo` | `us2-body-editing.spec.ts`, `us3-description.spec.ts` | implemented | |
| `ID_EDIT_CUT` | Cut | `edit.cut` (`features/clipboard.ts`) | `menu-edit-cut` | `us2-body-editing.spec.ts`, `us8-toolbars.spec.ts` | implemented | structure-preserving clipboard (scenario 6); also the Source editor and the Description fields, as the original's (feature 002) |
| `ID_EDIT_COPY` | Copy | `edit.copy` | `Control+c`, `menu-edit-copy` | `us2-body-editing.spec.ts`, `us8-toolbars.spec.ts` | implemented | Body, Source editor and Description fields |
| `ID_EDIT_PASTE` | Paste | `edit.paste` | `menu-edit-paste` | `us2-body-editing.spec.ts`, `us7-images.spec.ts`, `us8-toolbars.spec.ts` | implemented | pasted images go through `POST /binary` (us7 scenario 2); Body, Source editor and Description fields; the shell grants the clipboard to the editor's page (`app/src/permission_policy.cpp`) |
| `ID_EDIT_FIND` | Find... | `edit.find` (`features/search/search.ts`, `dialogs/FindDialog.tsx`) | `dialog-find`, `Control+f` | `us2-body-editing.spec.ts`, `us8-language.spec.ts` | implemented | see `IDD_FIND` |
| `ID_EDIT_FINDNEXT` | Find Next | `edit.findNext` | `F3`, `dialog-find-button-findNext` | `us2-body-editing.spec.ts` | implemented | repeats the last search |
| `ID_EDIT_REPLACE` | Replace... | `edit.replace` (`dialogs/ReplaceDialog.tsx`) | `dialog-replace`, `menu-edit-replace` | `us2-body-editing.spec.ts`, `us3-description.spec.ts` | implemented | see `IDD_REPLACE`; also works in Description text fields |
| `ID_GOTO_FOOTNOTE` | Go to footnote or reference | `edit.gotoFootnote` (`features/footnotes.ts`) | `menu-edit-gotoFootnote`, `Control+Backspace`, `dialog-reference-not-found` | `us2-body-editing.spec.ts` | implemented | "Reference not found" message |
| `ID_GOTO_MATCHTAG` | Go to matching tag | `edit.gotoMatchTag` (`features/source/navigation.ts`) | `menu-edit-gotoMatchTag`, `source-tag-match` | `us4-source-validate.spec.ts` | implemented | Source view |
| `ID_GOTO_WRONGTAG` | Go to wrong tag | `edit.gotoWrongTag` | `menu-edit-gotoWrongTag`, `source-parse-error` | `us4-source-validate.spec.ts` | implemented | Source view |
| `ID_EDIT_CLONE` | Clone container | `edit.clone` (`features/structure.ts`) | `Control+Enter` | `us2-body-editing.spec.ts` | implemented | exercised through the hotkey (scenario 8) |
| `ID_EDIT_SPLIT` | Split container | `edit.split` | `Shift+Enter` | `us2-body-editing.spec.ts` | implemented | exercised through the hotkey (scenario 8) |
| `ID_EDIT_MERGE` | Merge containers | `edit.merge` | `Alt+Delete` | `us2-body-editing.spec.ts` | implemented | exercised through the hotkey (scenario 8) |
| `ID_EDIT_REMOVE_OUTER_SECTION` | Remove outer container | `edit.removeOuter` | `menu-edit-removeOuter` | `us2-body-editing.spec.ts` | implemented | enabled state follows the original's container rules (8, 8b) |

### View

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `60161` | Commands toolbar | `view.toolbarCommands` (toggle, `app/Toolbars.tsx`) | `toolbar-commands` | `00-smoke.spec.ts` | implemented | the toolbar is checked for presence and content; the toggle itself is not clicked by a journey |
| `60162` | Scripts toolbar | `view.toolbarScripts` (`scripting/ScriptsToolbar.tsx`) | `toolbar-scripts` | `us12-scripts.spec.ts` | implemented | same remark |
| `60163` | Links Bar | `view.linksBar` (`app/LinksBar.tsx`) | `links-bar-image-title` | `us2-body-editing.spec.ts` | implemented | bar fields exercised (scenario 1); toggle not clicked by a journey |
| `60164` | Table Bar | `view.tableBar` (`app/TableBar.tsx`) | `tablebar` | `us2-body-editing.spec.ts` | implemented | bar fields exercised (scenario 10); toggle not clicked by a journey |
| `ID_VIEW_STATUS_BAR` | Status Bar | `view.statusBar` (`app/StatusBar.tsx`) | `menu-view-statusBar`, `status-message` | `00-smoke.spec.ts` | implemented | checked state verified in the smoke test |
| `ID_VIEW_TREE` | Document Tree | `view.tree` (`features/tree/index.ts`, `views/tree/`) | `panel-tree`, `panel-tree-caption`, `menu-view-tree` | `00-smoke.spec.ts`, `us5-tree.spec.ts`, `us1-tree-divider.spec.ts` | implemented | panel exercised by us5; visibility remembered in the session settings; the toggle is clicked by us1-tree-divider (feature 004 US1: hiding removes the divider and gives the view the whole width, showing restores the stored width) |
| `ID_VIEW_DESC` | Description | `view.description` (`app/ViewSwitcher.tsx`) | `view-description` | `us3-description.spec.ts`, `us1-open-save.spec.ts` | implemented | |
| `ID_VIEW_BODY` | Body | `view.body` | `menu-view-body`, `view-body` | `00-smoke.spec.ts`, `us1-open-save.spec.ts` | implemented | refused while the Source text is malformed (FR-021, us1 scenario 3) |
| `ID_VIEW_SOURCE` | Source | `view.source` | `toolbar-view.source`, `view-source` | `00-smoke.spec.ts`, `us4-source-validate.spec.ts` | implemented | |
| `ID_VIEW_FASTMODE` | Fast Mode | `view.fastMode` (`editor/fastMode.ts`: reduced-fidelity Body rendering, class `mfbe-body-view--fast`, persisted in `settings.view.fastMode`) | `settings-view-fast-mode` | `us9-settings.spec.ts` | implemented | decision of T154: kept, like the original's `main_fast.css`; F5; exercised through the Settings checkbox, the menu toggle itself is not clicked by a journey |

### Add

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `ID_EDIT_ADD_BODY` | Body | `insert.body` (`features/editing/bodyCommands.ts`) | `menu-add-body` | `us2-body-editing.spec.ts`, `00-smoke.spec.ts` | implemented | |
| `ID_EDIT_ADD_TITLE` | Title | `insert.title` | `menu-add-title` | `us2-body-editing.spec.ts` | implemented | |
| `ID_EDIT_ADD_EPIGRAPH` | Epigraph | `insert.epigraph` | `menu-add-epigraph` | `us2-body-editing.spec.ts` | implemented | |
| `ID_EDIT_ADD_ANN` | Annotation | `insert.annotation` | `menu-add-annotation` | `us2-body-editing.spec.ts` | implemented | |
| `ID_EDIT_ADD_TA` | Text author | `insert.textAuthor` | `menu-add-textAuthor` | `us2-body-editing.spec.ts` | implemented | |
| `ID_EDIT_INS_IMAGE` | Image | `insert.image` (`features/images/insert.ts`) | `menu-add-image`, `dialog-insert-clear-image` | `us2-body-editing.spec.ts`, `us7-images.spec.ts` | implemented | "Insert clear image?" prompt with "Don't ask again" (FR-038) |
| `ID_EDIT_INS_INLINEIMAGE` | Inline image | `insert.inlineImage` | `menu-add-inlineImage`, `body-inline-image` | `us2-body-editing.spec.ts`, `us7-images.spec.ts` | implemented | |
| `ID_EDIT_INS_POEM` | Poem | `insert.poem` | `menu-add-poem` | `us2-body-editing.spec.ts` | implemented | |
| `ID_EDIT_INS_CITE` | Cite | `insert.cite` | `menu-add-cite` | `us2-body-editing.spec.ts` | implemented | |
| `ID_INSERT_TABLE` | Table | `insert.table` (`dialogs/TablePropertiesDialog.tsx`) | `dialog-table`, `Alt+t` | `us2-body-editing.spec.ts`, `us8-language.spec.ts` | implemented | see `IDD_TABLE` |
| `ID_EDIT_ADD_IMAGE` | Section image | `insert.sectionImage` | `menu-add-sectionImage` | `us2-body-editing.spec.ts`, `us7-images.spec.ts` | implemented | |
| `ID_EDIT_ADDBINARY` | Add Binary Object... | `insert.binary` | `menu-add-binary`, `binary-objects` | `us7-images.spec.ts` | implemented | appended binaries appear in the Description list (scenario 5) |

### Style

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `ID_STYLE_NORMAL` | Normal | `style.normal` (`features/editing/bodyCommands.ts`) | `menu-style-normal` | `us2-body-editing.spec.ts` | implemented | |
| `ID_STYLE_TEXTAUTHOR` | Text Author | `style.textAuthor` | `menu-style-textAuthor` | `us2-body-editing.spec.ts` | implemented | |
| `ID_STYLE_SUBTITLE` | Subtitle | `style.subtitle` | `menu-style-subtitle`, `toolbar-style.subtitle` | `us2-body-editing.spec.ts` | implemented | |
| `ID_STYLE_LINK` | Link... | `style.link` (`features/footnotes.ts`, `dialogs/LinkDialog.tsx`) | `menu-style-link`, `dialog-link` | `us2-body-editing.spec.ts`, `us8-language.spec.ts` | implemented | target entered in an HTML dialog (the original used an input box) |
| `ID_STYLE_NOTE` | Footnote... | `style.footnote` | `menu-style-footnote` | `us2-body-editing.spec.ts` | implemented | creates the note section in the notes body (FR-037) |
| `ID_STYLE_NOLINK` | Remove link | `style.removeLink` | `menu-style-removeLink` | `us2-body-editing.spec.ts` | implemented | |

### Tools

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `ID_TOOLS_WORDS` | Words... | `tools.words` (`features/words/`, `dialogs/WordsDialog.tsx`) | `menu-tools-words`, `dialog-words` | `us10-words.spec.ts` | implemented | see `IDD_WORDS` |
| `ID_VIEW_OPTIONS` | Settings... | `tools.settings` (`features/settings/`, `dialogs/SettingsDialog.tsx`) | `menu-tools-settings`, `dialog-settings` | `us9-settings.spec.ts`, `us8-language.spec.ts` | implemented | pages View / Other / Hotkeys / Words, see `IDD_SETTINGS_*` |
| `ID_TOOLS_SPELLCHECK` | Spell check... | `tools.spellcheck` (`features/spell/`, `dialogs/SpellingDialog.tsx`) | `menu-tools-spellcheck`, `dialog-spelling` | `us6-spelling.spec.ts` | implemented | see `IDD_SPELL_CHECK` |

### Scripts

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDCANCEL` | "No scripts found" (and the script groups the original added at run time) | dynamic Scripts menu (`scripting/ScriptsMenu.tsx`, `scripting/catalog.ts`) | `menu-scripts-none`, `menu-scripts` | `us12-scripts.spec.ts`, `us8-language.spec.ts` | implemented | groups by folder in `NN_` order, placeholder when no scripts exist; `scripts.last`, "Open scripts folder" and "Reload" entries added (FR-141) |

### Help

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `ID_APP_ABOUT` | About FBE... | `help.about` (`dialogs/AboutDialog.tsx`) | `menu-help-about`, `dialog-about` | `00-smoke.spec.ts`, `us8-language.spec.ts` | implemented | see `IDD_ABOUTBOX` |

## 2. Document Tree (`IDR_DOCUMENT_TREE MENU` and `IDR_DOCUMENT_TREE TOOLBAR`)

Context menu `views/tree/TreeContextMenu.tsx` (`tree-menu-<item>`), toolbar buttons in
`views/tree/DocumentTree.tsx` (`tree-toolbar-<item>`), commands in `features/tree/index.ts`.
Tree-command scripts are appended to the context menu (`tree-menu-script-<id>`, us12 scenario 7).

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `ID_DT_VIEW` | View | `tree.view` | `tree-menu-view`, `tree-content` | `us5-tree.spec.ts` | implemented | scenario 1 navigates with Enter on the selected row (same command); the context entry itself is not clicked by a journey |
| `ID_DT_VIEWSOURCE` | View Source | `tree.viewSource` | `tree-menu-viewSource` | `us5-tree.spec.ts` | implemented | Source view positioned on the element (scenario 3) |
| `ID_DT_RIGHT_ONE` | Move Right (menu and toolbar) | `tree.moveRight` | `tree-toolbar-right`, `tree-menu-moveRight` | `us5-tree.spec.ts` | implemented | |
| `ID_DT_RIGHT_SMART` | Move With Children (menu and toolbar) | `tree.moveWithChildren` | `tree-menu-moveWithChildren`, `tree-toolbar-right-smart` | `us5-tree.spec.ts` | implemented | |
| `ID_DT_LEFT` | Move Left (menu and toolbar) | `tree.moveLeft` | `tree-toolbar-left`, `tree-menu-moveLeft` | `us5-tree.spec.ts` | implemented | |
| `ID_DT_MERGE` | Merge (toolbar only in the original) | `tree.merge` | `tree-toolbar-merge`, `tree-menu-merge` | `us5-tree.spec.ts` | implemented | also offered in the context menu (FR-022) |
| `ID_DT_DELETE` | Delete (menu and toolbar) | `tree.delete` | `tree-toolbar-delete`, `tree-delete-confirm` | `us5-tree.spec.ts` | implemented | confirmation prompt as in the original |

## 3. Toolbar context menu (`IDR_TOOLBAR_MENU`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `ID_TOOLS_CUSTOMIZE` | Customize toolbar... (right-click on the Commands or Scripts toolbar) | `app/Toolbars.tsx` (`toolbar-menu-customize`) opening `dialogs/CustomizeToolbarDialog.tsx` | `toolbar-menu-customize`, `dialog-customize-toolbar` | `us8-toolbars.spec.ts` | implemented | as the original's Windows "Customize Toolbar" dialog (feature 002): available and current buttons by their tooltips with separators, Add, Remove, Move Up, Move Down, Reset, Close; Shift+drag moves a button or removes it when dropped off the toolbar, a double-click on an empty part opens the dialog; the layouts are kept per toolbar (`session.toolbarLayouts`); the Scripts toolbar starts with "Last script" alone and offers every script with an icon |

## 4. Toolbars

### `IDR_MAINFRAME TOOLBAR` (Commands toolbar, 24 px)

`ui/src/app/toolbarDefinitions.ts` lists the 31 buttons and the separators in the original order with the
original icons (`resources/icons/toolbar24`). Every button runs the command of the menu row
above; buttons marked "(menu)" are exercised through their menu item or hotkey, while the
toolbar itself is checked for presence (`00-smoke.spec.ts`) and tooltips (`us8-language.spec.ts`).

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `ID_FILE_NEW` | New | `file.new` | `toolbar-file.new` | `00-smoke.spec.ts`, `us1-open-save.spec.ts` | implemented | |
| `ID_FILE_OPEN` | Open | `file.open` | `toolbar-file.open`, `menu-file-open` | `us1-open-save.spec.ts` | implemented | (menu) |
| `ID_FILE_SAVE` | Save | `file.save` | `toolbar-file.save` | `us1-open-save.spec.ts` | implemented | |
| `ID_FILE_VALIDATE` | Validate | `file.validate` | `toolbar-file.validate`, `menu-file-validate` | `us4-source-validate.spec.ts` | implemented | (menu) |
| `ID_VIEW_DESC` | Description | `view.description` | `toolbar-view.description`, `view-description` | `us3-description.spec.ts` | implemented | (view switcher) |
| `ID_VIEW_BODY` | Body | `view.body` | `toolbar-view.body`, `view-body` | `us2-body-editing.spec.ts` | implemented | (view switcher) |
| `ID_VIEW_SOURCE` | Source | `view.source` | `toolbar-view.source` | `00-smoke.spec.ts` | implemented | |
| `ID_EDIT_ADDBINARY` | Add binary object | `insert.binary` | `toolbar-insert.binary`, `menu-add-binary` | `us7-images.spec.ts` | implemented | (menu) |
| `ID_EDIT_INS_IMAGE` | Insert image | `insert.image` | `toolbar-insert.image`, `menu-add-image` | `us7-images.spec.ts` | implemented | (menu) |
| `ID_EDIT_INS_INLINEIMAGE` | Insert inline image | `insert.inlineImage` | `toolbar-insert.inlineImage`, `menu-add-inlineImage` | `us7-images.spec.ts` | implemented | (menu) |
| `ID_EDIT_FIND` | Find | `edit.find` | `toolbar-edit.find`, `Control+f` | `us2-body-editing.spec.ts` | implemented | (hotkey) |
| `ID_EDIT_FINDNEXT` | Find next | `edit.findNext` | `toolbar-edit.findNext`, `F3` | `us2-body-editing.spec.ts` | implemented | (hotkey) |
| `ID_EDIT_CUT` | Cut | `edit.cut` | `toolbar-edit.cut`, `menu-edit-cut` | `us2-body-editing.spec.ts` | implemented | (menu) |
| `ID_EDIT_COPY` | Copy | `edit.copy` | `toolbar-edit.copy`, `Control+c` | `us2-body-editing.spec.ts` | implemented | (hotkey) |
| `ID_EDIT_PASTE` | Paste | `edit.paste` | `toolbar-edit.paste`, `menu-edit-paste` | `us2-body-editing.spec.ts` | implemented | (menu) |
| `ID_EDIT_UNDO` | Undo | `edit.undo` | `toolbar-edit.undo` | `us2-body-editing.spec.ts`, `us12-scripts.spec.ts` | implemented | |
| `ID_EDIT_REDO` | Redo | `edit.redo` | `toolbar-edit.redo` | `us2-body-editing.spec.ts` | implemented | |
| `ID_EDIT_BOLD` | Strong (toggle) | `style.strong` | `toolbar-style.strong` | `us2-body-editing.spec.ts` | implemented | toolbar-only in the original too; hotkey Ctrl+B |
| `ID_EDIT_ITALIC` | Emphasis (toggle) | `style.emphasis` | `toolbar-style.emphasis` | `us2-body-editing.spec.ts` | implemented | hotkey Ctrl+I |
| `ID_EDIT_SUP` | Sup (toggle) | `style.sup` | `toolbar-style.sup` | `us2-body-editing.spec.ts` | implemented | |
| `ID_EDIT_SUB` | Sub (toggle) | `style.sub` | `toolbar-style.sub` | `us2-body-editing.spec.ts` | implemented | |
| `ID_EDIT_STRIK` | Strikethrough (toggle) | `style.strikethrough` | `toolbar-style.strikethrough` | `us2-body-editing.spec.ts` | implemented | |
| `ID_EDIT_CODE` | Code (toggle) | `style.code` | `toolbar-style.code` | `us2-body-editing.spec.ts` | implemented | |
| `ID_STYLE_LINK` | Hyperlink | `style.link` | `toolbar-style.link`, `menu-style-link` | `us2-body-editing.spec.ts` | implemented | (menu) |
| `ID_STYLE_NOTE` | Footnote | `style.footnote` | `toolbar-style.footnote`, `menu-style-footnote` | `us2-body-editing.spec.ts` | implemented | (menu) |
| `ID_STYLE_NOLINK` | Remove links | `style.removeLink` | `toolbar-style.removeLink`, `menu-style-removeLink` | `us2-body-editing.spec.ts` | implemented | (menu) |
| `ID_GOTO_FOOTNOTE` | Go to footnote or reference | `edit.gotoFootnote` | `toolbar-edit.gotoFootnote`, `menu-edit-gotoFootnote` | `us2-body-editing.spec.ts` | implemented | (menu) |
| `ID_STYLE_NORMAL` | Normal | `style.normal` | `toolbar-style.normal`, `menu-style-normal` | `us2-body-editing.spec.ts` | implemented | (menu) |
| `ID_STYLE_SUBTITLE` | Subtitle | `style.subtitle` | `toolbar-style.subtitle` | `us2-body-editing.spec.ts` | implemented | |
| `ID_STYLE_TEXTAUTHOR` | Text author | `style.textAuthor` | `toolbar-style.textAuthor`, `menu-style-textAuthor` | `us2-body-editing.spec.ts` | implemented | (menu) |
| `ID_TOOLS_SPELLCHECK` | Check document spelling | `tools.spellcheck` | `toolbar-tools.spellcheck`, `menu-tools-spellcheck` | `us6-spelling.spec.ts` | implemented | (menu) |

### `IDR_MAINFRAME_SMALL` (16 px image list)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDR_MAINFRAME_SMALL` | 16 px icons shown next to the menu items of the command bar (`m_MenuBar.LoadImages`) | text-only menus (`app/MenuBar.tsx`); the same icons are on the Commands toolbar and in `resources/icons/toolbar16` | `menubar` | `00-smoke.spec.ts` | implemented-differently | the original showed the small icon of every command inside the menus; MFBE menus are text with accelerators - the icon set is converted and available, menu icons are a presentation detail (visual styling may differ, Constitution I). All 35 buttons of this image list are commands of section 1 |

### `IDR_SCRIPTS TOOLBAR`

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `ID_LAST_SCRIPT` | Last script | `scripts.last` (`scripting/catalog.ts`, `scripting/ScriptsToolbar.tsx`) | `toolbar-scripts.last`, `scripts-toolbar-items` | `us12-scripts.spec.ts` | implemented | the toolbar also shows every script with its icon (`scripts-toolbar-<id>`), as the original did at run time |

## 5. Dialogs (`IDD_*`)

### `IDD_FIND` - Find (`dialogs/FindDialog.tsx`, `dialog-find`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDD_FIND` | Find | `edit.find`, `FindDialog` | `dialog-find`, `dialog-find-title` | `us2-body-editing.spec.ts`, `us8-language.spec.ts`, `us5-find-modeless.spec.ts` | implemented | modeless as the original (feature 002): the document stays usable, the dialog moves by its title and the next one opens where the last one was closed; the match is selected and scrolled into view; works in Body, Source and Description fields (FR-035) |
| `IDC_TEXT` | Find what (combo with history) | `dialog-find-query` + `dialog-find-history` datalist | `dialog-find-query` | `us2-body-editing.spec.ts` | implemented | history persisted in settings |
| `ID_FIND_NEXT` | Find Next | `dialog-find-button-findNext` | `dialog-find-button-findNext` | `us2-body-editing.spec.ts`, `us5-find-modeless.spec.ts` | implemented | from the selection; continues from the other end with a beep; no match: "Cannot find the string '...'." (feature 002) |
| `IDC_WHOLE` | Match whole words | `dialog-find-whole-words` | `dialog-find-whole-words` | `us2-body-editing.spec.ts` | implemented | |
| `IDC_MATCHCASE` | Match case | `dialog-find-match-case` | `dialog-find-match-case` | `us2-body-editing.spec.ts` | implemented | |
| `IDC_REGEXP` | Regular expression | `dialog-find-regex` | `dialog-find-regex` | `us2-body-editing.spec.ts` | implemented | |
| `IDC_UP`, `IDC_DOWN` | Direction Up / Down | `dialog-find-up`, `dialog-find-down` | `dialog-find-up`, `dialog-find-down` | `us2-body-editing.spec.ts` | implemented | |
| `IDCANCEL` | Cancel | `dialog-find-button-cancel` | `dialog-find-button-cancel` | `us2-body-editing.spec.ts` | implemented | |

### `IDD_REPLACE` - Replace (`dialogs/ReplaceDialog.tsx`, `dialog-replace`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDD_REPLACE` | Replace | `edit.replace`, `ReplaceDialog` | `dialog-replace`, `dialog-replace-title` | `us2-body-editing.spec.ts`, `us3-description.spec.ts`, `us5-find-modeless.spec.ts` | implemented | modeless as Find (feature 002); Replace and Replace All are undoable steps, also in parts of a large book not displayed |
| `IDC_TEXT` | Find what | `dialog-replace-query` | `dialog-replace-query` | `us2-body-editing.spec.ts` | implemented | |
| `IDC_REPLACE` | Replace with (combo with history) | `dialog-replace-with` | `dialog-replace-with` | `us2-body-editing.spec.ts`, `us3-description.spec.ts` | implemented | |
| `IDC_WHOLE`, `IDC_MATCHCASE`, `IDC_REGEXP` | Match whole words / Match case / Regular expression | `dialog-replace-whole-words`, `dialog-replace-match-case`, `dialog-replace-regex` | `dialog-replace-query` | `us2-body-editing.spec.ts` | implemented | same option set as Find (shared `FindDialog` body); the Replace options are set through the Find options in the journey |
| `IDC_UP`, `IDC_DOWN` | Direction | `dialog-replace-up`, `dialog-replace-down` | `dialog-replace-query` | `us2-body-editing.spec.ts` | implemented | |
| `ID_FIND_NEXT` | Find Next | `dialog-replace-button-findNext` | `dialog-replace-button-findNext` | `us2-body-editing.spec.ts`, `us5-find-modeless.spec.ts` | implemented | nothing left: "Finished searching for '...'." (feature 002) |
| `IDC_REPLACE_ONE` | Replace | `dialog-replace-button-replace` | `dialog-replace-button-replace` | `us2-body-editing.spec.ts`, `us3-description.spec.ts` | implemented | |
| `IDC_REPLACE_ALL` | Replace All | `dialog-replace-button-replaceAll` | `dialog-replace-button-replaceAll`, `dialog-replace-all-done` | `us2-body-editing.spec.ts`, `us3-description.spec.ts` | implemented | reports the number of replacements, one undo step |
| `IDCANCEL` | Cancel | `dialog-replace-button-cancel` | `dialog-replace-button-cancel` | `us2-body-editing.spec.ts` | implemented | |

### `IDD_TABLE` - Table properties (`dialogs/TablePropertiesDialog.tsx`, `dialog-table`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDD_TABLE` | Table properties | `insert.table`, `TablePropertiesDialog` | `dialog-table`, `dialog-table-title` | `us2-body-editing.spec.ts`, `us8-language.spec.ts` | implemented | |
| `IDC_CHECK_TABLE_TITLE` | Add table header | `dialog-table-header` | `dialog-table-header` | `us2-body-editing.spec.ts` | implemented | |
| `IDC_EDIT_TABLE_ROWS`, `IDC_SPIN_TABLE_ROWS` | Number of table cells + spinner | `dialog-table-rows` (number input with spinner) | `dialog-table-rows` | `us2-body-editing.spec.ts` | implemented | |
| `IDOK`, `IDCANCEL` | OK / Cancel | `dialog-table-button-ok`, `dialog-table-button-cancel` | `dialog-table-button-ok`, `dialog-table-button-cancel` | `us2-body-editing.spec.ts`, `us8-language.spec.ts` | implemented | |

### `IDD_WORDS` - Words (`dialogs/WordsDialog.tsx`, `dialog-words`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDD_WORDS` | Words | `tools.words`, `WordsDialog` | `dialog-words`, `dialog-words-title` | `us10-words.spec.ts` | implemented | |
| `IDC_WLIST` | word list (Word / Replacement / Count, sortable) | `words-table`, `words-grid`, `words-row-<n>`, `words-sort-word`, `words-sort-replacement`, `words-sort-count` | `words-table`, `words-sort-count` | `us10-words.spec.ts` | implemented | |
| `IDC_REDIT` | inline replacement editor of the list | `words-row-<n>-replacement-input` | `words-row-` | `us10-words.spec.ts` | implemented | |
| `IDC_CHECK_SHOWHIDE_EXCLS` | Show/hide exclusions | `words-show-exclusions` | `words-show-exclusions` | `us10-words.spec.ts` | implemented | default from the Words settings page |
| `IDC_BUTTON_SELALL` | Highlight all | `words-highlight-all` | `words-highlight-all` | `us10-words.spec.ts` | implemented | |
| `IDC_BUTTON_DESEL` | Invert | `words-invert` | `words-invert` | `us10-words.spec.ts` | implemented | |
| `IDC_BUTTON_SETHLREPL` | Set replaced | `words-set-replaced` | `words-set-replaced` | `us10-words.spec.ts` | implemented | |
| `IDC_BUTTON_REMOVEHLREPL` | Reset replaced | `words-reset-replaced` | `words-reset-replaced` | `us10-words.spec.ts` | implemented | |
| `IDC_BUTTON_ADDHLTOEXCLS` | To exclusions | `words-to-exclusions` | `words-to-exclusions` | `us10-words.spec.ts` | implemented | |
| `IDC_BUTTON_SELALLREPL` | Set replaced all | `words-set-replaced-all` | `words-set-replaced-all` | `us10-words.spec.ts` | implemented | |
| `IDC_WORDS_FR_GBOX_CURWORD`, `IDC_WORDS_FR_TEXT_WORD`, `IDC_WORDS_FR_TEXT_REPL` | Current word group and labels | `words-current` | `words-current-word` | `us10-words.spec.ts` | implemented | |
| `IDC_WORDS_FR_EDIT_WORD`, `IDC_WORDS_FR_EDIT_REPL` | Word / Replacement (read-only) | `words-current-word`, `words-current-replacement` | `words-current-word`, `words-current-replacement` | `us10-words.spec.ts` | implemented | |
| `IDC_WORDS_FR_BTN_FIND` | Find | `words-find` | `words-find` | `us10-words.spec.ts` | implemented | Find / Next on the current word |
| `IDC_WORDS_FR_BTN_REPL` | Replace | `words-replace` | `words-replace` | `us10-words.spec.ts` | implemented | |
| `IDOK` | OK | `dialog-words-button-ok` | `dialog-words-button-ok`, `dialog-words-done` | `us10-words.spec.ts` | implemented | applies every replacement as one undo step, "N replacement(s) done" |
| `IDCANCEL` | Cancel | `dialog-words-button-cancel` | `dialog-words-button-cancel` | `us10-words.spec.ts` | implemented | |

### `IDD_SPELL_CHECK` - Spelling (`dialogs/SpellingDialog.tsx`, `dialog-spelling`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDD_SPELL_CHECK` | Spelling | `tools.spellcheck`, `SpellingDialog` | `dialog-spelling`, `dialog-spelling-title` | `us6-spelling.spec.ts` | implemented | dictionary switch added (`spelling-dictionary-<tag>`, FR-070) |
| `IDC_SPELL_BEDWORD` | Not In Dictionary | `spelling-not-in-dictionary` | `spelling-not-in-dictionary` | `us6-spelling.spec.ts` | implemented | |
| `IDC_SPELL_REPLACEMENT` | Change To | `spelling-change-to` | `spelling-change-to` | `us6-spelling.spec.ts` | implemented | |
| `IDC_SPELL_SUGG_LIST` | Suggestions | `spelling-suggestions`, `spelling-suggestion-<n>` | `spelling-suggestion-` | `us6-spelling.spec.ts` | implemented | |
| `IDC_SPELL_IGNORE` | Ignore | `spelling-ignore` | `spelling-ignore` | `us6-spelling.spec.ts` | implemented | |
| `IDC_SPELL_IGNOREALL` | Ignore All | `spelling-ignore-all` | `spelling-ignore-all` | `us6-spelling.spec.ts` | implemented | |
| `IDC_SPELL_CHANGE` | Change | `spelling-change` | `spelling-change` | `us6-spelling.spec.ts` | implemented | |
| `IDC_SPELL_CHANGEALL` | Change All | `spelling-change-all` | `spelling-change-all` | `us6-spelling.spec.ts` | implemented | |
| `IDC_SPELL_ADD` | Add | `spelling-add` | `spelling-add` | `us6-spelling.spec.ts` | implemented | persistent custom dictionary (scenario 4) |
| `IDC_SPELL_UNDO` | Undo last | `spelling-undo` | `spelling-undo` | `us6-spelling.spec.ts` | implemented | |
| `IDC_SPELL_SUGGEST` | "Suggets" (disabled button) | suggestions are refreshed automatically when the word changes | `spelling-suggestions` | `us6-spelling.spec.ts` | dropped | the button was permanently disabled (`WS_DISABLED`) and had no handler in the original; its purpose is served by the automatic suggestion list (FR-071 lists the working buttons only) |
| `IDCANCEL` | Cancel / completion message | `dialog-spelling-button-close`, `spelling-complete` | `dialog-spelling-button-close`, `spelling-complete` | `us6-spelling.spec.ts` | implemented | "The spelling check is complete" |

### `IDD_INPUTBOX` - Input (`dialogs/InputDialog.tsx`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDD_INPUTBOX` | Input (used by the script `InputBox` helper) | `InputDialog` (`showInput`), test id prefix given by the caller (`dialog-script-prompt` for scripts) | `dialog-script-prompt` | `us12-scripts.spec.ts` | implemented | |
| `IDC_PROMPT` | Text | `dialog-script-prompt-prompt` | `dialog-script-prompt` | `us12-scripts.spec.ts` | implemented | |
| `IDC_INPUT` | input field | `dialog-script-prompt-input` | `dialog-script-prompt-input` | `us12-scripts.spec.ts` | implemented | |
| `IDYES`, `IDNO` | Yes / No (yes-no-cancel variant) | `dialog-script-prompt-button-yes`, `dialog-script-prompt-button-no` (`yesNoCancel` option of `mfbe.ui.prompt`); OK variant `dialog-script-prompt-button-ok` | `dialog-script-prompt-button-ok` | `us12-scripts.spec.ts` | implemented | the journey uses the OK variant; the Yes/No/Cancel variant is covered by the unit tests of `InputDialog` |
| `IDCANCEL` | Cancel | `dialog-script-prompt-button-cancel` | `dialog-script-prompt` | `us12-scripts.spec.ts` | implemented | returns `null` to the script |

### `IDD_CUSTOMSAVEDLG` - encoding choice of the Save As dialog (`dialog.saveFile` `encodingChoices`, `app/src/file_dialog_*`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDD_CUSTOMSAVEDLG` | "Encoding:" combo embedded in the Windows Save As dialog (`IFileDialogCustomize`) | `file.saveAs`: the "Encoding:" choice inside the platform's Save As dialog - Windows `IFileDialogCustomize`, the GTK file chooser's choice, a macOS accessory pop-up - labelled in the interface language (`encodingLabel`) | `menu-file-saveAs`, `dialog-encoding` | `us3-file-dialogs.spec.ts`, `us1-open-save.spec.ts` | implemented | as the original (feature 002, decision D14); "Keep encoding" selects the file's encoding (`selectedEncoding`); `EncodingDialog` (`dialog-encoding`) asks only when a dialog answers without an encoding - the queued test dialogs and CEF's fallback dialog |
| `IDC_ENCODING` | encoding list | the nine encodings of `IDS_ENCODINGS` in the dialog's combo; `dialog-encoding-select` (`dialog-encoding-option-<enc>`) in `EncodingDialog` | `dialog-encoding-select` | `us1-open-save.spec.ts`, `us3-file-dialogs.spec.ts` | implemented | the original's order, the encoding of a plain Save selected |

### `IDD_ABOUTBOX` - About (`dialogs/AboutDialog.tsx`, `dialog-about`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDD_ABOUTBOX` | About | `help.about`, `AboutDialog` | `dialog-about`, `dialog-about-title` | `00-smoke.spec.ts`, `us8-language.spec.ts` | implemented | |
| `IDC_STATIC_AB_APPICON`, `IDC_STATIC_AB_APPNAMEVER` | application icon, name and version | `about-name`, `about-version` | `about-name` | `00-smoke.spec.ts` | implemented | |
| `IDC_STATIC_BUILD`, `IDC_BUILDSTAMP` | Build stamp | `about-build` | `dialog-about` | `00-smoke.spec.ts` | implemented | plus engine (`about-engine`), platform and API version |
| `IDC_SYSLINK_AB_LINKS` | project link | `about-repository` (opened in the OS browser by the shell) | `dialog-about` | `00-smoke.spec.ts` | implemented | |
| `IDC_CONTRIBS` | contributors text (`ABOUT_FILE`) | `about-contributors` (the original's `contributors.txt`, shipped as `CONTRIBUTORS.txt`, word for word in a scrollable read-only box) | `about-contributors` | `us10-licence.spec.ts` | implemented | with the GPL-3.0 notices `about-licence`, `about-copyright`, `about-gpl-notice`, `about-licence-link` (feature 002, FR-095 to FR-098) |
| `IDC_AB_STATIC_BANNER`, `IDC_AB_BANNER` | animated OpenGL logo with a bitmap fallback | - | - | - | dropped | decorative artwork of the original; visual styling may differ (Constitution I) |
| `IDC_TEXT_STATUS`, `IDC_PIC_UPDATE`, `IDC_UPDATE` | update check status, icon and "Update now" | - | - | - | dropped | the About dialog's downloader and installer are not reproduced (feature 002 FR-082: the check downloads and installs nothing); Help > Check for new version... (`help.checkVersion`) names a newer release with the original's messages and opens its page in the system browser |
| `IDOK` | OK | `dialog-about-button-close` | `dialog-about-button-close` | `00-smoke.spec.ts` | implemented | |

### `IDD_SETTINGS_VIEW` - Settings, View page (`dialogs/settings/ViewPage.tsx`, `settings-page-view`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDD_SETTINGS_VIEW` | View page | `settings-tab-view`, `settings-page-view` | `dialog-settings`, `settings-page-view` | `us9-settings.spec.ts`, `us8-language.spec.ts` | implemented | |
| `IDC_LANG` | Language | `settings-view-language` | `settings-view-language` | `us9-settings.spec.ts`, `us8-language.spec.ts` | implemented | restart prompt (`dialog-restart-prompt`) |
| `IDC_FONT`, `IDC_FONT_SIZE` | Body editor font and size | `settings-view-body-font`, `settings-view-body-font-size` | `settings-view-body-font`, `settings-view-body-font-size` | `us9-settings.spec.ts` | implemented | |
| `IDC_FG`, `IDC_BG` | Text color / Background | `settings-view-text-color`, `settings-view-background` | `settings-view-text-color`, `settings-view-background` | `us9-settings.spec.ts` | implemented | |
| `IDC_FAST_MODE` | Fast Mode | `settings-view-fast-mode` | `settings-view-fast-mode` | `us9-settings.spec.ts` | implemented | same setting as `ID_VIEW_FASTMODE` |
| `IDC_SRCFONT` | XML source editor font | `settings-view-source-font` (+ `settings-view-source-font-size`) | `settings-view-source-font` | `us9-settings.spec.ts`, `us4-source-validate.spec.ts` | implemented | |
| `IDC_WRAP` | Wrap lines | `settings-view-source-wrap` | `settings-view-source-wrap` | `us9-settings.spec.ts`, `us4-source-validate.spec.ts` | implemented | |
| `IDC_SYNTAXHL` | Syntax highlighting | `settings-view-source-highlight` | `settings-view-source-highlight` | `us9-settings.spec.ts` | implemented | |
| `IDC_SHOWEOL` | Show end of line marks | `settings-view-source-eol` | `settings-view-source-eol` | `us9-settings.spec.ts` | implemented | |
| `IDC_SHOWWHITESPACE` | Show white spaces | `settings-view-source-whitespace` | `settings-view-source-whitespace` | `us9-settings.spec.ts` | implemented | |
| `IDC_SHOWLINENUMBERS` | Show line numbers | `settings-view-source-line-numbers` | `settings-view-source-line-numbers` | `us9-settings.spec.ts`, `us4-source-validate.spec.ts` | implemented | |
| `IDC_TAGHL` | Highlight matched tags | `settings-view-source-match-tags` | `settings-view-source-match-tags` | `us9-settings.spec.ts` | implemented | |
| `IDC_USESPELLCHECKER` | Use spellchecker | `settings-view-spell-enabled` | `settings-view-spell-enabled` | `us9-settings.spec.ts` | implemented | |
| `IDC_BACKGROUNDSPELLCHECK` | Highlight misspelled words | `settings-view-spell-highlight` | `settings-view-spell-highlight` | `us9-settings.spec.ts` | implemented | |
| `IDC_CUSTOM_DICT`, `IDS_SPELL_CUSTOM_DICT`, `IDC_DICTPATH` | Custom dictionary path and "..." | `settings-view-custom-dictionary`, `settings-view-custom-dictionary-browse` | `settings-view-custom-dictionary` | `us9-settings.spec.ts` | implemented | folder picked through `dialog.pickFolder` |

### `IDD_SETTINGS_OTHER` - Settings, Other page (`dialogs/settings/OtherPage.tsx`, `settings-page-other`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDD_SETTINGS_OTHER` | Other page | `settings-tab-other`, `settings-page-other` | `dialog-settings`, `settings-page-other` | `us9-settings.spec.ts` | implemented | adds the genres folder group with "Open genres folder" and the effective-list sources (FR-091, FR-127) |
| `IDC_DEFAULT_ENC` | Default encoding | `settings-other-encoding` | `settings-other-encoding` | `us9-settings.spec.ts` | implemented | UTF-8 out of the box |
| `IDC_KEEP` | Keep Encoding | `settings-other-keep-encoding` | `settings-other-keep-encoding` | `us9-settings.spec.ts`, `us1-open-save.spec.ts` | implemented | |
| `IDC_RESTORE_POS` | Restore Position | `settings-other-restore-position` | `settings-other-restore-position` | `us9-settings.spec.ts` | implemented | caret remembered through `doc.caret` |
| `IDC_DEFAULT_SCRIPTS_FOLDER` | Default folder (scripts) | `settings-other-scripts-default` | `settings-other-scripts-default` | `us9-settings.spec.ts` | implemented | |
| `IDC_SCRIPTS_FOLDER_PATH`, `IDC_SELECT_SCRIPTS_FOLDER_BUTTON` | scripts folder path and "..." | `settings-other-scripts-path`, `settings-other-scripts-browse` (+ `settings-other-scripts-open`) | `settings-other-scripts-path`, `settings-other-scripts-browse` | `us9-settings.spec.ts` | implemented | |
| `IDC_SETTINGS_ASKIMAGE` | Ask for non clear image insertion | `settings-other-ask-non-clear` | `settings-other-ask-non-clear` | `us9-settings.spec.ts`, `us7-images.spec.ts` | implemented | |
| `IDC_OPTIONS_CLEARIMGS` | Insert clear images | `settings-other-insert-clear` | `settings-other-insert-clear` | `us9-settings.spec.ts` | implemented | |
| `IDC_IMAGETYPE` | Paste images as: Image format | `settings-other-image-format` | `settings-other-image-format` | `us9-settings.spec.ts`, `us7-images.spec.ts` | implemented | |
| `IDC_JPEGQUALITY`, `IDC_JPEGSPIN` | JPEG quality + spinner | `settings-other-jpeg-quality` (number input with spinner) | `settings-other-jpeg-quality` | `us9-settings.spec.ts` | implemented | |
| `IDC_NBSP_CHAR` | Non-breaking space display character | `settings-other-nbsp` | `settings-other-nbsp` | `us9-settings.spec.ts`, `us6-nbsp-marker.spec.ts` | implemented | as the original (feature 002): the plain space by default, markers □ ▫ ◦ drawn in place in the Body, annotation, history and Source views; a ° stored by 0.0.1 reads as the plain space |
| `IDC_CHANGE_KEYB`, `IDC_KEYB_LAYOUT` | Keyboard layout: Change on start / Change to | - | - | - | dropped | the Windows keyboard-layout auto-switch option is out of scope (spec.md "Out of scope") |

### `IDD_SETTINGS_HOTKEYS` - Settings, Hotkeys page (`dialogs/settings/HotkeysPage.tsx`, `settings-page-hotkeys`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDD_SETTINGS_HOTKEYS` | Hotkeys page | `settings-tab-hotkeys`, `settings-page-hotkeys` | `settings-hotkeys-groups` | `us9-settings.spec.ts` | implemented | groups File, Edit, Navigation, Style, View, Tools, Symbols, Scripts (the original's Plugins group is dropped with the plugin system) |
| `IDC_STATIC_HOTKEYS_GROUPS`, `IDC_LIST_HOTKEYS_GROUPS` | Groups list | `settings-hotkeys-groups`, `settings-hotkeys-group-<group>` | `settings-hotkeys-groups`, `settings-hotkeys-group-edit` | `us9-settings.spec.ts` | implemented | |
| `IDC_STATIC_HOTKEYS`, `IDC_LIST_HOTKEYS` | Commands list | `settings-hotkeys-commands`, `settings-hotkeys-command-<id>` | `settings-hotkeys-command-edit.undo` | `us9-settings.spec.ts` | implemented | shows the current shortcut per command (`settings-hotkeys-current`) |
| `IDC_EDIT_HOTKEY` | Shortcut capture control | `settings-hotkeys-capture` | `settings-hotkeys-capture` | `us9-settings.spec.ts` | implemented | |
| `IDC_STATIC_HOTKEY_ACTIONS`, `IDC_BUTTON_HOTKEY_ASSIGN` | Actions: Assign | `settings-hotkeys-assign` | `settings-hotkeys-assign` | `us9-settings.spec.ts` | implemented | |
| `IDC_BUTTON_HOTKEY_DELETE` | Delete | `settings-hotkeys-delete` | `settings-hotkeys-delete` | `us9-settings.spec.ts` | implemented | |
| `IDC_BUTTON_DEFAULT` | Default | `settings-hotkeys-default` | `settings-hotkeys-default` | `us9-settings.spec.ts` | implemented | defaults from `app/defaultHotkeys.ts` (the original's table, adapted per platform) |
| `IDC_STATIC_HOTKEY_COLLISION`, `IDC_EDIT_HOTKEY_COLLISION` | Assigned to (collision) | `settings-hotkeys-collision` | `settings-hotkeys-collision` | `us9-settings.spec.ts` | implemented | "Assigned to <command>" |
| `IDC_STATIC_HOTKEY_DESCRIPTION`, `IDC_EDIT_HOTKEY_DESCRIPTION` | Description | `settings-hotkeys-description` | `settings-hotkeys-description` | `us9-settings.spec.ts` | implemented | |

### `IDD_SETTINGS_WORDS` - Settings, Words page (`dialogs/settings/WordsPage.tsx`, `settings-page-words`)

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `IDD_SETTINGS_WORDS`, `IDC_STATIC_WORDS_CHEVRON` | Words page, "Word-exclusion list" group | `settings-tab-words`, `settings-page-words` | `settings-words-list` | `us9-settings.spec.ts` | implemented | |
| `IDC_LIST_WORDS` | exclusion list | `settings-words-list`, `settings-words-row-<word>` | `settings-words-list`, `settings-words-row-ibid` | `us9-settings.spec.ts` | implemented | |
| `IDC_EDIT_LV` | inline list editor (hidden in the original) | rows are removed and re-added instead of edited in place | `settings-words-list` | `us9-settings.spec.ts` | implemented-differently | the original kept a hidden edit control for in-place renaming; MFBE edits the list through Add / Remove selected, which covers the same outcome |
| `IDC_EDIT_NEW`, `IDC_BUTTON_ADD` | new word + Add | `settings-words-new`, `settings-words-add` | `settings-words-new`, `settings-words-add` | `us9-settings.spec.ts` | implemented | allowed-character validation (`dialog-exclusion-error`) |
| `IDC_CHECK_SELALL` | Select All | `settings-words-select-all` | `settings-words-select-all` | `us9-settings.spec.ts` | implemented | |
| `IDC_BUTTON_REMOVESEL` | Remove selected | `settings-words-remove` | `settings-words-remove` | `us9-settings.spec.ts` | implemented | |
| `IDC_CHECK_SHOW_EXCLUSIONS` | Show exclusions in Words dialog | `settings-words-show-exclusions` | `settings-words-show-exclusions` | `us9-settings.spec.ts` | implemented | |

## 6. Original UI created in the sources (not in `FBE.rc`)

These items are part of the original editor's behaviour (FR-023) but were built in code
(`mainfrm.cpp`, `FBEview.cpp`, `Speller.cpp`, `desc.xsl`); they are listed for completeness
with the same checks.

| Original | Label | MFBE | Evidence | e2e spec | Status | Notes |
|---|---|---|---|---|---|---|
| `BODY_CONTEXT_MENU*` | Body view context menu: Undo, Cut, Copy, Paste | `views/body/ContextMenu.tsx` running `edit.undo`, `edit.cut`, `edit.copy`, `edit.paste` | `context-menu` | `us2-body-editing.spec.ts` | implemented | |
| `DESCRIPTION_CONTEXT_MENU*` | Description view text fields: the Body view's menu (Undo, Cut, Copy, Paste; one browser view held both) | `views/description/FieldContextMenu.tsx` running `edit.undo` and the field's own Cut, Copy, Paste | `context-menu`, `description-book-title` | `us8-toolbars.spec.ts` | implemented | feature 002; nothing elsewhere in the view |
| `SOURCE_CONTEXT_MENU*` | Source view (Scintilla) menu: Undo, Redo, Cut, Copy, Paste, Delete, Select All | `views/source/SourceContextMenu.tsx` | `source-context-menu` | `us8-toolbars.spec.ts` | implemented | feature 002 |
| `EDIT_CONTEXT_MENU*` | text boxes of dialogs and of the Links and Table bars: the Windows edit menu (Undo, Cut, Copy, Paste, Delete, Select All) | shell `app/src/context_menu.h` (CEF `OnBeforeContextMenu`); the page cancels the browser's menu everywhere else (`app/App.tsx`) | `links-bar-id` | `us8-toolbars.spec.ts` | implemented | feature 002; the menu's items are checked by `tests/shell/test_context_menu.cpp` |
| `ID_SEL_BASE*` | "Select <element>" entries for every ancestor | `select-<depth>` entries (`contextMenuExtensions.ts`) | `context-menu` | `us2-body-editing.spec.ts` | implemented | scenario 6 selects a poem through the entry |
| `IDC_SPELL_ADD2DICT*` | spelling suggestions and "Add to dictionary" in the context menu | `features/spell/index.ts` (`context-menu-spelling-<n>`, `context-menu-spelling-add`, `context-menu-spelling-ignore-all`) | `context-menu-spelling-add` | `us6-spelling.spec.ts` | implemented | |
| `ID_SAVEIMG_AS*` | Save image as... | `image.saveAs` (`features/images/saveAs.ts`) | `context-menu-save-image-as` | `us7-images.spec.ts` | implemented | `binary.export` |
| `LINKS_BAR*` | Links bar: ID, Href, Section ID, Image title | `app/LinksBar.tsx` (`links-bar-id`, `links-bar-href`, `links-bar-section-id`, `links-bar-image-title`) | `links-bar-image-title` | `us2-body-editing.spec.ts` | implemented | focus hotkeys `nav.selectId`, `nav.selectHref` registered (Alt+H) |
| `TABLE_BAR*` | Table bar: table id/style, cell id/style, colspan, rowspan, row align, cell align, cell valign | `app/TableBar.tsx` (`table-bar-table-id`, `table-bar-table-style`, `table-bar-cell-id`, `table-bar-style`, `table-bar-colspan`, `table-bar-rowspan`, `table-bar-tr-align`, `table-bar-td-align`, `table-bar-td-valign`) | `table-bar-colspan` | `us2-body-editing.spec.ts` | implemented | scenario 10 |
| `STATUS_BAR*` | status bar: message, element path, INS/OVR pane | `app/StatusBar.tsx` (`status-message`, `status-path`, `status-insmode`) | `status-path`, `status-insmode` | `us2-body-editing.spec.ts`, `us4-source-validate.spec.ts` | implemented | overtype toggled with Insert (us4 scenario 8) |
| `DESCRIPTION_VIEW*` | Description view (`desc.xsl` form) | `views/description/` (`description-view`, `description-*`, `genre-picker`, `cover-picker`, `binary-objects`) | `description-view`, `description-genre-add` | `us3-description.spec.ts` | implemented | every section of US3, including Binary Objects |
| `BODY_VIEW*` | Body view (`main.html` / `main.js` editor) | `views/body/` over ProseMirror (`body-view`, `body-editor`) | `body-view` | `us2-body-editing.spec.ts` | implemented | section-windowed for large books (`perf-large-book.spec.ts`) |
| `SOURCE_VIEW*` | Source view (Scintilla) | `views/source/` over CodeMirror (`source-view`, `source-editor`, folding `source-fold-level`) | `source-view`, `source-fold-level` | `us4-source-validate.spec.ts` | implemented | collapse/expand levels 1-9 as commands `source.collapse<n>` / `source.expand<n>` |
| `SOURCE_TAG_COMPLETION*` | Source view: tag completion (addition, feature 003) | `edit.completeTag` (`views/source/completion.ts`; the list is `source-completion`, the table `fb2Elements.json` generated from the FB2 schema) | `settings-view-source-tag-completion`, `Control+Space` | `us4-source-completion.spec.ts` | implemented | no original counterpart (requester-approved, spec 003 US8): `<` offers the elements the schema allows at the cursor, `</` the open elements innermost first; Enter/Tab accept, Esc dismisses, Ctrl+Space on demand (Hotkeys page, Edit group); Settings > View > "Tag completion" |
| `DOCUMENT_TREE_PANEL*` | Document Tree panel ("Document structure") | `views/tree/DocumentTree.tsx` (`panel-tree`, `tree-content`, `tree-row-<id>`) | `tree-content` | `us5-tree.spec.ts` | implemented | |
| `BODY_ANNOTATION_HISTORY*` | annotation and history at the top of the editor view (`fb2.xsl` `mode="body"`: `div.annotation`, `div.history`, then the bodies; coloured borders, an empty paragraph when the element is empty) | `annotation_block` / `history_block` nodes of `editor/schema.ts` above the first body, bound to `titleInfo.annotation` / `documentInfo.history` (`editor/virtualization.ts`, `views/body/bodyEditor.ts`); captions by `editor/plugins/blockCaptions.ts`, the boundary filter `editor/plugins/blockBoundary.ts` | `body-block-annotation`, `body-block-history` | `us2-annotation-history.spec.ts` | implemented | feature 004 US2: the same datum as the Description view's fields (the original edited them in the editor view only); additions over the original - visible captions in the interface language, the schema's content in both blocks (the original allowed no subtitle in the history), a selection across a block boundary is copied but never deleted or cut, an element present but empty in the file is written back as read until either editor of it is edited (spec FR-010 to FR-012, FR-014, FR-015) |
| `DOCUMENT_TREE_ANNOTATION_HISTORY*` | "Annotation" and "History" nodes of the tree above "Body" (`ElementDescMnr.cpp` 226-235; `TreeView.cpp` in document order) | rows `desc:annotation` / `desc:history` of `views/tree/treeModel.ts` (kinds `annotationBlock` / `historyBlock`, icons `struct-12` / `struct-15`) | `tree-row-desc:annotation`, `tree-row-desc:history` | `us2-annotation-history.spec.ts` | implemented | feature 004 US2: always listed, whichever view is active; View and View Source work (the first `<annotation` inside `<title-info>`, the only `<history`), Move / Merge / Delete are unavailable for the two rows (spec FR-013) |
| `DOCUMENT_TREE_SPLITTER*` | Document Tree divider: the splitter between the tree and the view (`mainfrm.h` `m_splitter`; its position saved at exit as `SplitterPos`, default 200, no minimum widths) | `app/splitter.ts`, `app/App.tsx` (`tree-splitter`; the width stored as `session.treeWidth`) | `tree-splitter`, `tree-panel` | `us1-tree-divider.spec.ts` | implemented | feature 004 US1: dragged with the mouse beside every view (the original hid the tree beside its Source view); additions over the original's `SplitterPos` - the stored width defaults to 260 px (the fixed width of release 0.0.3), the pane stops at 160 px and the view at 320 px, and a window too narrow for the stored width clamps what is shown without rewriting the setting (spec FR-002, FR-003) |
| `FILE_IMPORT_DESCRIPTION*` | File > Import > Description from FictionBook file... (addition: the original had no description import; its Import submenu was filled by plugins) | `file.importDescription` (`features/transfer/importDescription.ts`, `features/transfer/importEntries.ts`, `features/transfer/ImportDescriptionDialog.tsx`; core `doc.readDescription`, `binary.copy`) | `menu-file-import-importDescription`, `dialog-import-description`, `import-entry-<key>-check`, `import-entry-<key>-value`, `import-entry-titleInfo.coverpage-picture`, `dialog-import-description-button-import` | `us4-import-description.spec.ts` | implemented | feature 004 US4: the chosen file's description read as Open reads a book, the entries of the Description view present in the file offered one by one, applied as a whole each (lists replaced, the plain rows of one `info-type` together, the role rows verbatim, the four document details filled in as 002 FR-005 does) in one undo step; silently into a never-saved document whose description is untouched, through the confirmation dialog - unticked checkboxes, the value as text, the cover with a small picture from the hidden import session - otherwise; image bytes cross inside the core (`binary.copy`), the previous cover stays unreferenced (spec FR-030 to FR-036) |
| `FILE_EXPORT_FBD*` | File > Export > Export as FBD... (addition: the original had no description export; its Export submenu was filled by plugins, ExportHTML the only one shipped) | `file.exportFbd` (`features/transfer/exportFbd.ts`; core `doc.exportDescription`, error 1006 `doc.sameAsOpenFile`) | `menu-file-export-exportFbd`, `dialog-export-validation-failed`, `dialog-export-same-file`, `dialog-export-failed` | `us5-export-fbd.spec.ts` | implemented | feature 004 US5: a copy of the description as it is in the editor, saved or not - the roles and other `custom-info` rows and the preserved `output` elements included - with the images it refers to (converted to JPEG/PNG in the copy alone) and one body holding one empty section, the smallest body the FB2 2.1 schema accepts, always UTF-8, written atomically; the save dialog offers the one type "FictionBook descriptors (*.fbd)" without an encoding choice and proposes `<stem>.fbd` in the document's folder or the proposed name of FR-050 in the remembered folder; the exported content is validated with Save's own "export anyway?" prompt; the open document's own file is refused by file identity; path, kind, encoding, modified state and Recent Files stay as they were (spec FR-040 to FR-044) |
| `SPELLING_SCOPE*` | Spelling scope: the original checked the text of its Body view only (`Speller.cpp`; `ID_TOOLS_SPELLCHECK` enabled while that view was current alone, `mainfrm.cpp` 1038-1049) | the editor's checker over the Body view's document alone - the spell plugin in the Body editor (`editor/plugins/spellcheck.ts`), the dialog's walk of annotation, history and bodies (`features/spell/dialogController.ts`); `spellcheck="false"` on the app root (`app/App.tsx`) and both ProseMirror roots; the engine's checker off through `browser.enable_spellchecking` (`app/src/mfbe_app.cpp`, `shelltest: spellcheck engine=off`) | `body-editor`, `description-annotation`, `description-sti-annotation`, `spelling-status`, `menu-tools-spellcheck`, `toolbar-tools.spellcheck` | `us9-spelling-scope.spec.ts` | implemented | feature 004 US9 (spec FR-080, FR-081): no field of the Description view is ever checked - the source title info's annotation included - and no mark but the editor's own appears anywhere, whatever dictionaries the system has (the German Windows dictionary of complaint 6.3); the annotation and history are checked in the Body view's blocks; unlike the original's Body-only command, `tools.spellcheck` and `tools.spellHighlight` keep their release 0.0.3 availability in every view (the dialog checks the Body text wherever it is started; the first draft's Body-only command was removed at the re-alignment of 2026-10-20) |
| `SCRIPTS_MENU_ENTRIES*` | Scripts menu groups and items, scripts toolbar icons, tree-command scripts | `scripting/ScriptsMenu.tsx`, `scripting/ScriptsToolbar.tsx`, `scripting/tree.ts` (`menu-scripts-<group>-<id>`, `scripts-toolbar-<id>`, `tree-menu-script-<id>`) | `scripts-toolbar-test.case.upper`, `tree-menu-script-test` | `us12-scripts.spec.ts` | implemented | |

Hotkey-only commands of the original (`Settings.cpp`, no menu or toolbar entry) are listed by
the Hotkeys page and checked by `ui/tests/unit/hotkeys.test.ts` against the original table:

* `edit.incrementalSearch` (Alt+I) - implemented, `us2-body-editing.spec.ts` scenario 9;
* `tools.spellHighlight` (toggle highlight) - implemented, Settings checkbox in us9;
* `nav.selectHref` (Alt+H), `nav.selectId`, `nav.selectTableId`, `nav.selectTree` (Alt+Q) -
  implemented (bar/tree focus), no journey presses them yet;
* `nav.nextItem` (Ctrl+Tab) and `nav.selectText` (Escape) - registered as disabled stubs: the
  browser's focus order and the dialogs' own Escape handling replace them; dropping or
  implementing them is an open decision for the requester;
* symbol hotkeys (`symbol.<n>`, `edit.insertNbsp`) - implemented from `resources/symbols.ini`,
  listed under the Symbols group in us9.

## 7. Summary

Counts are recomputed by `node tools/parity-check.mjs` (printed as
"rows - implemented N, implemented-differently N, dropped N"). At the time of writing:
226 rows covering the 191 distinct `FBE.rc` ids (menu items, toolbar buttons, dialogs and
their controls) plus the original UI created in the sources and the additions of later
features: 219 implemented, 2 implemented-differently, 5 dropped.

Dropped items and their references:

| Original | Reason |
|---|---|
| File > Import / Export placeholder entries (`IDCANCEL`) | Import/Export COM plugin interface and ExportHTML plugin out of scope (spec.md); feature 004 puts the editor's own description import in the Import submenu (US4) and the FBD export in the Export submenu (US5) |
| `IDC_SPELL_SUGGEST` "Suggets" | permanently disabled, no handler in the original; automatic suggestions |
| `IDC_AB_STATIC_BANNER`, `IDC_AB_BANNER` banner | decorative artwork; styling may differ (Constitution I) |
| `IDC_TEXT_STATUS`, `IDC_PIC_UPDATE`, `IDC_UPDATE` update downloader | not reproduced (feature 002 FR-082); Help > Check for new version... names a newer release and opens its page |
| `IDC_CHANGE_KEYB`, `IDC_KEYB_LAYOUT` keyboard layout switch | out of scope (spec.md) |

Implemented differently: `IDR_MAINFRAME_SMALL` (menu icons), `IDC_EDIT_LV` (exclusion list
editing).
