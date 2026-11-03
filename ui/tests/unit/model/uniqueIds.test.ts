/**
 * Feature 008, T035 (FR-021, data-model §7): element names are unique at every moment; a repeat
 * from any source is repaired, and the first repair of a session is reported once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Document } from '@/model/document';
import { ensureUniqueNodeIds, onNodeIdRepair, resetNodeIdTracking } from '@/model/uniqueIds';

import { fakeDocument } from '../features/testUtils';

function para(id: string, text = 'text') {
  return { type: 'p', attrs: { nodeId: id }, content: [{ type: 'text', text }] };
}

function section(id: string, ...children: unknown[]) {
  return { type: 'section', attrs: { nodeId: id }, content: children };
}

function withBodies(sections: unknown[]): Document {
  return fakeDocument({
    bodies: [{ type: 'body', attrs: { nodeId: 'b1' }, content: sections }] as Document['bodies'],
  });
}

function ids(document: Document): string[] {
  const out: string[] = [];
  const visit = (node: { attrs?: { nodeId?: unknown }; content?: unknown[] }) => {
    if (typeof node.attrs?.nodeId === 'string') out.push(node.attrs.nodeId);
    for (const child of (node.content ?? []) as (typeof node)[]) visit(child);
  };
  for (const body of document.bodies as unknown as (typeof visit extends (n: infer N) => void
    ? N
    : never)[])
    visit(body);
  return out;
}

describe('ensureUniqueNodeIds (FR-021)', () => {
  beforeEach(() => resetNodeIdTracking());

  it('returns the same document when every id is unique', () => {
    const doc = withBodies([section('s1', para('p1')), section('s2', para('p2'))]);
    expect(ensureUniqueNodeIds(doc)).toBe(doc);
  });

  it('repairs a repeat: the first holder keeps the id, a later one gets a fresh id', () => {
    const doc = withBodies([section('sc_1', para('sc_2')), section('sc_3', para('sc_2'))]);
    const repaired = ensureUniqueNodeIds(doc);
    expect(repaired).not.toBe(doc);
    const all = ids(repaired);
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((id) => id === 'sc_2')).toHaveLength(1);
    expect(all).toContain('ui_r1');
  });

  it('reports the first repair of a session once, with the count and no text', () => {
    const listener = vi.fn();
    const off = onNodeIdRepair(listener);
    ensureUniqueNodeIds(withBodies([section('a', para('x')), section('b', para('x'))]));
    ensureUniqueNodeIds(withBodies([section('c', para('y')), section('d', para('y'))]));
    off();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it('notices a repeat brought in by a changed section of a later document', () => {
    const shared = section('s1', para('p1'));
    const first = withBodies([shared, section('s2', para('p2'))]);
    expect(ensureUniqueNodeIds(first)).toBe(first);
    const later = withBodies([shared, section('s2', para('p2')), section('s3', para('p1'))]);
    const repaired = ensureUniqueNodeIds(later);
    const all = ids(repaired);
    expect(new Set(all).size).toBe(all.length);
  });
});
