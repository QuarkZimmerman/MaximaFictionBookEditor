// Converted from 04_Примечания и комментарии из скобок/612_Комментарии из скобок, заданных простым текстом.js (FictionBook Editor 2.7), Tier 2.
// Asks the two brackets as plain text ("[ ]") and turns every bracketed fragment of the book into a comment.
// The twelve scripts of this group share one engine (brackets-engine.js) and differ only in the
// bracket pair and the footnote/comment settings, like the originals' settings block.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// извлечение сносок из разных скобок
// написал Sclex
import { askBrackets, COMMENTS, runBracketsScript } from './brackets-engine.js';

export default async function run(ctx) {
  const brackets = await askBrackets(ctx, 'text');
  if (!brackets) return;
  await runBracketsScript(ctx, { ...COMMENTS, ...brackets });
}
