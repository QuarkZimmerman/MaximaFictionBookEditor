// Converted from 18_Мелочи редактирования/07_Обрамить верхние индексы скобками [].js (FictionBook
// Editor 2.7), Tier 2. Encloses the content of every superscript in the book in [ ].
import { bracketSuperscripts } from './sup-brackets.js';

export default async function run(ctx) {
  await bracketSuperscripts(ctx, '[', ']');
}
