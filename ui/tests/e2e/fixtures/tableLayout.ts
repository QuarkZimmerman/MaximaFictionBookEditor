/**
 * The layout gates of pictures in table cells (feature 006, user story 3; research R9.5
 * "Helper"; quickstart §3 "The gates" and "Report-only metrics"; data-model §9.8, §16.4;
 * decisions 17 to 19; vR9 N1 to N4).
 *
 * A module with no imports and erasable TypeScript only - no enums, namespaces or parameter
 * properties -, because `tools/shell-smoke.mjs` imports it under Node's built-in type stripping
 * for the shell smoke's table-layout mode in the real CEF shell, while the journeys
 * `us3-table-images` and `us3-table-images-layout` import it as a fixture. The e2e project has
 * no DOM library, so the code that runs in the page is a string:
 *
 *   await page.evaluate(`(${PICTURES_SETTLED})(${JSON.stringify({ scope })})`);
 *   const m = await page.evaluate(`(${MEASURE_TABLES})(${JSON.stringify({ scope, ids, words })})`);
 *   const { failures, metrics } = checkLayout(m, expected, ids, { words });
 *
 * `MEASURE_TABLES` measures only what the live DOM reports (`getBoundingClientRect`,
 * `Range.getClientRects`, `getComputedStyle`, `computedStyleMap` for the computed width);
 * nothing is recomputed from the stylesheet. `checkLayout` applies the gates of quickstart §3
 * to every table and its control - the same table without its pictures, `<id>-ctl`, which the
 * fixture `tables-images.fb2` puts after every table - so the gates hold whatever fonts a
 * system has. `checkLoadDrift` is gate LD (held and released previews). Screenshots are never
 * a gate (research R9.6).
 *
 * R9's working draft of this helper (research R9 §7) predates W1's floor allowance, PF, FL and
 * the wider PO slack; the definitions below follow quickstart §3 and tasks.md T077. A finding
 * of the first full run is fixed in the CSS or in the gate's definition, never waived
 * (research open point 22).
 */

/* ------------------------------------------------------------------------ */
/* Constants and gates                                                      */
/* ------------------------------------------------------------------------ */

/** The tolerance of every gate, in CSS pixels. */
export const TOL = 1;
/** The height cap of a picture in a cell: 10 lines of Body text (FR-031). */
export const CAP_LINES = 10;
/** The floor's middle term: 1.6em, the height of inline pictures outside cells (decision 18). */
export const FLOOR_EM = 1.6;

/** Every gate with what it checks and the requirement behind it (quickstart §3). */
export const GATES = {
  G0: {
    description:
      'every expected table and its control are mounted, and the measured grid (rows, columns, rows and columns without pictures, picture cells) equals the fixture’s',
    spec: 'precondition',
  },
  G1: {
    description: 'the computed table-layout and width are auto, for tables and controls',
    spec: 'decision 17',
  },
  W1: {
    description:
      't.over ≤ max(0, c.over) + F + 1; F sums over the grid columns the largest floor among the shown pictures of the cells that start there',
    spec: 'FR-027, FR-028, SC-006; decision 18',
  },
  P0: {
    description: 'a picture is shown, loaded at its expected natural size',
    spec: 'precondition; decision 19',
  },
  P1: { description: 'never enlarged: w ≤ nw + 1 and h ≤ nh + 1', spec: 'FR-031' },
  P2: {
    description: 'aspect kept: a box (k·nw, k·nh) lies within 1 px of (w, h) in both directions',
    spec: 'FR-027, SC-006',
  },
  P3: { description: 'h ≤ 10·LH + 1', spec: 'FR-031' },
  P4: { description: 'the picture lies inside its cell’s content box', spec: 'FR-027' },
  P5: { description: 'if w < min(nw, 10·LH·nw/nh) − 1, the table fills its area', spec: 'FR-031' },
  PF: {
    description: 'a shown picture is at least its floor min(nw, 1.6·em, 10·LH·nw/nh) − 1 wide',
    spec: 'FR-031 "Minimum width"; US3 sc.9',
  },
  FL: {
    description:
      'curated tables: in a cell with text and a picture (rowspan 1, not in sup, sub or a note link), the first text line starts at most 2 px below that of the row’s text cells without pictures',
    spec: 'the look; the hanging picture box (research R9.1)',
  },
  PO: {
    description:
      'a row of picture-only or empty cells: h ≤ max(LH, picture extent) + 4 + max(1.5, 0.1·LH)',
    spec: 'edge case "a cell that holds only a picture"',
  },
  K1: {
    description:
      'while the table does not fill its area: columns and rows without pictures as wide and as high as in the control (±1), their text cells with the control’s line counts',
    spec: 'FR-027; decision 17',
  },
  PH1: { description: 'a placeholder lies inside its cell’s content box', spec: 'FR-028' },
  PH2: {
    description:
      'a placeholder is at most 10·LH + 1 high and no wider than its cell’s content box + 1',
    spec: 'FR-028',
  },
  PH3: {
    description:
      'only while the control fits its area and the table does not fill it: the placeholder’s first text line ends inside its box, and scrollWidth − clientWidth ≤ 1',
    spec: 'FR-028; vR9 N4',
  },
  M1: {
    description: 'no text line overlaps a picture of its cell by more than 1 px both ways',
    spec: 'the look',
  },
  C3: {
    description: 'no word is split over two lines unless the control splits it too',
    spec: 'decision 17: no word is broken',
  },
  LD: {
    description:
      'a table whose pictures all have a decodable binary changes height by at most 1 px between the held and the released previews',
    spec: 'the reserved box (research R9.2)',
  },
} as const;

export type GateId = keyof typeof GATES;

/** One gate's finding: where, the measured value and the limit it passed. */
export interface Finding {
  gate: GateId;
  table: string;
  value: number;
  limit: number;
  detail: string;
}

/* ------------------------------------------------------------------------ */
/* The fixture's expectations (tests/fixtures/books/tables-images.expected.json) */
/* ------------------------------------------------------------------------ */

export type Placement = 'section' | 'cite' | 'epigraph-cite' | 'annotation';

export interface ExpectedPictureCell {
  row: number;
  col: number;
  hrefs: string[];
}

export interface ExpectedTable {
  placement: Placement;
  rows: number;
  cols: number;
  rowsWithoutPictures: number[];
  colsWithoutPictures: number[];
  pictureCells: ExpectedPictureCell[];
}

/** The shape `make-fixtures.py` writes (T016); rows and columns are counted from 0. */
export interface Expected {
  pictures: Record<
    string,
    { natural: [number, number]; preview: [number, number] | null; decodable: boolean }
  >;
  placeholders: { table: string; href: string; kind: string }[];
  tables: Record<string, ExpectedTable>;
  sc006: Record<string, { columns: number; picture: string }>;
  warnings: Record<string, number>;
}

/* ------------------------------------------------------------------------ */
/* What MEASURE_TABLES reports                                              */
/* ------------------------------------------------------------------------ */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface MeasuredEnv {
  /** The Body editor's computed font size (px). */
  fontSize: number;
  /** The Body editor's computed line height (px): the Body font size × 1.4. */
  LH: number;
  devicePixelRatio: number;
  /** `html[data-theme]`. */
  theme: string | null;
  /** The Body view's Fast Mode class (`mfbe-body-view--fast`) is on. */
  fastMode: boolean;
  viewport: [number, number];
}

export interface MeasuredPlaceholder {
  href: string;
  /** Index of its cell in `MeasuredTable.cells`. */
  cell: number;
  box: Box;
  lines: number;
  firstLineRight: number | null;
  firstLineBottom: number | null;
  /** `scrollWidth − clientWidth`. */
  overflowX: number;
  /** `scrollHeight − clientHeight`. */
  overflowY: number;
}

export interface MeasuredPicture {
  href: string;
  /** Index of its cell in `MeasuredTable.cells`. */
  cell: number;
  /** The `img` is displayed (not a placeholder, not Fast Mode). */
  shown: boolean;
  /** `img.complete && naturalWidth > 0`. */
  loaded: boolean;
  naturalWidth: number;
  naturalHeight: number;
  /** The shown size (0 when not shown). */
  w: number;
  h: number;
  /** The `img`'s box, null when not shown. */
  box: Box | null;
  /** The `img`'s own computed font size. */
  em: number;
  /** Inside `sup`, `sub` or a note link (`a.fb-note`). */
  raised: boolean;
  /** The largest overlap, in both directions at once, of a text line of its cell with it. */
  textOverlap: number;
  /** The `img` carries the reserved-box class `fb-sized` (T083). */
  sized: boolean;
}

export interface MeasuredCell {
  row: number;
  col: number;
  colspan: number;
  rowspan: number;
  kind: string;
  box: Box;
  content: Box;
  /** Computed `vertical-align`. */
  valign: string;
  /** The cell holds text other than white space (pictures' placeholders not counted). */
  hasText: boolean;
  /** The widest text line. */
  textWidth: number;
  lines: number;
  firstLineTop: number | null;
  /** Number of pictures (`.fb-inline-image`) in the cell. */
  pictures: number;
  /** With `words`: the words split over two lines. */
  splitWords: string[];
}

export interface MeasuredTable {
  id: string;
  box: Box;
  /** The text area: the content box of the element the table stands in. */
  area: Box;
  /** How far the table's right edge passes the text area's (negative: it stays inside). */
  over: number;
  tableLayout: string;
  /** The computed (not the used) width: `auto` unless a rule sets one. */
  width: string;
  rows: number;
  cols: number;
  rowBoxes: Box[];
  /** Per grid column, from its cells of colspan 1; null when no such cell starts there. */
  colBoxes: (Box | null)[];
  cells: MeasuredCell[];
  pictures: MeasuredPicture[];
  placeholders: MeasuredPlaceholder[];
}

export interface TableMeasurement {
  env: MeasuredEnv;
  /** Per requested id: the table and its control, null when not mounted. */
  tables: Record<string, { t: MeasuredTable | null; c: MeasuredTable | null }>;
}

/* ------------------------------------------------------------------------ */
/* Page-side snippets                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Measures, under `scope` (`[data-testid="body-editor"]`, or a Description field such as
 * `[data-testid="description-annotation"]`), each `table.fb-table` whose `data-id` is in `ids`
 * and its control `<id>-ctl`; with `words`, every word split over two lines too. Called as
 * `(${MEASURE_TABLES})({scope, ids, words})`; resolves to a `TableMeasurement`.
 */
export const MEASURE_TABLES = `(args) => {
  const scopeEl = document.querySelector(args.scope);
  if (!scopeEl) throw new Error('MEASURE_TABLES: nothing matches ' + args.scope);
  const editor = scopeEl.matches('.fb-editor')
    ? scopeEl
    : scopeEl.querySelector('.fb-editor') || scopeEl;
  const ecs = getComputedStyle(editor);
  const fontSize = parseFloat(ecs.fontSize);
  const lineHeight = parseFloat(ecs.lineHeight);
  const LH = Number.isFinite(lineHeight) ? lineHeight : fontSize * 1.4;
  const num = (value) => parseFloat(value) || 0;
  const plain = (r) => ({
    left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
  });
  const scrolls = (value) => value === 'auto' || value === 'scroll';
  const contentBox = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const bl = num(cs.borderLeftWidth), br = num(cs.borderRightWidth);
    const bt = num(cs.borderTopWidth), bb = num(cs.borderBottomWidth);
    const bar = scrolls(cs.overflowY) ? Math.max(0, el.offsetWidth - el.clientWidth - Math.round(bl + br)) : 0;
    const barX = scrolls(cs.overflowX) ? Math.max(0, el.offsetHeight - el.clientHeight - Math.round(bt + bb)) : 0;
    const left = r.left + bl + num(cs.paddingLeft);
    const right = r.right - br - num(cs.paddingRight) - bar;
    const top = r.top + bt + num(cs.paddingTop);
    const bottom = r.bottom - bb - num(cs.paddingBottom) - barX;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  const rectsOf = (node, start, end) => {
    const range = document.createRange();
    if (start === undefined) range.selectNodeContents(node);
    else {
      range.setStart(node, start);
      range.setEnd(node, end);
    }
    return Array.from(range.getClientRects()).filter((r) => r.width > 0.01 && r.height > 0.01);
  };
  // Rectangles on one line when the middle of one lies within the other's vertical extent.
  const linesOf = (rects) => {
    const lines = [];
    const sorted = rects.slice().sort((a, b) => a.top - b.top || a.left - b.left);
    for (const r of sorted) {
      const middle = (r.top + r.bottom) / 2;
      const line = lines.find((l) => middle >= l.top && middle <= l.bottom);
      if (line) {
        line.top = Math.min(line.top, r.top);
        line.bottom = Math.max(line.bottom, r.bottom);
        line.left = Math.min(line.left, r.left);
        line.right = Math.max(line.right, r.right);
      } else {
        lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
      }
    }
    return lines.sort((a, b) => a.top - b.top);
  };
  // The cell's own text: not the placeholders' references inside its pictures.
  const textNodesOf = (el) => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement && n.parentElement.closest('.fb-inline-image')) continue;
      if (/\\S/.test(n.data)) out.push(n);
    }
    return out;
  };
  const overlap = (a, b) =>
    Math.min(
      Math.min(a.right, b.right) - Math.max(a.left, b.left),
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    );
  const shownStyle = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  const computedWidth = (el) => {
    try {
      if (el.computedStyleMap) return String(el.computedStyleMap().get('width'));
    } catch (error) {
      // fall through to the resolved value
    }
    return getComputedStyle(el).width;
  };
  // The HTML table model's slots: the grid the browser lays the cells out on.
  const gridOf = (table) => {
    const trs = Array.from(table.rows);
    const taken = trs.map(() => new Set());
    const cells = [];
    let cols = 0;
    trs.forEach((tr, r) => {
      let c = 0;
      for (const el of Array.from(tr.cells)) {
        while (taken[r].has(c)) c += 1;
        const colspan = Math.max(1, el.colSpan || 1);
        const rowspan = Math.min(trs.length - r, el.rowSpan === 0 ? trs.length - r : Math.max(1, el.rowSpan || 1));
        for (let rr = r; rr < r + rowspan; rr += 1) {
          for (let cc = c; cc < c + colspan; cc += 1) taken[rr].add(cc);
        }
        cells.push({ el, row: r, col: c, colspan, rowspan });
        cols = Math.max(cols, c + colspan);
        c += colspan;
      }
    });
    return { trs, cells, cols };
  };
  const measureTable = (table, id) => {
    const parent = table.parentElement;
    const area = contentBox(parent);
    const box = plain(table.getBoundingClientRect());
    const tcs = getComputedStyle(table);
    const grid = gridOf(table);
    const cells = [];
    const pictures = [];
    const placeholders = [];
    grid.cells.forEach((g, index) => {
      const el = g.el;
      const ccs = getComputedStyle(el);
      const textRects = [];
      const splitWords = [];
      for (const node of textNodesOf(el)) {
        for (const r of rectsOf(node)) textRects.push(r);
        if (args.words) {
          const re = /\\S+/g;
          let match;
          while ((match = re.exec(node.data))) {
            const parts = rectsOf(node, match.index, match.index + match[0].length);
            if (linesOf(parts).length > 1) splitWords.push(match[0]);
          }
        }
      }
      const lines = linesOf(textRects);
      const wraps = Array.from(el.querySelectorAll('.fb-inline-image'));
      cells.push({
        row: g.row,
        col: g.col,
        colspan: g.colspan,
        rowspan: g.rowspan,
        kind: el.tagName.toLowerCase(),
        box: plain(el.getBoundingClientRect()),
        content: contentBox(el),
        valign: ccs.verticalAlign,
        hasText: lines.length > 0,
        textWidth: lines.reduce((w, l) => Math.max(w, l.right - l.left), 0),
        lines: lines.length,
        firstLineTop: lines.length ? lines[0].top : null,
        pictures: wraps.length,
        splitWords,
      });
      for (const wrap of wraps) {
        const href = wrap.getAttribute('data-href') || '';
        const img = wrap.querySelector('img');
        const ph = wrap.querySelector('.fb-image-placeholder');
        const shown = shownStyle(img);
        const ibox = shown ? plain(img.getBoundingClientRect()) : null;
        const phShown = shownStyle(ph);
        const pbox = phShown ? plain(ph.getBoundingClientRect()) : null;
        const target = ibox || pbox;
        let textOverlap = 0;
        if (target) for (const r of textRects) textOverlap = Math.max(textOverlap, overlap(r, target));
        pictures.push({
          href,
          cell: index,
          shown,
          loaded: !!img && img.complete && img.naturalWidth > 0,
          naturalWidth: img ? img.naturalWidth : 0,
          naturalHeight: img ? img.naturalHeight : 0,
          w: ibox ? ibox.width : 0,
          h: ibox ? ibox.height : 0,
          box: ibox,
          em: img ? parseFloat(getComputedStyle(img).fontSize) : 0,
          raised: !!wrap.parentElement && !!wrap.parentElement.closest('sup, sub, a.fb-note') &&
            el.contains(wrap.parentElement.closest('sup, sub, a.fb-note')),
          textOverlap,
          sized: !!img && img.classList.contains('fb-sized'),
        });
        if (phShown) {
          const phLines = linesOf(
            Array.from(ph.childNodes)
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .flatMap((n) => rectsOf(n)),
          );
          placeholders.push({
            href,
            cell: index,
            box: pbox,
            lines: phLines.length,
            firstLineRight: phLines.length ? phLines[0].right : null,
            firstLineBottom: phLines.length ? phLines[0].bottom : null,
            overflowX: ph.scrollWidth - ph.clientWidth,
            overflowY: ph.scrollHeight - ph.clientHeight,
          });
        }
      }
    });
    const colBoxes = [];
    for (let c = 0; c < grid.cols; c += 1) {
      const single = cells.filter((cell) => cell.col === c && cell.colspan === 1);
      if (!single.length) {
        colBoxes.push(null);
        continue;
      }
      const left = Math.min(...single.map((cell) => cell.box.left));
      const right = Math.max(...single.map((cell) => cell.box.right));
      colBoxes.push({ left, right, width: right - left, top: box.top, bottom: box.bottom, height: box.height });
    }
    return {
      id,
      box,
      area,
      over: box.right - area.right,
      tableLayout: tcs.tableLayout,
      width: computedWidth(table),
      rows: grid.trs.length,
      cols: grid.cols,
      rowBoxes: grid.trs.map((tr) => plain(tr.getBoundingClientRect())),
      colBoxes,
      cells,
      pictures,
      placeholders,
    };
  };
  const byId = new Map();
  for (const table of Array.from(scopeEl.querySelectorAll('table.fb-table[data-id]'))) {
    const id = table.getAttribute('data-id');
    if (!byId.has(id)) byId.set(id, table);
  }
  const tables = {};
  for (const id of args.ids) {
    const t = byId.get(id);
    const c = byId.get(id + '-ctl');
    tables[id] = { t: t ? measureTable(t, id) : null, c: c ? measureTable(c, id + '-ctl') : null };
  }
  return {
    env: {
      fontSize,
      LH,
      devicePixelRatio: window.devicePixelRatio,
      theme: document.documentElement.getAttribute('data-theme'),
      fastMode: !!scopeEl.closest('.mfbe-body-view--fast'),
      viewport: [window.innerWidth, window.innerHeight],
    },
    tables,
  };
}`;

/**
 * Resolves once every `img` under `scope` is `complete` (loaded or failed) and two animation
 * frames have passed; throws after `timeoutMs` (default 30 s) naming the pending pictures.
 * Called as `(${PICTURES_SETTLED})({scope, timeoutMs?})`; resolves to the number of pictures.
 */
export const PICTURES_SETTLED = `(args) => new Promise((resolve, reject) => {
  const started = performance.now();
  const limit = args.timeoutMs || 30000;
  const frames = (n, done) => (n === 0 ? done() : requestAnimationFrame(() => frames(n - 1, done)));
  const poll = () => {
    const scopeEl = document.querySelector(args.scope);
    const imgs = scopeEl ? Array.from(scopeEl.querySelectorAll('img')) : [];
    const pending = imgs.filter((img) => !img.complete);
    if (scopeEl && pending.length === 0) {
      frames(2, () => resolve(imgs.length));
      return;
    }
    if (performance.now() - started > limit) {
      reject(new Error('PICTURES_SETTLED: ' + (scopeEl ? pending.length + ' pictures still loading: ' +
        pending.slice(0, 4).map((img) => img.getAttribute('src')).join(', ') : 'nothing matches ' + args.scope)));
      return;
    }
    setTimeout(poll, 50);
  };
  poll();
})`;

/* ------------------------------------------------------------------------ */
/* Gate helpers                                                             */
/* ------------------------------------------------------------------------ */

/**
 * The right margin every table keeps for the warning mark of an irregular table (feature 006 US8,
 * FR-057; C54: `ui/src/editor/styles.css`).
 */
export const TABLE_GUTTER_PX = 8;

/** The table reaches its text area's right edge, less the mark's gutter, within 2 px. */
export function fillsArea(t: { over: number }): boolean {
  return t.over >= -TABLE_GUTTER_PX - 2;
}

/** A table that does not pass its text area's right edge (the tolerance included). */
function fitsArea(t: { over: number }): boolean {
  return t.over <= TOL;
}

/** The floor of decision 18: min(natural width, 1.6em, the width the 10-line height allows). */
export function floorOf(nw: number, nh: number, em: number, LH: number): number {
  return Math.min(nw, FLOOR_EM * em, (CAP_LINES * LH * nw) / Math.max(nh, 1));
}

/** The expected grid of a table: a curated one, or an SC-006 table derived from `sc006`. */
export function expectedTable(expected: Expected, id: string): ExpectedTable | null {
  const curated = expected.tables[id];
  if (curated) return curated;
  const family = expected.sc006[id];
  if (!family) return null;
  return {
    placement: 'section',
    rows: 2,
    cols: family.columns,
    rowsWithoutPictures: [1],
    colsWithoutPictures: Array.from({ length: family.columns - 1 }, (_, i) => i + 1),
    pictureCells: [{ row: 0, col: 0, hrefs: [`#${family.picture}`] }],
  };
}

/** The natural size of a picture (decision 19): the served preview's, or an SVG's own. */
function naturalOf(expected: Expected, href: string): [number, number] | null {
  if (!href.startsWith('#')) return null;
  return expected.pictures[href.slice(1)]?.natural ?? null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function measuredGrid(t: MeasuredTable): {
  rowsWithoutPictures: number[];
  colsWithoutPictures: number[];
  pictureCells: ExpectedPictureCell[];
} {
  const rowsWith = new Set<number>();
  const colsWith = new Set<number>();
  const pictureCells: ExpectedPictureCell[] = [];
  t.cells.forEach((cell, index) => {
    const hrefs = t.pictures.filter((p) => p.cell === index).map((p) => p.href);
    if (!hrefs.length) return;
    pictureCells.push({ row: cell.row, col: cell.col, hrefs });
    for (let r = cell.row; r < cell.row + cell.rowspan; r += 1) rowsWith.add(r);
    for (let c = cell.col; c < cell.col + cell.colspan; c += 1) colsWith.add(c);
  });
  return {
    rowsWithoutPictures: Array.from({ length: t.rows }, (_, r) => r).filter(
      (r) => !rowsWith.has(r),
    ),
    colsWithoutPictures: Array.from({ length: t.cols }, (_, c) => c).filter(
      (c) => !colsWith.has(c),
    ),
    pictureCells,
  };
}

function cellAt(t: MeasuredTable, row: number, col: number): MeasuredCell | undefined {
  return t.cells.find((cell) => cell.row === row && cell.col === col);
}

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A cell as `r<row>c<column>`. */
function cellName(cell: MeasuredCell): string {
  return `r${cell.row}c${cell.col}`;
}

/* ------------------------------------------------------------------------ */
/* Report-only metrics                                                      */
/* ------------------------------------------------------------------------ */

export interface Metric {
  count: number;
  /** At most 12. */
  examples: unknown[];
}

/** What the layout costs, reported and never a gate (quickstart §3 "Report-only metrics"). */
export interface ReportMetrics {
  narrowedColumns: Metric;
  changedRows: Metric;
  columnShare: Metric;
  tinyPictures: Metric;
  cutPlaceholders: Metric;
  wideControls: Metric;
  vanishedPictures: Metric;
}

const MAX_EXAMPLES = 12;

function emptyMetrics(): ReportMetrics {
  const metric = (): Metric => ({ count: 0, examples: [] });
  return {
    narrowedColumns: metric(),
    changedRows: metric(),
    columnShare: metric(),
    tinyPictures: metric(),
    cutPlaceholders: metric(),
    wideControls: metric(),
    vanishedPictures: metric(),
  };
}

function note(metric: Metric, example: unknown): void {
  metric.count += 1;
  if (metric.examples.length < MAX_EXAMPLES) metric.examples.push(example);
}

/* ------------------------------------------------------------------------ */
/* checkLayout                                                              */
/* ------------------------------------------------------------------------ */

export interface CheckOptions {
  /** Restricts the check to these gates (the story journey's). */
  gates?: readonly GateId[];
  /** The broken-word scan (C3); the measurement must have been taken with `words` too. */
  words?: boolean;
}

/**
 * The gates of quickstart §3 over the tables `ids` of a measurement: every finding, and the
 * report-only metrics. `nw`/`nh` are the served preview's size from `expected.pictures`.
 */
export function checkLayout(
  measurement: TableMeasurement,
  expected: Expected,
  ids: readonly string[],
  options: CheckOptions = {},
): { failures: Finding[]; metrics: ReportMetrics } {
  const failures: Finding[] = [];
  const metrics = emptyMetrics();
  const on = (gate: GateId) => !options.gates || options.gates.includes(gate);
  const add = (gate: GateId, table: string, value: number, limit: number, detail: string) => {
    if (on(gate)) failures.push({ gate, table, value: round(value), limit: round(limit), detail });
  };
  const { LH, fastMode } = measurement.env;
  const cap = CAP_LINES * LH;

  for (const id of ids) {
    const pair = measurement.tables[id];
    const want = expectedTable(expected, id);
    const t = pair?.t ?? null;
    const c = pair?.c ?? null;
    if (!t || !c || !want) {
      add(
        'G0',
        id,
        0,
        0,
        `${!want ? 'not in the fixture’s expectations' : !t ? 'the table is not mounted' : 'its control is not mounted'}`,
      );
      continue;
    }

    // G0: the grid as the fixture describes it.
    const grid = measuredGrid(t);
    const gridDiffers: string[] = [];
    if (t.rows !== want.rows || t.cols !== want.cols) {
      gridDiffers.push(`${t.rows} × ${t.cols} for ${want.rows} × ${want.cols}`);
    }
    if (c.rows !== want.rows || c.cols !== want.cols) {
      gridDiffers.push(`the control ${c.rows} × ${c.cols}`);
    }
    if (c.pictures.length) gridDiffers.push(`the control holds ${c.pictures.length} pictures`);
    if (!sameList(grid.rowsWithoutPictures, want.rowsWithoutPictures)) {
      gridDiffers.push(`rows without pictures ${JSON.stringify(grid.rowsWithoutPictures)}`);
    }
    if (!sameList(grid.colsWithoutPictures, want.colsWithoutPictures)) {
      gridDiffers.push(`columns without pictures ${JSON.stringify(grid.colsWithoutPictures)}`);
    }
    if (!sameList(grid.pictureCells, want.pictureCells)) {
      gridDiffers.push(`picture cells ${JSON.stringify(grid.pictureCells)}`);
    }
    if (gridDiffers.length) add('G0', id, gridDiffers.length, 0, gridDiffers.join('; '));

    // G1: the automatic table layout stays (decision 17).
    for (const table of [t, c]) {
      if (table.tableLayout !== 'auto' || table.width !== 'auto') {
        add('G1', table.id, 0, 0, `table-layout ${table.tableLayout}, width ${table.width}`);
      }
    }

    const fills = fillsArea(t);

    // The pictures: P0 to P5, PF, P4, M1; the floor allowance of W1.
    const floorByColumn = new Map<number, number>();
    for (const picture of t.pictures) {
      const cell = t.cells[picture.cell]!;
      const natural = naturalOf(expected, picture.href);
      if (picture.textOverlap > TOL) {
        add('M1', id, picture.textOverlap, TOL, `${cellName(cell)} ${picture.href}: text over it`);
      }
      if (!picture.shown) {
        // In Fast Mode every picture is a placeholder; otherwise a picture the fixture gives a
        // size must show (the precondition of every picture gate).
        if (!fastMode && natural) {
          add('P0', id, 0, 1, `${cellName(cell)} ${picture.href}: not shown`);
        }
        continue;
      }
      if (!natural) {
        add('P0', id, 0, 1, `${cellName(cell)} ${picture.href}: shown, but no expected size`);
        continue;
      }
      const [nw, nh] = natural;
      const { w, h } = picture;
      if (!picture.loaded || picture.naturalWidth !== nw || picture.naturalHeight !== nh) {
        add(
          'P0',
          id,
          picture.naturalWidth,
          nw,
          `${cellName(cell)} ${picture.href}: ${picture.loaded ? 'loaded' : 'not loaded'} at ${picture.naturalWidth} × ${picture.naturalHeight}, expected ${nw} × ${nh}`,
        );
      }
      if (w > nw + TOL || h > nh + TOL) {
        add(
          'P1',
          id,
          Math.max(w - nw, h - nh),
          TOL,
          `${cellName(cell)} ${picture.href}: ${round(w)} × ${round(h)} over ${nw} × ${nh}`,
        );
      }
      const kLow = Math.max(0, (w - TOL) / nw, (h - TOL) / nh);
      const kHigh = Math.min((w + TOL) / nw, (h + TOL) / nh);
      if (kLow > kHigh) {
        add(
          'P2',
          id,
          round(w / h),
          round(nw / nh),
          `${cellName(cell)} ${picture.href}: ${round(w)} × ${round(h)} is not ${nw}:${nh}`,
        );
      }
      if (h > cap + TOL) {
        add('P3', id, h, cap + TOL, `${cellName(cell)} ${picture.href}: ${round(h)} px high`);
      }
      const box = picture.box!;
      const inside = cell.content;
      const out = Math.max(
        inside.left - box.left,
        box.right - inside.right,
        inside.top - box.top,
        box.bottom - inside.bottom,
      );
      if (out > TOL) {
        add(
          'P4',
          id,
          out,
          TOL,
          `${cellName(cell)} ${picture.href}: ${round(out)} px outside the cell's content box`,
        );
      }
      const room = Math.min(nw, (cap * nw) / nh);
      if (w < room - TOL && !fills) {
        add(
          'P5',
          id,
          w,
          room - TOL,
          `${cellName(cell)} ${picture.href}: ${round(w)} px wide while the table does not fill its area (over ${round(t.over)})`,
        );
      }
      const floor = floorOf(nw, nh, picture.em, LH);
      if (w < floor - TOL) {
        add(
          'PF',
          id,
          w,
          floor - TOL,
          `${cellName(cell)} ${picture.href}: ${round(w)} px, the floor ${round(floor)}`,
        );
      }
      floorByColumn.set(cell.col, Math.max(floorByColumn.get(cell.col) ?? 0, floor));
      if (Math.min(w, h) < 4) {
        note(metrics.tinyPictures, {
          table: id,
          cell: cellName(cell),
          href: picture.href,
          w: round(w),
          h: round(h),
        });
      }
      if (Math.min(w, h) < 2) {
        note(metrics.vanishedPictures, {
          table: id,
          cell: cellName(cell),
          href: picture.href,
          w: round(w),
          h: round(h),
        });
      }
    }

    // W1: no wider than the area, or than the control when that one is wider, but for the floor.
    let allowance = 0;
    for (const floor of floorByColumn.values()) allowance += floor;
    const widthLimit = Math.max(0, c.over) + allowance + TOL;
    if (t.over > widthLimit) {
      add(
        'W1',
        id,
        t.over,
        widthLimit,
        `passes its area by ${round(t.over)} px, the control by ${round(c.over)}, the floor allowance ${round(allowance)}`,
      );
    }
    if (!fitsArea(c)) note(metrics.wideControls, { table: id, over: round(c.over) });

    // Placeholders: PH1 to PH3.
    const ph3 = fitsArea(c) && !fills;
    for (const placeholder of t.placeholders) {
      const cell = t.cells[placeholder.cell]!;
      const box = placeholder.box;
      const inside = cell.content;
      const out = Math.max(
        inside.left - box.left,
        box.right - inside.right,
        inside.top - box.top,
        box.bottom - inside.bottom,
      );
      if (out > TOL) {
        add(
          'PH1',
          id,
          out,
          TOL,
          `${cellName(cell)} ${placeholder.href}: ${round(out)} px outside the cell's content box`,
        );
      }
      if (box.height > cap + TOL) {
        add(
          'PH2',
          id,
          box.height,
          cap + TOL,
          `${cellName(cell)} ${placeholder.href}: ${round(box.height)} px high`,
        );
      }
      if (box.width > inside.width + TOL) {
        add(
          'PH2',
          id,
          box.width,
          inside.width + TOL,
          `${cellName(cell)} ${placeholder.href}: ${round(box.width)} px wide in a ${round(inside.width)} px cell`,
        );
      }
      if (ph3) {
        const ends =
          placeholder.firstLineRight === null ||
          (placeholder.firstLineRight <= box.right + TOL &&
            (placeholder.firstLineBottom ?? box.bottom) <= box.bottom + TOL);
        if (!ends || placeholder.overflowX > TOL) {
          add(
            'PH3',
            id,
            placeholder.overflowX,
            TOL,
            `${cellName(cell)} ${placeholder.href}: the text is cut (first line to ${round(placeholder.firstLineRight ?? 0)}, box to ${round(box.right)}; overflow ${placeholder.overflowX})`,
          );
        }
      }
      if (placeholder.overflowY > TOL || (!ph3 && placeholder.overflowX > TOL)) {
        note(metrics.cutPlaceholders, {
          table: id,
          cell: cellName(cell),
          href: placeholder.href,
          overflowX: placeholder.overflowX,
          overflowY: placeholder.overflowY,
        });
      }
    }

    // FL: the text beside a hanging picture starts level with the row's other text (curated).
    if (expected.tables[id]) {
      for (const cell of t.cells) {
        if (cell.rowspan !== 1 || !cell.hasText || cell.valign !== 'top') continue;
        const own = t.pictures.filter((p) => t.cells[p.cell] === cell);
        if (!own.length || own.every((p) => p.raised)) continue;
        const others = t.cells.filter(
          (other) =>
            other !== cell &&
            other.row === cell.row &&
            other.rowspan === 1 &&
            other.hasText &&
            other.pictures === 0 &&
            other.valign === 'top' &&
            other.firstLineTop !== null,
        );
        if (!others.length || cell.firstLineTop === null) continue;
        const level = Math.min(...others.map((other) => other.firstLineTop!));
        const lower = cell.firstLineTop - level;
        if (lower > 2) {
          add(
            'FL',
            id,
            lower,
            2,
            `${cellName(cell)}: its first text line starts ${round(lower)} px below the row's`,
          );
        }
      }
    }

    // PO: a row of picture-only or empty cells is no taller than its pictures and the padding.
    for (let r = 0; r < t.rows; r += 1) {
      const covering = t.cells.filter((cell) => cell.row <= r && r < cell.row + cell.rowspan);
      if (!covering.length || covering.some((cell) => cell.rowspan !== 1 || cell.hasText)) continue;
      if (!covering.some((cell) => cell.pictures > 0)) continue;
      let extent = 0;
      covering.forEach((cell) => {
        const index = t.cells.indexOf(cell);
        const boxes: Box[] = [];
        for (const picture of t.pictures)
          if (picture.cell === index && picture.box) boxes.push(picture.box);
        for (const placeholder of t.placeholders)
          if (placeholder.cell === index) boxes.push(placeholder.box);
        if (!boxes.length) return;
        const top = Math.min(...boxes.map((b) => b.top));
        const bottom = Math.max(...boxes.map((b) => b.bottom));
        extent = Math.max(extent, bottom - top);
      });
      const limit = Math.max(LH, extent) + 4 + Math.max(1.5, 0.1 * LH);
      const height = t.rowBoxes[r]!.height;
      if (height > limit) {
        add(
          'PO',
          id,
          height,
          limit,
          `row ${r}: ${round(height)} px for pictures of ${round(extent)} px`,
        );
      }
    }

    // K1 while the table has room; the report-only metrics once it fills its area.
    for (const col of want.colsWithoutPictures) {
      const tw = t.colBoxes[col]?.width;
      const cw = c.colBoxes[col]?.width;
      if (tw === undefined || cw === undefined) continue;
      if (!fills) {
        if (Math.abs(tw - cw) > TOL) {
          add('K1', id, tw, cw, `column ${col}: ${round(tw)} px, the control ${round(cw)} px`);
        }
      } else if (tw < cw - TOL) {
        note(metrics.narrowedColumns, { table: id, col, t: round(tw), c: round(cw) });
      }
    }
    for (const row of want.rowsWithoutPictures) {
      const th = t.rowBoxes[row]?.height;
      const ch = c.rowBoxes[row]?.height;
      if (th === undefined || ch === undefined) continue;
      if (!fills) {
        if (Math.abs(th - ch) > TOL) {
          add('K1', id, th, ch, `row ${row}: ${round(th)} px high, the control ${round(ch)} px`);
        }
      } else if (Math.abs(th - ch) > TOL) {
        note(metrics.changedRows, { table: id, row, t: round(th), c: round(ch) });
      }
    }
    if (!fills) {
      const freeRows = new Set(want.rowsWithoutPictures);
      const freeCols = new Set(want.colsWithoutPictures);
      for (const cell of t.cells) {
        const inFree =
          Array.from({ length: cell.rowspan }, (_, i) => cell.row + i).every((r) =>
            freeRows.has(r),
          ) ||
          Array.from({ length: cell.colspan }, (_, i) => cell.col + i).every((k) =>
            freeCols.has(k),
          );
        if (!inFree || !cell.hasText) continue;
        const control = cellAt(c, cell.row, cell.col);
        if (control && control.lines !== cell.lines) {
          add(
            'K1',
            id,
            cell.lines,
            control.lines,
            `${cellName(cell)}: ${cell.lines} lines, the control ${control.lines}`,
          );
        }
      }
    }

    // columnShare: a single picture column's shown width against what it could take.
    const pictureColumns = new Set(t.pictures.map((p) => t.cells[p.cell]!.col));
    if (pictureColumns.size === 1) {
      let shown = 0;
      let could = 0;
      for (const picture of t.pictures) {
        const natural = naturalOf(expected, picture.href);
        if (!picture.shown || !natural) continue;
        shown = Math.max(shown, picture.w);
        could = Math.max(could, Math.min(natural[0], (cap * natural[0]) / natural[1]));
      }
      if (could > 0 && shown < could - TOL) {
        note(metrics.columnShare, {
          table: id,
          col: [...pictureColumns][0],
          shown: round(shown),
          could: round(could),
        });
      }
    }

    // C3: no word split that the control does not split.
    if (options.words) {
      for (const cell of t.cells) {
        if (!cell.splitWords.length) continue;
        const control = cellAt(c, cell.row, cell.col);
        const left = [...(control?.splitWords ?? [])];
        for (const word of cell.splitWords) {
          const at = left.indexOf(word);
          if (at >= 0) {
            left.splice(at, 1);
            continue;
          }
          add(
            'C3',
            id,
            1,
            0,
            `${cellName(cell)}: "${word.length > 40 ? `${word.slice(0, 40)}…` : word}" is split over two lines`,
          );
        }
      }
    }
  }
  return { failures, metrics };
}

/**
 * Gate LD: a table whose pictures all have a decodable binary changes height by at most 1 px
 * between the measurement with the previews held and the one after they arrived (the reserved
 * box, research R9.2) - s02's SVG and the placeholders of c17, c18 and c23 are exempt.
 */
export function checkLoadDrift(
  before: TableMeasurement,
  after: TableMeasurement,
  expected: Expected,
): Finding[] {
  const failures: Finding[] = [];
  for (const [id, pair] of Object.entries(after.tables)) {
    const held = before.tables[id]?.t;
    const loaded = pair.t;
    if (!held || !loaded || !loaded.pictures.length) continue;
    const decodable = loaded.pictures.every(
      (p) => p.href.startsWith('#') && expected.pictures[p.href.slice(1)]?.decodable === true,
    );
    if (!decodable) continue;
    const drift = loaded.box.height - held.box.height;
    if (Math.abs(drift) > TOL) {
      failures.push({
        gate: 'LD',
        table: id,
        value: round(drift),
        limit: TOL,
        detail: `${round(held.box.height)} px high with the previews held, ${round(loaded.box.height)} px once they arrived`,
      });
    }
  }
  return failures;
}

/** The first `n` findings per gate, for an assertion message. */
export function describeFailures(where: string, failures: readonly Finding[], n = 4): string {
  if (!failures.length) return `${where}: no findings`;
  const byGate = new Map<GateId, Finding[]>();
  for (const finding of failures) {
    const list = byGate.get(finding.gate) ?? [];
    list.push(finding);
    byGate.set(finding.gate, list);
  }
  const lines = [`${where}: ${failures.length} findings`];
  for (const [gate, list] of byGate) {
    lines.push(`  ${gate} (${list.length}; ${GATES[gate].description})`);
    for (const finding of list.slice(0, n)) {
      lines.push(`    ${finding.table}: ${finding.detail} [${finding.value} / ${finding.limit}]`);
    }
  }
  return lines.join('\n');
}
