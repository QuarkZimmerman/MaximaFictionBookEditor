// Shared helper of the scripts by Александр Ка converted from FictionBook Editor 2.7.9's group
// 05_Иллюстрации (17 "Исключение копий вложенных файлов", 20 "Обновить иллюстрации (версия
// Александра Ка)", 25 "Коррекция jpg-png"). Each package carries its own copy: the sandbox only
// loads modules from the script's own folder.
//
// The originals read the pictures of fbw_body - the IMG elements of the book's annotation, the
// history and every body, the address being the `href` of the picture's outer element - the cover
// pages of the description form (the title-info and src-title-info cover lists) and the binary
// objects panel (id, size, the width and height of an image). This module gives the same lists
// from the document model and changes a picture's address: in a body with `doc.replaceNode`, in
// the book annotation or the history in the description, which the caller writes back with
// `doc.setDescription`.

export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/**
 * The book's snapshot and its pictures in fbw_body order: `{ node, inDescription }` for every
 * block and inline picture of the book annotation, the history and the bodies.
 */
export async function loadPictures() {
  const doc = await mfbe.doc.get();
  const pictures = [];
  const visit = (node, inDescription) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (node.type === 'image' || node.type === 'inline-image') {
      pictures.push({ node, inDescription });
      return;
    }
    for (const child of node.content ?? []) visit(child, inDescription);
  };
  visit(doc.description?.titleInfo?.annotation, true);
  visit(doc.description?.documentInfo?.history, true);
  for (const body of doc.bodies ?? []) visit(body, false);
  return { doc, pictures };
}

/** The address of a picture without its leading "#" (the original's `href.replace(/^#/, "")`). */
export function nameOf(picture) {
  return String(picture.node.attrs?.href ?? '').replace(/^#/, '');
}

/** The names of the covers set in the title-info and src-title-info lists, without "#". */
export function coverNames(description) {
  const names = [];
  for (const info of [description?.titleInfo, description?.srcTitleInfo]) {
    for (const image of info?.coverpage ?? []) {
      const name = String(image.href ?? '').replace(/^#/, '');
      if (name !== '') names.push(name);
    }
  }
  return names;
}

/**
 * Whether the binary panel showed the image's width and height: an image the editor decodes
 * (FictionBook Editor read them for a content type naming an image).
 */
export function hasDims(binary) {
  return /image/.test(binary.contentType ?? '') && typeof binary.width === 'number' && typeof binary.height === 'number';
}

/**
 * Gives a picture the address `#name`: in a body at once, in the description in the snapshot
 * (returns true then: the caller writes the description back).
 */
export async function rename(picture, name) {
  const { node } = picture;
  node.attrs = { ...(node.attrs ?? {}), href: `#${name}` };
  if (picture.inDescription) return true;
  const attrs = { ...node.attrs };
  delete attrs.nodeId;
  const replacement = { type: node.type, attrs };
  if (node.marks?.length) replacement.marks = node.marks;
  await mfbe.doc.replaceNode(node.attrs.nodeId, replacement);
  return false;
}

/** The original's time taken: seconds (five characters of the number, comma for the point) or minutes and seconds. */
export function tempusOf(ctx, ms) {
  const Tmin = Math.floor(ms / 60000);
  const TsecD = (ms % 60000) / 1000;
  const Tsec = Math.floor(TsecD);
  if (Tmin === 0) {
    const seconds = String(+String(TsecD).replace(/(.{1,5}).*/g, '$1'));
    return t(ctx, `${seconds.replace('.', ',')} сек`, `${seconds} s`);
  }
  let tempus = t(ctx, `${Tmin} мин`, `${Tmin} min`);
  if (Tsec !== 0) tempus += t(ctx, ` ${Tsec} с`, ` ${Tsec} s`);
  return tempus;
}

/** The original's closing line "• D.MM.YY • H:MM:SS •". */
export function dateLine(now = new Date()) {
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const month = String(1 + now.getMonth()).padStart(2, '0');
  const year = String(now.getFullYear()).replace(/^.*?(\d{1,2})$/g, '$1');
  return `• ${now.getDate()}.${month}.${year} • ${now.getHours()}:${minutes}:${seconds} •`;
}
