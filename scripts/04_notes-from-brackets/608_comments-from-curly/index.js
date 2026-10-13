// Converted from 04_Примечания и комментарии из скобок/608_Комментарии из {}.js (FictionBook Editor 2.7), Tier 2.
// Turns every fragment of the book enclosed in {} into a comment (link in the text, section in the comments body).
// The twelve scripts of this group share one engine (brackets-engine.js) and differ only in the
// bracket pair and the footnote/comment settings, like the originals' settings block.
import { COMMENTS, runBracketsScript } from './brackets-engine.js';

export default async function run(ctx) {
  await runBracketsScript(ctx, { ...COMMENTS, open: new RegExp('\\{', ''), close: new RegExp('\\}', '') });
}
