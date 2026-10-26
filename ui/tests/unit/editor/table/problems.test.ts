/**
 * The problem texts (feature 006, T034; I3; data-model §3.2): the parts in their order, the
 * separator, US8 sc.9's text, and the Russian and Ukrainian plural forms - by `columns` for one
 * short row, by count for the others.
 */

import { createInstance, type TFunction } from 'i18next';

import type { TableSummary } from '@/editor/table/grid';
import { tableProblemParts, tableProblemsText } from '@/editor/table/problems';
import { initI18n } from '@/i18n';

const translators: Record<'en' | 'ru' | 'uk', TFunction> = {} as Record<
  'en' | 'ru' | 'uk',
  TFunction
>;

beforeAll(async () => {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  translators.en = i18n.getFixedT('en');
  translators.ru = i18n.getFixedT('ru');
  translators.uk = i18n.getFixedT('uk');
});

const summary = (fields: Partial<TableSummary>): TableSummary => ({
  rows: 3,
  columns: 3,
  shortRows: 0,
  overlaps: 0,
  pastEnd: 0,
  ...fields,
});

describe('tableProblemParts', () => {
  it('gives the short rows, the overlaps and the spans past the end, in that order', () => {
    const t = translators.en;
    expect(
      tableProblemParts(summary({ shortRows: 2, overlaps: 1, pastEnd: 3, columns: 4 }), t),
    ).toEqual([
      '2 rows cover fewer than 4 columns',
      '1 overlapping span',
      '3 spans reach past the last row',
    ]);
    expect(tableProblemParts(summary({ pastEnd: 1, overlaps: 2 }), t)).toEqual([
      '2 overlapping spans',
      '1 span reaches past the last row',
    ]);
    expect(tableProblemParts(summary({}), t)).toEqual([]);
  });

  it('plural forms follow columns for one short row, in English too', () => {
    const t = translators.en;
    expect(tableProblemParts(summary({ shortRows: 1, row: 2, covered: 0, columns: 1 }), t)).toEqual(
      ['row 2 covers 0 of 1 column'],
    );
    expect(tableProblemParts(summary({ shortRows: 1, row: 1, covered: 1, columns: 2 }), t)).toEqual(
      ['row 1 covers 1 of 2 columns'],
    );
  });
});

describe('tableProblemsText', () => {
  it('joins the parts with the separator: US8 sc.9', () => {
    const sc9 = summary({ shortRows: 1, row: 2, covered: 2, overlaps: 1 });
    expect(tableProblemsText(sc9, translators.en)).toBe(
      'row 2 covers 2 of 3 columns; 1 overlapping span',
    );
    expect(tableProblemsText(summary({}), translators.en)).toBe('');
  });

  it('Russian: plural by columns for one short row, by count otherwise', () => {
    const t = translators.ru;
    const short = (columns: number) =>
      tableProblemsText(summary({ shortRows: 1, row: 2, covered: 0, columns }), t);
    expect(short(1)).toBe('строка 2 занимает 0 из 1 столбца');
    expect(short(21)).toBe('строка 2 занимает 0 из 21 столбца');
    expect(short(3)).toBe('строка 2 занимает 0 из 3 столбцов');
    expect(short(5)).toBe('строка 2 занимает 0 из 5 столбцов');
    expect(tableProblemsText(summary({ overlaps: 1 }), t)).toBe('1 наложение ячеек');
    expect(tableProblemsText(summary({ overlaps: 2 }), t)).toBe('2 наложения ячеек');
    expect(tableProblemsText(summary({ overlaps: 5 }), t)).toBe('5 наложений ячеек');
    expect(tableProblemsText(summary({ shortRows: 5, columns: 4, pastEnd: 2 }), t)).toBe(
      '5 строк занимают меньше столбцов, чем 4; 2 ячейки выходят за последнюю строку',
    );
  });

  it('Ukrainian: plural by columns for one short row, by count otherwise', () => {
    const t = translators.uk;
    const short = (columns: number) =>
      tableProblemsText(summary({ shortRows: 1, row: 3, covered: 1, columns }), t);
    expect(short(1)).toBe('рядок 3 займає 1 з 1 стовпця');
    expect(short(2)).toBe('рядок 3 займає 1 з 2 стовпців');
    expect(short(5)).toBe('рядок 3 займає 1 з 5 стовпців');
    expect(tableProblemsText(summary({ pastEnd: 1 }), t)).toBe(
      '1 клітинка виходить за останній рядок',
    );
    expect(tableProblemsText(summary({ pastEnd: 3 }), t)).toBe(
      '3 клітинки виходять за останній рядок',
    );
    expect(tableProblemsText(summary({ pastEnd: 5 }), t)).toBe(
      '5 клітинок виходять за останній рядок',
    );
    expect(tableProblemsText(summary({ shortRows: 2, columns: 4, overlaps: 5 }), t)).toBe(
      '2 рядки займають менше стовпців, ніж 4; 5 накладань клітинок',
    );
  });
});
