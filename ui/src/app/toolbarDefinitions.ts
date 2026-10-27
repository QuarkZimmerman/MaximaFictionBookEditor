/** Toolbar model: button order of the original Commands toolbar and the icon URL helper. */

/**
 * `IDR_MAINFRAME TOOLBAR 24, 24` - `null` marks a separator. The AI assistant's button
 * (feature 005, research R8.6) follows the three view buttons; it renders nothing while the
 * assistant is disabled (`Command.visible`), and a customised layout stored before it existed
 * does not gain it by itself (Customize or Reset do).
 */
export const COMMANDS_TOOLBAR: readonly (string | null)[] = [
  'file.new',
  'file.open',
  'file.save',
  null,
  'file.validate',
  null,
  'view.description',
  'view.body',
  'view.source',
  'ai.toggle',
  null,
  'insert.binary',
  'insert.image',
  'insert.inlineImage',
  null,
  'edit.find',
  'edit.findNext',
  null,
  'edit.cut',
  'edit.copy',
  'edit.paste',
  null,
  'edit.undo',
  'edit.redo',
  null,
  'style.strong',
  'style.emphasis',
  'style.sup',
  'style.sub',
  'style.strikethrough',
  'style.code',
  null,
  'style.link',
  'style.footnote',
  'style.removeLink',
  'edit.gotoFootnote',
  null,
  'style.normal',
  'style.subtitle',
  'style.textAuthor',
  null,
  'tools.spellcheck',
];

/**
 * The buttons the Commands toolbar offers beyond its original layout (feature 006, FR-041;
 * data-model §9.4): *Table…* and the 24 table commands in the order of FR-039. None is shown
 * by default or after Reset; the user adds them in Customize.
 */
export const COMMANDS_TOOLBAR_OFFERED: readonly string[] = [
  'insert.table',
  'table.insertRowAbove',
  'table.insertRowBelow',
  'table.deleteRow',
  'table.insertColumnLeft',
  'table.insertColumnRight',
  'table.deleteColumn',
  'table.mergeCells',
  'table.splitCell',
  'table.toggleHeaderCell',
  'table.makeHeaderCells',
  'table.makeNormalCells',
  'table.toggleHeaderRow',
  'table.toggleHeaderColumn',
  'table.repair',
  'table.select',
  'table.delete',
  'table.moveRowUp',
  'table.moveRowDown',
  'table.moveColumnLeft',
  'table.moveColumnRight',
  'table.duplicateRow',
  'table.duplicateColumn',
  'table.paragraphBefore',
  'table.paragraphAfter',
];

export function iconUrl(icon: string, size: 16 | 24 = 24): string {
  return `${import.meta.env.BASE_URL}icons/toolbar${size}/${icon}.png`;
}
