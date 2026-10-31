// Converted from FictionBook Editor 2.7.9: Scripts/07_Символы/09_Математические символы.js
// The table of mathematical symbols (° ± × ÷ ∑ √ ∞ ≠ ∂ ∫ ≤ ≥ ≈ ∪ ∩ ⊂ ∈ ∏ ∠ ′ ″ ½ ⅓ ⅛ …). The
// original opened it as a modeless HTML dialog (HTML/Математические символы.html): a click on
// a cell put the symbol in place of the selection of the Body view and the caret after it, and
// the dialog stayed open for the next click. Here the table is a list in a form (modal, one
// symbol per run, the run one undo step as each click was): the chosen symbol replaces the
// selection, a caret gets it inserted, and the caret goes after it; with the caret outside the
// book text the script says so (the original did nothing). Fix: the dialog's grid had one cell
// less than its 61 symbols, so ⅞ never showed; the list holds all 61.
// The original's notice, kept as written (FR-029):
//Таблица математических символов
//                                jurgennt™, май 2008 г.
//                          script engene by Sclex v.1.3
//                          таблица: stokber, май 2024

import { insertFromTable, t } from './lib/symbol-table.js';
import { SYMBOLS } from './symbols.js';

export default async function run(ctx) {
  await insertFromTable(ctx, t(ctx, 'Математические символы', 'Mathematical symbols'), SYMBOLS);
}
