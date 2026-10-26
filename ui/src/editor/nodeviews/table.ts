/**
 * Table node views (T063): the table renders as `<table class="fb-table"><tbody>` with the
 * rows as content, cells as `<th>` / `<td>` carrying their FB2 attributes (colspan, rowspan,
 * align, valign, id, style) so the browser lays them out while the Table bar edits them. The
 * caret moves between cells with Tab / Shift+Tab (keymap.ts) and Enter stays inside a cell.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { NodeView, NodeViewConstructor, ViewMutationRecord } from 'prosemirror-view';

import { effectiveColspan, effectiveRowspan } from '../table/grid';

export class TableView implements NodeView {
  readonly dom: HTMLTableElement;
  readonly contentDOM: HTMLTableSectionElement;

  constructor(private node: PMNode) {
    this.dom = document.createElement('table');
    this.dom.className = 'fb-table';
    this.dom.setAttribute('data-testid', 'body-table');
    this.contentDOM = document.createElement('tbody');
    this.dom.appendChild(this.contentDOM);
    this.render();
  }

  private render(): void {
    const { nodeId, id, style } = this.node.attrs as Record<string, string | null>;
    if (nodeId) this.dom.setAttribute('data-node-id', nodeId);
    if (id) this.dom.setAttribute('data-id', id);
    else this.dom.removeAttribute('data-id');
    if (style) this.dom.setAttribute('data-style', style);
    else this.dom.removeAttribute('data-style');
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Attribute changes on the wrapper never come from the user.
    return mutation.type === 'attributes' && mutation.target === this.dom;
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

export function createTableNodeViews(): Record<string, NodeViewConstructor> {
  return {
    table: (node) => new TableView(node),
    td: (node) => new CellView(node, 'td'),
    th: (node) => new CellView(node, 'th'),
  };
}
