/**
 * Element names (node ids) are unique at every moment (feature 008, FR-021, data-model §7).
 *
 * `ensureUniqueNodeIds` runs wherever a document enters the store (`actions.setDocument`,
 * `actions.updateDocument`). It keeps a count of every id of the last document it saw and updates
 * it from the parts that changed - the top-level sections of the bodies and the description's
 * block roots, compared by identity - so an edit costs the size of what it changed, not of the
 * book. A repeat is repaired: the first holder keeps the id, every later one gets a fresh
 * `ui_r<N>` id; the first repair of a session is reported once (`onNodeIdRepair`).
 */

import type { Document } from './document';

interface IdNode {
  attrs?: { nodeId?: unknown };
  content?: readonly IdNode[];
}

/** One counted part: its node and whether only the node's own id counts (a body's shell). */
interface Unit {
  node: IdNode;
  own: boolean;
}

const subtreeCache = new WeakMap<object, string[]>();
const ownCache = new WeakMap<object, string[]>();

function idOf(node: IdNode): string | null {
  const id = node.attrs?.nodeId;
  return typeof id === 'string' && id !== '' ? id : null;
}

function idsOf(unit: Unit): string[] {
  const cache = unit.own ? ownCache : subtreeCache;
  const cached = cache.get(unit.node);
  if (cached) return cached;
  const ids: string[] = [];
  if (unit.own) {
    const id = idOf(unit.node);
    if (id) ids.push(id);
  } else {
    const pending: IdNode[] = [unit.node];
    for (let node = pending.pop(); node; node = pending.pop()) {
      const id = idOf(node);
      if (id) ids.push(id);
      for (const child of node.content ?? []) pending.push(child);
    }
  }
  cache.set(unit.node, ids);
  return ids;
}

function unitsOf(document: Document): Unit[] {
  const units: Unit[] = [];
  for (const body of document.bodies as readonly IdNode[]) {
    units.push({ node: body, own: true });
    for (const child of body.content ?? []) units.push({ node: child, own: false });
  }
  const { titleInfo, srcTitleInfo, documentInfo } = document.description;
  for (const root of [titleInfo.annotation, srcTitleInfo?.annotation, documentInfo.history]) {
    if (root) units.push({ node: root as IdNode, own: false });
  }
  return units;
}

let lastUnits: Unit[] = [];
let counts = new Map<string, number>();
let repeats = 0; // ids whose count is above one

function add(id: string, delta: number): void {
  const before = counts.get(id) ?? 0;
  const after = before + delta;
  if (after <= 0) counts.delete(id);
  else counts.set(id, after);
  if (before <= 1 && after > 1) repeats += 1;
  else if (before > 1 && after <= 1) repeats -= 1;
}

function account(units: Unit[]): void {
  const key = (u: Unit) => u.node;
  const previous = new Map<IdNode, Unit>();
  for (const unit of lastUnits) previous.set(key(unit), unit);
  const next = new Set<IdNode>();
  for (const unit of units) next.add(key(unit));
  for (const unit of lastUnits) {
    if (!next.has(key(unit))) for (const id of idsOf(unit)) add(id, -1);
  }
  for (const unit of units) {
    if (!previous.has(key(unit))) for (const id of idsOf(unit)) add(id, 1);
  }
  lastUnits = units;
}

type RepairListener = (count: number) => void;
const listeners = new Set<RepairListener>();
let reported = false;

/** Called once per session, at the first repair, with the number of ids renamed. */
export function onNodeIdRepair(listener: RepairListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function repair(document: Document): { document: Document; renamed: number } {
  const copy = structuredClone(document) as Document;
  const seen = new Set<string>();
  let renamed = 0;
  let next = 1;
  const fresh = (): string => {
    while (counts.has(`ui_r${next}`) || seen.has(`ui_r${next}`)) next += 1;
    return `ui_r${next++}`;
  };
  const visit = (node: IdNode) => {
    const id = idOf(node);
    if (id) {
      if (seen.has(id)) {
        const replacement = fresh();
        (node.attrs as { nodeId: string }).nodeId = replacement;
        seen.add(replacement);
        renamed += 1;
      } else {
        seen.add(id);
      }
    }
    for (const child of node.content ?? []) visit(child);
  };
  // Document order: the description's blocks, then the bodies, as the Body view shows them.
  const { titleInfo, srcTitleInfo, documentInfo } = copy.description;
  for (const root of [titleInfo.annotation, srcTitleInfo?.annotation, documentInfo.history]) {
    if (root) visit(root as IdNode);
  }
  for (const body of copy.bodies as readonly IdNode[]) visit(body);
  return { document: copy, renamed };
}

/** `document` itself when its ids are unique, else a repaired copy (see the module comment). */
export function ensureUniqueNodeIds(document: Document): Document {
  account(unitsOf(document));
  if (repeats === 0) return document;
  const { document: repaired, renamed } = repair(document);
  lastUnits = [];
  counts = new Map();
  repeats = 0;
  account(unitsOf(repaired));
  if (!reported && renamed > 0) {
    reported = true;
    for (const listener of [...listeners]) listener(renamed);
  }
  return repaired;
}

/** Tests: forgets the counted document and the session's report. */
export function resetNodeIdTracking(): void {
  lastUnits = [];
  counts = new Map();
  repeats = 0;
  reported = false;
}
