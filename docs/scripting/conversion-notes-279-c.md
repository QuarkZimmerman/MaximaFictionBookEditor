# FictionBook Editor 2.7.9 scripts — groups 21 to 99, the root script and TreeCmd (feature 007)

Part of [conversion-notes-279.md](conversion-notes-279.md), whose rules apply. For each group:
the scripts converted (new since 2.7beta1), the packages rechecked against their 2.7.9 version,
the scripts not converted with their reasons, the fixes and the open questions - the same facts
as the group's entries of `tests/scripts/audit/inventory-279.json`.

## (top level)

1 script in 2.7.9: 0 new, 0 successors of converted packages, 1 successor(s) of scripts the 2.7beta1 conversion dropped. Not yet converted or rechecked.

## 21_Поиск и замена

25 scripts in 2.7.9: 23 new, 2 successors of converted packages. Not yet converted or rechecked.

## 22_Дескрипшен

7 scripts in 2.7.9: 7 new, 0 successors of converted packages. Not yet converted or rechecked.

## 30_'Числовые' скрипты

13 scripts in 2.7.9: 12 new, 1 successors of converted packages. Not yet converted or rechecked.

## 31_Автоматизация

6 scripts in 2.7.9: 6 new, 0 successors of converted packages. Not yet converted or rechecked.

## 32_Маркеры сносок

9 scripts in 2.7.9: 9 new, 0 successors of converted packages. Not yet converted or rechecked.

## 34_Управление курсором либо выделением

One script in 2.7.9, **new, converted** (T068): `scripts/34_caret-selection/001_caret-to-document-start/`,
id `34/caret-to-document-start`, `legacy.source` the 2.7.9 path, name and description in ru, en
and uk, `needsSelection: false`, the 2.7.9 icon, the original's notice verbatim
(`check-notices.py --package`: OK).

### 001 Установить курсор в начало документа

v1.0, Sclex. The original collapsed a text range over its page's `fbw_body` to its start, nudged
it into the first character (`move("character", 1)`, `-1`), selected it and scrolled to the top:
the caret went to the start of the book annotation, which that page always showed first (a `DIV`
with one empty paragraph when the book has none). The Body view shows the book annotation first
in the same way (with an empty paragraph when there is none), so the conversion puts a caret - an
empty selection - at the start of the first text block of the Body view's annotation block (also
when the annotation starts with a cite or a poem: the first paragraph inside) and scrolls there.
The block is reached with `selection.selectNode('desc:annotation')`, the Body view's id of that
block (feature 004), whose selection starts at its first text block; the caret is then set there
with `selection.set`. The script API has no call for the start of the Body view, and the empty
paragraph of a missing annotation has a UI id the model does not know (`ui_block_1`), so a script
cannot name it otherwise. Should the Body view show no annotation block, the caret goes to the
start of the first text block of the first body. The document does not change.

**Acts on** the caret; **returns** nothing (`null` in a calling script). The combos of 2.7.9
(09/38, 09/39, 13/590, 14/057-062, 31/50, 31/51, 37/06, 37/07, the templates 31/30-33) run it
before a `while (… "Перейти на следующий …" … == "Found")` loop: afterwards the caret stands before
every body - in the annotation block - so the next navigation script searches from before the first
element of the first body, and finds one that starts at the very start of the body (the body
title) as in 2.7.9.

Reference books: `tests/scripts/fixtures/279/34/caret.fb2` (an annotation starting with a cite, a
history, two sections) and `caret-no-annotation.fb2` (the same without annotation and history).
Snapshots (`tests/scripts/snapshots/34/suite.json`; gate `tests/scripts/run-all.sh --group 34`: 3
snapshots, all pass):
- `caret-to-document-start.xml` (`--select n12:3:3`, a caret in the last paragraph): the book
  unchanged;
- `caret-to-document-start.chain.xml` and `.chain-no-annotation.xml`: the chain runner of
  `tests/scripts/fixtures/279/19/chain-runner` runs the script by its 2.7.9 path with a leading
  backslash (`\34_Управление курсором либо выделением\001_Установить курсор в начало документа.js`)
  from the same caret; its report (`.outputs.json`) shows the caret afterwards at `n15:0` - the
  cite's paragraph at the start of the annotation - and at `ui_block_1:0`, the empty annotation
  paragraph of the Body view, with an empty selection text.

No difference, fix or open question.

## 37_Эпиграфы

5 scripts in 2.7.9: 5 new, 0 successors of converted packages. Not yet converted or rechecked.

## 40_Таблицы

3 scripts in 2.7.9: 3 new, 0 successors of converted packages. Not yet converted or rechecked.

## 95_Для программистов

3 scripts in 2.7.9: 0 new, 2 successors of converted packages, 1 successor(s) of scripts the 2.7beta1 conversion dropped. Not yet converted or rechecked.

## 99_Прочее

2 scripts in 2.7.9: 2 new, 0 successors of converted packages. Not yet converted or rechecked.

## TreeCmd

1 script in 2.7.9: 0 new, 1 successors of converted packages. Not yet converted or rechecked.
