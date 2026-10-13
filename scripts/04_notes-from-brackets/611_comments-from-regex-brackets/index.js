// Converted from 04_Примечания и комментарии из скобок/611_Комментарии из скобок, заданных регэкспами.js (FictionBook Editor 2.7), Tier 2.
// Asks two regular expressions (opening and closing bracket) and turns every bracketed fragment of the book into a comment.
// The twelve scripts of this group share one engine (brackets-engine.js) and differ only in the
// bracket pair and the footnote/comment settings, like the originals' settings block.
import { askBrackets, COMMENTS, runBracketsScript } from './brackets-engine.js';

export default async function run(ctx) {
  const brackets = await askBrackets(ctx, 'regex');
  if (!brackets) return;
  await runBracketsScript(ctx, { ...COMMENTS, ...brackets });
}
