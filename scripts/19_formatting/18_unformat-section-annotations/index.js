// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/18_Расформатировать все аннотации разделов.js
// Dissolves the annotation of every section, from the last to the first as the original did:
// its content stays in its place, where it opens the section's text, and the annotation and its
// id go. The book's own annotation (title-info), which the original skipped as the annotation
// standing directly in its page's body, is not a node of the bodies and stays. In a section of
// sections the content cannot stand in the annotation's place (FB2 does not mix text and
// sections; the original left it there, which 2.7.9 refused to save until it was mended): it
// becomes a section of its own, untitled, before the first section (lib/containers.js). The
// count goes to the status bar; without any section annotation a message says so. The
// original's Run() returned nothing, nor does run().
// The original's notice, kept as written (FR-029):
// Скрипт "Расформатировать аннотации разделов" v1.0
// Автор Sclex

import { placeOf, placements, writeParentContent } from './lib/containers.js';
import { t } from './lib/text-blocks.js';

export default async function run(ctx) {
  let found = 0;
  let unformatted = 0;
  const annotations = await mfbe.doc.getElementsByTagName('annotation');
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    if (ctx.cancelled) return;
    await mfbe.ui.progress(annotations.length - i, annotations.length);
    const place = await placeOf(annotations[i].nodeId);
    if (!place) continue;
    found += 1;
    const lines = place.parent.content[place.index].content ?? [];
    if (
      await writeParentContent(
        place.parentId,
        place.parent,
        placements(place.parent, place.index, lines),
      )
    ) {
      unformatted += 1;
    }
  }
  if (found === 0) {
    await mfbe.ui.message(
      t(
        ctx,
        'Аннотаций разделов в документе не нашлось.',
        'No section annotations were found in the document.',
      ),
    );
    return;
  }
  const left = found - unformatted;
  await mfbe.ui.status(
    t(
      ctx,
      `Расформатировано аннотаций разделов: ${unformatted}.` +
        (left ? ` Оставлено аннотаций: ${left} — их содержимое недопустимо на их месте.` : ''),
      `Section annotations unformatted: ${unformatted}.` +
        (left ? ` Annotations left: ${left} - their content cannot stand in their place.` : ''),
    ),
    { sticky: true },
  );
}
