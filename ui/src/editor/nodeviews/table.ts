/**
 * Table node views (T063): the table renders as `<table class="fb-table"><tbody>` with the
 * rows as content, cells as `<th>` / `<td>` carrying their FB2 attributes (colspan, rowspan,
 * align, valign, id, style) so the browser lays them out while the Table bar edits them. The
 * caret moves between cells with Tab / Shift+Tab (keymap.ts) and Enter stays inside a cell.
 *
 * Feature 006 (US8; FR-057; I15; data-model §3.3, §3.4): with options, an irregular table - a
 * too-large one included - carries the editor's warning mark at its top-right corner: a
 * zero-height `<caption class="fb-table-mark-host" contenteditable="false">`, the table's first
 * child and outside the content DOM, holding the mark (`role="img"`, its name as `aria-label`,
 * its tooltip as `title`) around the round badge "!". It is derived from the node on every
 * update - a command, typing, a Source switch, a script, an assistant commit, Undo, Redo - and
 * goes once the table is regular; the schema's `toDOM` knows nothing of it, so Copy, Save and the
 * Source view never see it. A mousedown on the mark keeps the caret and the focus, a click asks
 * the host for the popover (`onMarkActivate`).
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { NodeView, NodeViewConstructor, ViewMutationRecord } from 'prosemirror-view';

import { effectiveColspan, effectiveRowspan, gridOfNode, type TableSummary } from '../table/grid';

/** The texts of a table's mark: its accessible name and its tooltip (data-model §3.2). */
export interface TableMarkTexts {
  name: string;
  tooltip: string;
}

/** What the host gives the table node views for the warning mark (I15). */
export interface TableViewOptions {
  /** The mark's texts for the summary of an irregular table, in the interface language. */
  describe(summary: TableSummary): TableMarkTexts;
  /** Subscribes to interface-language changes; returns the unsubscribe function. */
  onLanguageChange?(listener: () => void): () => void;
  /** A click on the mark: the table's node id and the mark's rectangle (the popover's anchor). */
  onMarkActivate?(info: { tableNodeId: string; anchor: DOMRect }): void;
}

export class TableView implements NodeView {
  readonly dom: HTMLTableElement;
  readonly contentDOM: HTMLTableSectionElement;
  private caption: HTMLTableCaptionElement | null = null;
  private mark: HTMLSpanElement | null = null;
  private readonly unsubscribe: (() => void) | null;

  constructor(
    private node: PMNode,
    private readonly options?: TableViewOptions,
  ) {
    this.dom = document.createElement('table');
    this.dom.className = 'fb-table';
    this.dom.setAttribute('data-testid', 'body-table');
    this.contentDOM = document.createElement('tbody');
    this.dom.appendChild(this.contentDOM);
    this.render();
    this.unsubscribe = options?.onLanguageChange?.(() => this.renderMark()) ?? null;
  }

  private render(): void {
    const { nodeId, id, style } = this.node.attrs as Record<string, string | null>;
    if (nodeId) this.dom.setAttribute('data-node-id', nodeId);
    if (id) this.dom.setAttribute('data-id', id);
    else this.dom.removeAttribute('data-id');
    if (style) this.dom.setAttribute('data-style', style);
    else this.dom.removeAttribute('data-style');
    this.renderMark();
  }

  /**
   * The mark exactly while the table is irregular (data-model §3.3): created on the first need,
   * its texts rendered again for every node and language, removed with `data-irregular` once
   * the table is regular. Without options there is none (the rich fields until US10).
   */
  private renderMark(): void {
    const grid = this.options ? gridOfNode(this.node) : null;
    if (!this.options || !grid || grid.regular) {
      if (this.caption) {
        this.caption.remove();
        this.caption = null;
        this.mark = null;
      }
      this.dom.removeAttribute('data-irregular');
      return;
    }
    if (!this.caption || !this.mark) {
      const caption = document.createElement('caption');
      caption.className = 'fb-table-mark-host';
      caption.setAttribute('contenteditable', 'false');
      const mark = document.createElement('span');
      mark.className = 'fb-table-mark';
      mark.setAttribute('role', 'img');
      mark.setAttribute('data-testid', 'body-table-mark');
      const badge = document.createElement('span');
      badge.className = 'mfbe-table-mark-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = '!';
      mark.appendChild(badge);
      // The caret and the focus stay where they are; the click opens the popover.
      mark.addEventListener('mousedown', (event) => event.preventDefault());
      mark.addEventListener('click', (event) => {
        event.preventDefault();
        const tableNodeId = this.node.attrs.nodeId;
        this.options?.onMarkActivate?.({
          tableNodeId: typeof tableNodeId === 'string' ? tableNodeId : '',
          anchor: mark.getBoundingClientRect(),
        });
      });
      caption.appendChild(mark);
      this.dom.insertBefore(caption, this.dom.firstChild);
      this.caption = caption;
      this.mark = mark;
    }
    const { name, tooltip } = this.options.describe(grid.summary);
    if (this.mark.getAttribute('aria-label') !== name) this.mark.setAttribute('aria-label', name);
    if (this.mark.getAttribute('title') !== tooltip) this.mark.setAttribute('title', tooltip);
    this.dom.setAttribute('data-irregular', 'true');
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  /**
   * A table selected as a whole (*Select table*) keeps a visible outline, as a selected image
   * does: the hidden native selection inside tables no longer shows it (feature 006,
   * data-model §1.4, §5.6).
   */
  selectNode(): void {
    this.dom.classList.add('fb-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('fb-selected');
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Attribute changes on the wrapper never come from the user.
    if (mutation.type === 'attributes' && mutation.target === this.dom) return true;
    // Everything inside the mark's caption is the view's own (data-model §3.3), and so is the
    // caption coming and going.
    const caption = this.caption;
    if (caption && (mutation.target === caption || caption.contains(mutation.target))) return true;
    if (mutation.type === 'childList' && mutation.target === this.dom) {
      const changed = [...mutation.addedNodes, ...mutation.removedNodes];
      if (changed.length > 0 && changed.every((node) => node.nodeName === 'CAPTION')) return true;
    }
    return false;
  }

  /** Every event inside the caption is the mark's: the editor does not handle it. */
  stopEvent(event: Event): boolean {
    const target = event.target;
    return !!this.caption && target instanceof Node && this.caption.contains(target);
  }

  destroy(): void {
    this.unsubscribe?.();
  }
}

export class CellView implements NodeView {
  readonly dom: HTMLTableCellElement;
  readonly contentDOM: HTMLTableCellElement;

  constructor(
    private node: PMNode,
    tag: 'td' | 'th',
  ) {
    this.dom = document.createElement(tag);
    this.dom.className = `fb-${tag}`;
    this.contentDOM = this.dom;
    this.render();
  }

  private render(): void {
    const attrs = this.node.attrs as Record<string, string | number | null>;
    const set = (name: string, value: string | number | null) => {
      if (value === null || value === undefined || value === '') this.dom.removeAttribute(name);
      else this.dom.setAttribute(name, String(value));
    };
    set('data-node-id', attrs.nodeId as string | null);
    set('data-id', attrs.id as string | null);
    set('data-style', attrs.style as string | null);
    // The effective spans, and only above 1 (feature 006, rule 9 of the grid, C20): the
    // browser then lays the cells out as the grid places them - it clips a rowspan at the
    // table's last row as rule 3 does - so `rowspan="0"` is one row, not the rest of the table.
    const colspan = effectiveColspan(attrs.colspan);
    const rowspan = effectiveRowspan(attrs.rowspan);
    set('colspan', colspan > 1 ? colspan : null);
    set('rowspan', rowspan > 1 ? rowspan : null);
    set('align', attrs.align as string | null);
    set('valign', attrs.valign as string | null);
    // The cell's xml:lang (FR-020), as written: `""` included, absent when null.
    const lang = attrs.lang;
    if (lang === null || lang === undefined) this.dom.removeAttribute('lang');
    else this.dom.setAttribute('lang', String(lang));
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return mutation.type === 'attributes' && mutation.target === this.dom;
  }
}

/**
 * The table, row and cell node views. With `options` an irregular table carries the warning
 * mark (feature 006 US8); the Body view passes them, the rich fields from US10 on.
 */
export function createTableNodeViews(
  options?: TableViewOptions,
): Record<string, NodeViewConstructor> {
  return {
    table: (node) => new TableView(node, options),
    td: (node) => new CellView(node, 'td'),
    th: (node) => new CellView(node, 'th'),
  };
}
