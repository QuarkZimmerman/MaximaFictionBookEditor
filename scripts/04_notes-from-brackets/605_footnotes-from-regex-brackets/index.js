// Converted from 04_Примечания и комментарии из скобок/605_Примечания из скобок, заданных регэкспами.js (FictionBook Editor 2.7), Tier 2.
// Asks two regular expressions (opening and closing bracket) and turns every bracketed fragment of the book into a footnote.
// The twelve scripts of this group share one engine (brackets-engine.js) and differ only in the
// bracket pair and the footnote/comment settings, like the originals' settings block.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// извлечение сносок из разных скобок
// написал Sclex
import { askBrackets, FOOTNOTES, runBracketsScript } from './brackets-engine.js';

export default async function run(ctx) {
  const brackets = await askBrackets(ctx, 'regex');
  if (!brackets) return;
  await runBracketsScript(ctx, { ...FOOTNOTES, ...brackets });
}
