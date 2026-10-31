// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/145_Выделить предыдущую аннотацию.js
// Selects the previous annotation (block-search.js): from the end of the selection, the first
// paragraph of one other than the annotation the caret is in; that whole annotation is selected.
// Returns "Found", or "NotFound" after saying that none was found (as the original's Run() did).
// Differences from the original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить предыдущую аннотацию» (annotation)
// Автор Sclex, сборка TaKir
// Версия 1.1

import { runContainerSearch } from './block-search.js';
import { hasContainer } from './nav-lib.js';

export default async function run(ctx) {
  return runContainerSearch(ctx, {
    forward: false,
    cls: 'annotation',
    check: (p) => hasContainer(p, 'annotation'),
    status: { ru: 'Переходим на предыдущую аннотацию…', en: 'Going to the previous annotation…' },
    notFound: {
      ru: 'До начала документа не нашлось ни одной аннотации.',
      en: 'No annotation was found up to the beginning of the document.',
    },
  });
}
