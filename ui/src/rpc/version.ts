/**
 * The RPC contract's version and revision (rpc-api.md §6), in a module of their own with no imports, so
 * that the journeys read them too (tests/e2e/00-smoke.spec.ts) - one value for the interface and its tests.
 * `@/rpc/types` re-exports them.
 */

export const RPC_API_VERSION = 1;
/**
 * Additive contract revision within RPC_API_VERSION (`app.info().apiMinor`; absent = 0). The
 * revision this UI was written for (11 since feature 012: `epub.open`, `epub.close`, the
 * `epub.write.*` methods, the binary routes `/epub/{token}/{entry}` and `/epub-write/{token}/{name}`,
 * the errors `epubRefused` and `epubWriteFailed`; 10 since feature 011: `export.markdown`, `styles.check`,
 * the dialogs' `role`, the issue codes `description.emptyAuthor`,
 * `style.conflict` and `style.unreadable`, `test.slowJobs`; 9 since feature 010: `import.readMarkdown`, `template.xml`,
 * `doc.newFromXml`, `binary.add`'s `imagesOnly`, `BinaryMeta.transparent`, the models' `efforts`
 * of `ai.models`, the service list's known models, `test.holdStartup`; 8 since feature 009: books in ZIP archives - `doc.open` with
 * `entry` and `needsChoice`, `Document.source`, `files.inspect`, the archive errors - backups and
 * ZIP saves through `doc.save`, the Save As dialog's ZIP checkbox, `binary.rename`, and the
 * settings `other.keepBackup` and `view.statusBarPanes`; 7 since feature 008: the open requests
 * between copies -
 * `app.openRequest`, `app.openRequestAck`, `app.openInNewCopy`, `app.bookHolder`,
 * `app.activateCopy`, `app.copyState`, `app.activated` - and the settings `other.openFromOutside`
 * and `view.spellExtraDictionaries`; 6 since feature 007: the scripts' `legacy.sourceVersion`,
 * `origin` and `overrides`, the group icon route, package isolation, `files.saveText` and
 * `files.saveBinaries`, the script backups; 5 since feature 006: the cell's and the marks'
 * languages, marks on inline atoms, the writer's link rule, `session.tableDialog`); it accepts
 * any core answering minor >= 1 (rpc-api.md §6) - the client performs no minor check at connect
 * time and gates nothing on 8; the AI assistant (feature 005) reads `app.info().apiMinor` itself
 * and requires >= 5 since feature 006 (`AI_REQUIRED_API_MINOR` in `ui/src/ai/index.ts`; 4
 * before).
 */
export const RPC_API_MINOR = 11;
