// Converted from 17_Перенос примечаний в скобки/02_Перенос примечаний в скобки (пробел перед
// открывающей скобкой).js (FictionBook Editor 2.7), Tier 2. Same as script 01 with a space in
// front of the opening bracket.
import { moveAllNotes } from './move-all.js';

export default async function run(ctx) {
  await moveAllNotes(ctx, { spaceBefore: true });
}
