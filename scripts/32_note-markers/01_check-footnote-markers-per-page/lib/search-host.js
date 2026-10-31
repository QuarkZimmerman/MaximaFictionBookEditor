// The host of the "Поиск некорректных маркеров ..." scripts converted from FictionBook Editor 2.7.9
// (group 32: 01-04 carry byte-identical copies; the sandbox only loads modules from the script's
// own folder). engine.js of each package is the original's code; this module gives it what the
// original took from FictionBook Editor's page and window:
//   innerHTML      fbw_body.innerHTML, rebuilt from the book (lib/marker-page.js);
//   chooseMarker() the dialog "HTML/Поиск некорректных маркеров сносок - выбор из вариантов.htm"
//                  as a form: the kind of markers, as the strings the dialog returned; its Help
//                  button (a window of hints) is not there;
//   msgBox, alert  a message box; confirm: a message box with OK and Cancel (true for OK);
//   status         the status bar text, kept after the run as FictionBook Editor's stayed;
//   select         PerehodFinal: the marker the script picked, selected in the book.

import { pageHtml, selectMarker } from './marker-page.js';

/** Russian in the Russian interface, English otherwise (FR-026 of feature 007). */
export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

// The dialog's choices, in its order, and the strings it returned (markerFunc).
const KINDS = [
  { value: 'sup', sign: 'надстрочным текстом', en: 'superscript' },
  { value: 'asterisks', sign: 'вида *', en: 'like *' },
  { value: 'square', sign: 'вида [1]', en: 'like [1]' },
  { value: 'curly', sign: 'вида {1}', en: 'like {1}' },
  { value: 'square-tilde', sign: 'вида [~1~]', en: 'like [~1~]' },
  { value: 'curly-tilde', sign: 'вида {~1~}', en: 'like {~1~}' },
];

async function chooseMarker(ctx) {
  const answer = await mfbe.ui.form({
    title: t(ctx, 'Поиск некорректных маркеров сносок', 'Find faulty footnote markers'),
    fields: [
      {
        kind: 'radio',
        id: 'kind',
        label: t(ctx, 'Выберите вид маркеров сносок:', 'Choose the kind of footnote markers:'),
        options: KINDS.map((k) => ({ value: k.value, label: t(ctx, k.sign, k.en) })),
        value: KINDS[0].value,
      },
    ],
    okLabel: t(ctx, 'Найти ошибочные маркеры', 'Find faulty markers'),
    cancelLabel: t(ctx, 'Отмена', 'Cancel'),
  });
  if (!answer) return null;
  return KINDS.find((k) => k.value === answer.kind)?.sign ?? null;
}

/** The host object engine(host, tx) works with, over a snapshot of the book. */
export function searchHost(ctx, snapshot) {
  const page = pageHtml(snapshot);
  return {
    innerHTML: page.html,
    chooseMarker: () => chooseMarker(ctx),
    msgBox: async (text) => {
      await mfbe.ui.message(String(text));
    },
    alert: async (text) => {
      await mfbe.ui.message(String(text));
    },
    confirm: async (text) =>
      (await mfbe.ui.message(String(text), {
        icon: 'question',
        buttons: [
          { id: 'ok', label: '', default: true },
          { id: 'cancel', label: '', cancel: true },
        ],
      })) === 'ok',
    status: async (text) => {
      await mfbe.ui.status(String(text), { sticky: true });
    },
    select: async (txt, res, re, dlina) => {
      await selectMarker(page.places, txt, res, re, dlina);
    },
  };
}
