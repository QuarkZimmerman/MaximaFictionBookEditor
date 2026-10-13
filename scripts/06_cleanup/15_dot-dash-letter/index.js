// Converted from 06_Чистка/15_Точка, тире, буква....js (FictionBook Editor): the HTML dialog
// "Точка, тире, буква" became a form per finding; see dot-dash-letter.js.
import { dotDashLetter } from './dot-dash-letter.js';

export default async function run(ctx) {
  await dotDashLetter(ctx, { withEllipsis: true });
}
