/**
 * The shared grid vectors (feature 006, T034; contracts/document-model.md §4.14, the parity
 * rule; data-model §16.1): every case of `tests/fixtures/tables/grid-vectors.json` gives its
 * placement, width, coverage, problems and params through `gridOfModel` and through
 * `gridOfNode(nodeFromModel(table))`, which must agree; the TypeScript side also checks the
 * owners, the English problem text and - since US8's repair (T125) - the `repaired` table that
 * *Repair table* makes of each irregular case. The core's analysis is pinned by the same file.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInstance, type TFunction } from 'i18next';

import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { applyTableEdit, isRefusal } from '@/editor/table/edit';
import { gridOfModel, gridOfNode, type TableGrid } from '@/editor/table/grid';
import { planRepair } from '@/editor/table/ops';
import { tableProblemsText } from '@/editor/table/problems';
import { nodeToModel } from '@/editor/toModel';
import { initI18n } from '@/i18n';
import type { TableNode } from '@/model/document';

const VECTORS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../tests/fixtures/tables',
);

interface VectorCell {
  type?: 'td' | 'th' | 'raw-xml';
  attrs?: Record<string, unknown>;
}

interface VectorTable {
  attrs?: Record<string, unknown>;
  rows: (VectorCell[] | { type: 'raw-xml' })[];
}

interface VectorCase {
  name: string;
  spec?: string;
  fixture?: string;
  table: VectorTable;
  expect: {
    rows: number;
    columns: number;
    covered: number[];
    shortRows: number[];
    overlaps: number;
    pastEnd: number;
    regular: boolean;
    cells: [number, number, number, number][];
    params: Record<string, unknown>;
    owners?: number[][];
    text?: { en: string };
    repaired?: VectorTable;
  };
}

const vectors = JSON.parse(readFileSync(path.join(VECTORS, 'grid-vectors.json'), 'utf8')) as {
  version: number;
  maxColspan: number;
  maxRowspan: number;
  cases: VectorCase[];
};

/** A vectors table as a model table node, with synthetic node ids. */
function modelTable(table: VectorTable): TableNode {
  let next = 0;
  const nodeId = () => `v${(next += 1)}`;
  const rawXml = () => ({
    type: 'raw-xml',
    attrs: { nodeId: nodeId(), xml: '<x/>', inline: false },
  });
  return {
    type: 'table',
    attrs: { nodeId: nodeId(), ...(table.attrs ?? {}) },
    content: table.rows.map((row) =>
      Array.isArray(row)
        ? {
            type: 'tr',
            attrs: { nodeId: nodeId() },
            content: row.map((cell) =>
              cell.type === 'raw-xml'
                ? rawXml()
                : {
                    type: cell.type ?? 'td',
                    attrs: { nodeId: nodeId(), ...(cell.attrs ?? {}) },
                    content: [],
                  },
            ),
          }
        : rawXml(),
    ),
  } as unknown as TableNode;
}

/** The members of a case's expectation that the parity rule names. */
function parityView(grid: TableGrid) {
  const covered: number[] = [];
  const shortRows: number[] = [];
  for (let r = 0; r < grid.height; r += 1) {
    covered.push(grid.covered(r));
    if (grid.covered(r) < grid.width) shortRows.push(r + 1);
  }
  return {
    rows: grid.height,
    columns: grid.width,
    covered,
    shortRows,
    overlaps: grid.cells.filter((cell) => cell.overlaps).length,
    pastEnd: grid.cells.filter((cell) => cell.pastEnd).length,
    regular: grid.regular,
    cells: grid.cells.map((cell) => [cell.row, cell.left, cell.colspan, cell.rowsIn]),
    params: grid.summary,
  };
}

function owners(grid: TableGrid): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < grid.height; r += 1) {
    const row: number[] = [];
    for (let c = 0; c < grid.width; c += 1) row.push(grid.owner(r, c));
    out.push(row);
  }
  return out;
}

/**
 * A table as a vectors table: the table's attributes, each row's cells with their type (`td`
 * omitted) and attributes, node ids, content and empty members dropped; a model table node and
 * a vectors table both go through it.
 */
function vectorOf(table: unknown): unknown {
  const attrs = (value: unknown) => {
    const out = Object.fromEntries(
      Object.entries((value ?? {}) as Record<string, unknown>).filter(
        ([key, member]) => key !== 'nodeId' && member !== null && member !== undefined,
      ),
    );
    return Object.keys(out).length > 0 ? out : undefined;
  };
  const source = table as {
    attrs?: unknown;
    rows?: unknown[];
    content?: { type: string; attrs?: unknown; content?: { type?: string; attrs?: unknown }[] }[];
  };
  const rows = source.rows
    ? (source.rows as unknown[])
    : (source.content ?? []).map((row) => (row.type === 'tr' ? (row.content ?? []) : row));
  return {
    attrs: attrs(source.attrs),
    rows: rows.map((row) =>
      Array.isArray(row)
        ? (row as { type?: string; attrs?: unknown }[]).map((cell) => ({
            type: cell.type && cell.type !== 'td' ? cell.type : undefined,
            attrs: cell.type === 'raw-xml' ? undefined : attrs(cell.attrs),
          }))
        : { type: 'raw-xml' },
    ),
  };
}

let t: TFunction;

beforeAll(async () => {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  t = i18n.getFixedT('en');
});

describe('the shared grid vectors', () => {
  it('reads version 1 with the limits of grid.ts', () => {
    expect(vectors.version).toBe(1);
    expect(vectors.maxColspan).toBe(1000);
    expect(vectors.maxRowspan).toBe(65534);
    expect(vectors.cases.length).toBeGreaterThanOrEqual(30);
  });

  it('every case of grid-vectors.json: gridOfModel and gridOfNode give its placement, width, coverage, problems and params', () => {
    const failures: string[] = [];
    for (const vector of vectors.cases) {
      const table = modelTable(vector.table);
      const expected = {
        rows: vector.expect.rows,
        columns: vector.expect.columns,
        covered: vector.expect.covered,
        shortRows: vector.expect.shortRows,
        overlaps: vector.expect.overlaps,
        pastEnd: vector.expect.pastEnd,
        regular: vector.expect.regular,
        cells: vector.expect.cells,
        params: vector.expect.params,
      };
      const node = nodeFromModel(table as unknown as ModelNodeJson);
      if (!node || node.type.name !== 'table') {
        failures.push(`${vector.name}: nodeFromModel gave ${node?.type.name ?? 'nothing'}`);
        continue;
      }
      for (const [via, grid] of [
        ['gridOfModel', gridOfModel(table)],
        ['gridOfNode', gridOfNode(node)],
      ] as const) {
        try {
          expect(parityView(grid)).toEqual(expected);
        } catch (error) {
          failures.push(`${vector.name} through ${via}: ${(error as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('every case: owners, text.en and the repaired table', () => {
    // Every member a case has is checked here; one it gains must be checked or listed.
    const checked = new Set([
      'rows',
      'columns',
      'covered',
      'shortRows',
      'overlaps',
      'pastEnd',
      'regular',
      'cells',
      'params',
      'owners',
      'text',
      'repaired',
    ]);
    const failures: string[] = [];
    let repairs = 0;
    for (const vector of vectors.cases) {
      for (const member of Object.keys(vector.expect)) {
        if (!checked.has(member)) failures.push(`${vector.name}: unchecked member ${member}`);
      }
      const table = modelTable(vector.table);
      const grid = gridOfModel(table);
      const node = nodeFromModel(table as unknown as ModelNodeJson)!;
      if (vector.expect.owners) {
        try {
          expect(owners(grid)).toEqual(vector.expect.owners);
          expect(owners(gridOfNode(node))).toEqual(vector.expect.owners);
        } catch (error) {
          failures.push(`${vector.name} owners: ${(error as Error).message}`);
        }
      }
      const text = tableProblemsText(grid.summary, t);
      if (vector.expect.text) {
        if (text !== vector.expect.text.en) {
          failures.push(`${vector.name} text: "${text}" instead of "${vector.expect.text.en}"`);
        }
      } else if (vector.expect.regular && text !== '') {
        failures.push(`${vector.name}: a regular table gave the text "${text}"`);
      }
      // *Repair table* (document-model §4.11): an irregular case gives its `repaired` table,
      // compared as a vectors table - cell types and attributes, node ids ignored.
      if (vector.expect.repaired || !vector.expect.regular) {
        let next = 0;
        const edit = planRepair(
          { table: node, grid: gridOfNode(node) },
          { nextId: () => `r${(next += 1)}` },
        );
        if (isRefusal(edit)) {
          failures.push(`${vector.name}: Repair table refused with ${edit.refused}`);
          continue;
        }
        repairs += 1;
        const after = nodeToModel(applyTableEdit(node, edit)) as unknown as ModelNodeJson;
        try {
          expect(vectorOf(after)).toEqual(vectorOf(vector.expect.repaired!));
        } catch (error) {
          failures.push(`${vector.name} repaired: ${(error as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(repairs).toBe(vectors.cases.filter((one) => !one.expect.regular).length);
  });
});
