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

export function iconUrl(icon: string, size: 16 | 24 = 24): string {
  return `${import.meta.env.BASE_URL}icons/toolbar${size}/${icon}.png`;
}
