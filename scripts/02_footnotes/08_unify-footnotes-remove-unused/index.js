// Converted from 02_Добавление примечания/08_Унификация сносок (с удалением неиспользуемых разделов сносок).js (FictionBook Editor 2.7), Tier 2.
// Removes the footnote sections no link points to, then renumbers the footnote sections and links.
// The nine scripts of this group share one engine (notes-engine.js) and differ only in these
// settings, exactly like the originals differed in their settings block.
import { FOOTNOTES, runNotesScript } from './notes-engine.js';

export default async function run(ctx) {
  await runNotesScript(ctx, { ...FOOTNOTES, ...{ addNote: false, inputText: false, moveFocus: false, lastMode: false, endWindow: true, removeUnused: true } });
}
