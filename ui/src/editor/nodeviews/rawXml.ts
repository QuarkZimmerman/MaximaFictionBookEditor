/**
 * "Unknown element" node views (T064) for `raw_xml` (block) and `raw_xml_inline`: elements the
 * FB2 schema does not know are preserved verbatim and shown as a read-only box with the
 * element name; the full XML is the tooltip. They can only be edited in the Source view.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { NodeView, NodeViewConstructor } from 'prosemirror-view';

import { rawXmlElementName } from '../schema';

export class RawXmlView implements NodeView {
  readonly dom: HTMLElement;
  private readonly name: HTMLElement;

  constructor(
    private node: PMNode,
    inline: boolean,
    private readonly getLabel: () => string,
  ) {
    this.dom = document.createElement(inline ? 'span' : 'div');
    this.dom.className = inline ? 'fb-unknown-inline' : 'fb-unknown';
    this.dom.setAttribute('data-testid', inline ? 'body-unknown-inline' : 'body-unknown');
    this.dom.setAttribute('contenteditable', 'false');
    this.name = document.createElement('span');
    this.name.className = 'fb-unknown-name';
    this.dom.appendChild(this.name);
    this.render();
  }

  private render(): void {
    const xml = String(this.node.attrs.xml ?? '');
    this.name.textContent = rawXmlElementName(xml);
    this.dom.setAttribute('data-xml', xml);
    this.dom.title = `${this.getLabel()}\n${xml}`.trim();
    const nodeId = this.node.attrs.nodeId as string | null;
    if (nodeId) this.dom.setAttribute('data-node-id', nodeId);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('fb-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('fb-selected');
  }

  stopEvent(): boolean {
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

export function createRawXmlNodeViews(getLabel: () => string): Record<string, NodeViewConstructor> {
  return {
    raw_xml: (node) => new RawXmlView(node, false, getLabel),
    raw_xml_inline: (node) => new RawXmlView(node, true, getLabel),
  };
}
