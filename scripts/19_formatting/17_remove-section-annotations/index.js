// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/17_Удалить все аннотации разделов и их содержимое.js
// Removes the annotation of every section with its content, from the last to the first as the
// original did. The book's own annotation (title-info), which the original skipped as the
// annotation standing directly in its page's body, is not a node of the bodies and stays. The
// count goes to the status bar; without any section annotation a message says so. The
// original's Run() returned nothing, nor does run().
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить все аннотации разделов и их содержимое" v1.0
// Автор Sclex

import { t } from './lib/text-blocks.js';

export default async function run(ctx) {
  const annotations = await mfbe.doc.getElementsByTagName('annotation');
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    if (ctx.cancelled) return;
    await mfbe.ui.progress(annotations.length - i, annotations.length);
    await mfbe.doc.removeNode(annotations[i]);
  }
  if (annotations.length === 0) {
    await mfbe.ui.message(
      t(
        ctx,
        'Аннотаций разделов в документе не нашлось.',
        'No section annotations were found in the document.',
      ),
    );
    return;
  }
  await mfbe.ui.status(
    t(
      ctx,
      `Удалено аннотаций разделов с их содержимым: ${annotations.length}.`,
      `Section annotations removed with their content: ${annotations.length}.`,
    ),
    { sticky: true },
  );
}
