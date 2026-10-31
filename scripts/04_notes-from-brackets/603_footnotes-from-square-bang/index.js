// Converted from FictionBook Editor 2.7: Scripts/04_Примечания и комментарии из скобок/603_Примечания из [! !].js,
// brought up to FictionBook Editor 2.7.9 (the same file name; see brackets-engine.js), Tier 2.
// Turns every fragment of the book enclosed in [! !] into a footnote (link in the text, section in the footnotes body).
// The twelve scripts of this group share one engine (brackets-engine.js) and differ only in the
// bracket pair and the footnote/comment settings, like the originals' settings block.
// The original's notice, kept as written (FR-029):
// извлечение сносок из разных скобок
// написал Sclex
import { FOOTNOTES, runBracketsScript } from './brackets-engine.js';

export default async function run(ctx) {
  await runBracketsScript(ctx, { ...FOOTNOTES, open: new RegExp('\\[!', ''), close: new RegExp('!\\]', '') });
}
