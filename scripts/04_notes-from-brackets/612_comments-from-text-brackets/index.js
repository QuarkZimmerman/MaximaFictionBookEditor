// Converted from FictionBook Editor 2.7: Scripts/04_Примечания и комментарии из скобок/612_Комментарии из скобок, заданных простым текстом.js,
// brought up to FictionBook Editor 2.7.9 (the same file name; see brackets-engine.js), Tier 2.
// Asks the two brackets as plain text ("[ ]") and turns every bracketed fragment of the book into a comment.
// The twelve scripts of this group share one engine (brackets-engine.js) and differ only in the
// bracket pair and the footnote/comment settings, like the originals' settings block.
// The original's notice, kept as written (FR-029):
// извлечение сносок из разных скобок
// написал Sclex
import { askBrackets, COMMENTS, runBracketsScript } from './brackets-engine.js';

export default async function run(ctx) {
  const brackets = await askBrackets(ctx, 'text');
  if (!brackets) return;
  await runBracketsScript(ctx, { ...COMMENTS, ...brackets });
}
