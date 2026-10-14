// Converted from 04_Примечания и комментарии из скобок/601_Примечания из [].js (FictionBook Editor 2.7), Tier 2.
// Turns every fragment of the book enclosed in [] into a footnote (link in the text, section in the footnotes body).
// The twelve scripts of this group share one engine (brackets-engine.js) and differ only in the
// bracket pair and the footnote/comment settings, like the originals' settings block.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// извлечение сносок из разных скобок
// написал Sclex
import { FOOTNOTES, runBracketsScript } from './brackets-engine.js';

export default async function run(ctx) {
  await runBracketsScript(ctx, { ...FOOTNOTES, open: new RegExp('\\[', ''), close: new RegExp('\\]', '') });
}
