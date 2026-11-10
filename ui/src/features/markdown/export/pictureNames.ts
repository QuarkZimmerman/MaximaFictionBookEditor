/**
 * Feature 011 (US5, US6; D24; contracts/markdown-export.md §5): the file names of the exported
 * pictures, made from their ids. A character Windows, macOS or Linux refuses in a file name becomes
 * `_`, a name Windows reserves (`CON`, `NUL`, `COM1`…) gets `_` after it, names stay unique without
 * regard to letter case (`-2`, `-3`… before the extension), and the type's extension is added when
 * the id has none. The one-file form's pictures are all JPEG: their names end in `.jpg`.
 */

export interface PictureToName {
  id: string;
  contentType: string;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tif',
  'image/svg+xml': 'svg',
};

const KNOWN_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'svg',
]);

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** The id as a name every system accepts (no extension handling). */
function safeBase(id: string): string {
  // Windows refuses <>:"/\|?* and control characters, macOS ':', Linux '/' and NUL.
  // eslint-disable-next-line no-control-regex
  let name = id.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_');
  // Windows refuses a name ending in a dot or a space.
  name = name.replace(/[. ]+$/, (tail) => '_'.repeat(tail.length));
  if (!name) name = 'picture';
  return name;
}

function splitExtension(name: string): { base: string; extension: string | null } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, extension: null };
  const extension = name.slice(dot + 1);
  return KNOWN_EXTENSIONS.has(extension.toLowerCase())
    ? { base: name.slice(0, dot), extension }
    : { base: name, extension: null };
}

/** The names of `pictures`, by id, for the `form` of the export. */
export function pictureNames(
  pictures: readonly PictureToName[],
  form: 'md' | 'zip',
): Map<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const picture of pictures) {
    const split = splitExtension(safeBase(picture.id));
    let base = split.base;
    // A reserved name is reserved with any extension too (`con.jpg`); the part before the
    // first dot decides.
    const head = base.split('.')[0] ?? base;
    if (RESERVED.test(head)) base = `${head}_${base.slice(head.length)}`;
    const extension =
      form === 'md' ? 'jpg' : (split.extension ?? EXTENSIONS[picture.contentType] ?? 'bin');
    let name = `${base}.${extension}`;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base}-${n}.${extension}`;
    taken.add(name.toLowerCase());
    names.set(picture.id, name);
  }
  return names;
}
