/**
 * The human summaries of the activity list's `tool.call` entries (feature 005 T055;
 * ai-catalogue §6.16, data-model §5.2; review C14): *Read section 3 "Title" (2 300
 * characters, part 1 of 2)*, *Searched "ё" (12 matches)*, *Replaced paragraph
 * body[1]/section[2]/p[4]*, *Changed the description (titleInfo.genres)*. The entry is the
 * privacy record of what left the computer (US7 scenario 3), so it names the part - element,
 * path, title - and never the text of the book or the values written (`set_description` names
 * its dotted fields only). Every text is localised; the element names come from the catalogue
 * (`ai.activity.element.*`), the paths and titles are the document's own.
 *
 * `callSummary` is written before the call from the arguments alone (the reference resolved
 * against the working copy of the moment); `resultSummary` completes it from the result - the
 * sizes, the match counts, the fields - once the call has answered. Part of the lazy chunk.
 */

import type { TFunction } from 'i18next';

import type { Document } from '@/model/document';

import { indexDocument, pathOf, resolveReference, titleText, type Entry } from './tools/model';

/** What the summaries know about a tool call: its name and its (coerced or raw) arguments. */
export interface SummarisedCall {
  name: string;
  args: Record<string, unknown>;
}

/** The element names the summaries localise; every other element keeps its FB2 name. */
const ELEMENT_KEYS: Record<string, string> = {
  p: 'p',
  section: 'section',
  body: 'body',
  title: 'title',
  'empty-line': 'emptyLine',
  image: 'image',
  poem: 'poem',
  stanza: 'stanza',
  v: 'v',
  cite: 'cite',
  epigraph: 'epigraph',
  subtitle: 'subtitle',
  table: 'table',
  'text-author': 'textAuthor',
  annotation: 'annotation',
};

/** The localised name of an element (`p` → "paragraph"); an unknown one as it is. */
export function elementName(t: TFunction, type: string): string {
  const key = ELEMENT_KEYS[type];
  return key ? t(`ai.activity.element.${key}`) : type;
}

/** The model's arguments as a record (a JSON string parsed when possible, else empty). */
export function argumentsOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The last `[n]` of a structural path. */
function lastIndex(path: string): string {
  const match = /\[(\d+)\]$/.exec(path);
  return match ? match[1]! : '';
}

/**
 * The telling form of a node: `section 1 "Title"` for a section, `body "notes"` / `body 1` for
 * a body, `paragraph body[1]/section[2]/p[4]` for everything else.
 */
export function nodeLabel(
  t: TFunction,
  node: { type: string; path: string; title?: string; name?: string },
): string {
  const element = elementName(t, node.type);
  if (node.type === 'section') {
    const index = lastIndex(node.path);
    const title = node.title ? ` "${node.title}"` : '';
    return `${element} ${index}${title}`.trim();
  }
  if (node.type === 'body') {
    return node.name ? `${element} "${node.name}"` : `${element} ${lastIndex(node.path)}`.trim();
  }
  return `${element} ${node.path}`;
}

/** `nodeLabel` of an entry of the working copy. */
function entryLabel(t: TFunction, entry: Entry): string {
  const node = entry.node;
  const name = node.attrs?.name;
  return nodeLabel(t, {
    type: node.type,
    path: pathOf(entry),
    title: node.type === 'section' ? titleText(node) : '',
    ...(typeof name === 'string' ? { name } : {}),
  });
}

/** The label of a node reference of the arguments, resolved against `document` when it can be. */
export function referenceLabel(t: TFunction, document: Document, reference: string): string {
  if (!reference) return '';
  let entry: Entry | null;
  try {
    entry = resolveReference(indexDocument(document), reference);
  } catch {
    entry = null;
  }
  return entry ? entryLabel(t, entry) : reference;
}

/** `NodeInfo` of a result (`{id, path, type, characters?}`) as a label; the id when it is all there is. */
function infoLabel(t: TFunction, info: unknown, document: Document | null): string {
  if (!info || typeof info !== 'object') return '';
  const record = info as Record<string, unknown>;
  const path = asString(record.path);
  const type = asString(record.type);
  const id = asString(record.id);
  if (document && id) {
    const label = referenceLabel(t, document, id);
    if (label !== id) return label;
  }
  if (type && path) return nodeLabel(t, { type, path });
  return path || id;
}

/**
 * The summary of a call before it runs: what is about to be read or changed, named from the
 * arguments (the reference resolved against the working copy as it stands).
 */
export function callSummary(t: TFunction, call: SummarisedCall, document: Document): string {
  const { name, args } = call;
  const node = asString(args.node);
  switch (name) {
    case 'get_context':
      return t('ai.activity.summary.getContext');
    case 'get_outline':
      return node
        ? t('ai.activity.summary.getOutlineOf', { target: referenceLabel(t, document, node) })
        : t('ai.activity.summary.getOutline');
    case 'read_part':
      return t('ai.activity.summary.readPart', { target: referenceLabel(t, document, node) });
    case 'get_selection':
      return t('ai.activity.summary.getSelection');
    case 'get_description':
      return t('ai.activity.summary.getDescription');
    case 'find':
      return t('ai.activity.summary.find', { text: asString(args.text) });
    case 'validate':
      return t('ai.activity.summary.validate');
    case 'get_schema': {
      const element = asString(args.element).trim();
      return element
        ? t('ai.activity.summary.getSchemaElement', { element })
        : t('ai.activity.summary.getSchema');
    }
    case 'set_selection':
      return t('ai.activity.summary.setSelection');
    case 'replace_selection':
      return t('ai.activity.summary.replaceSelection');
    case 'replace_node':
      return t('ai.activity.summary.replaceNode', { target: referenceLabel(t, document, node) });
    case 'insert_node': {
      const where = asString(args.where);
      const known = where === 'before' || where === 'after' || where === 'append';
      return t('ai.activity.summary.insertNode', {
        where: t(`ai.activity.summary.where.${known ? where : 'after'}`),
        target: referenceLabel(t, document, node),
      });
    }
    case 'remove_node':
      return t('ai.activity.summary.removeNode', { target: referenceLabel(t, document, node) });
    case 'set_text':
      return t('ai.activity.summary.setText', { target: referenceLabel(t, document, node) });
    case 'replace_all':
      return t('ai.activity.summary.replaceAll', { text: asString(args.text) });
    case 'set_description':
      return t('ai.activity.summary.setDescription');
    // US6: the script tools name the script id or the resource URI - never a file's content.
    case 'list_scripts':
      return t('ai.activity.summary.listScripts');
    case 'read_script':
      return t('ai.activity.summary.readScript', { id: asString(args.id) });
    case 'read_resource':
      return t('ai.activity.summary.readResource', { uri: asString(args.uri) });
    case 'run_script':
      return t('ai.activity.summary.runScript', { id: asString(args.id) });
    case 'propose_script': {
      const files = Array.isArray(args.files) ? args.files.length : 0;
      return t('ai.activity.summary.proposeScript', { id: asString(args.id), count: files });
    }
    case 'reload_scripts':
      return t('ai.activity.summary.reloadScripts');
    default:
      return name;
  }
}

/** What `resultSummary` needs beside the result: the part index of a continued read. */
export interface ResultSummaryOptions {
  /** The 1-based index of this part when the read was continued with a cursor. */
  part?: number;
}

/**
 * The summary completed from the result: the characters read and the part of a `read_part`,
 * the match counts of `find` / `replace_all`, the number of elements inserted, the dotted
 * fields `set_description` wrote. `null` when the result adds nothing to the call summary (an
 * error envelope, a tool without sizes).
 */
export function resultSummary(
  t: TFunction,
  call: SummarisedCall,
  result: Record<string, unknown>,
  document: Document | null,
  options: ResultSummaryOptions = {},
): string | null {
  const { name, args } = call;
  if ('error' in result) return null;
  switch (name) {
    case 'read_part': {
      const target = document
        ? referenceLabel(t, document, asString(args.node))
        : infoLabel(t, result.node, null);
      const info = result.node as Record<string, unknown> | undefined;
      const characters = asNumber(info?.characters);
      const more = result.more as Record<string, unknown> | undefined;
      const part = options.part ?? 1;
      if (more && typeof more === 'object') {
        const remaining = more.remaining as Record<string, unknown> | undefined;
        const left = asNumber(remaining?.characters) ?? 0;
        const delivered = deliveredCharacters(result);
        const parts = part + Math.max(1, Math.ceil(left / Math.max(1, delivered)));
        return t('ai.activity.summary.readPartPart', {
          target,
          characters: characters ?? delivered,
          part,
          parts,
        });
      }
      if (part > 1) {
        return t('ai.activity.summary.readPartPart', {
          target,
          characters: characters ?? deliveredCharacters(result),
          part,
          parts: part,
        });
      }
      return characters === undefined
        ? null
        : t('ai.activity.summary.readPartSized', { target, characters });
    }
    case 'find': {
      const total = asNumber(result.total);
      return total === undefined
        ? null
        : t('ai.activity.summary.findCount', { text: asString(args.text), count: total });
    }
    case 'replace_all': {
      const count = asNumber(result.count);
      return count === undefined
        ? null
        : t('ai.activity.summary.replaceAllCount', { text: asString(args.text), count });
    }
    case 'validate': {
      const fresh = Array.isArray(result.newErrors) ? result.newErrors.length : undefined;
      const preExisting = Array.isArray(result.preExistingErrors)
        ? result.preExistingErrors.length
        : undefined;
      return fresh === undefined || preExisting === undefined
        ? null
        : t('ai.activity.summary.validateResult', { new: fresh, preExisting });
    }
    case 'get_schema': {
      if (result.known === false) {
        return t('ai.activity.summary.getSchemaUnknown', { element: asString(result.name) });
      }
      return null;
    }
    case 'insert_node': {
      const nodes = Array.isArray(result.nodes) ? result.nodes : [];
      if (nodes.length === 0) return null;
      const where = asString(args.where);
      const known = where === 'before' || where === 'after' || where === 'append';
      return t('ai.activity.summary.insertNodeCount', {
        count: nodes.length,
        where: t(`ai.activity.summary.where.${known ? where : 'after'}`),
        target: document ? referenceLabel(t, document, asString(args.node)) : asString(args.node),
      });
    }
    case 'remove_node': {
      const removed = infoLabel(t, result.removed, null);
      return removed ? t('ai.activity.summary.removeNode', { target: removed }) : null;
    }
    case 'set_description': {
      const fields = Array.isArray(result.fields)
        ? result.fields.filter((f): f is string => typeof f === 'string')
        : [];
      return fields.length === 0
        ? null
        : t('ai.activity.summary.setDescriptionFields', { fields: fields.join(', ') });
    }
    default:
      return null;
  }
}

/** The characters a `read_part` part delivered: the sum of its text blocks, else its XML's length. */
function deliveredCharacters(result: Record<string, unknown>): number {
  if (Array.isArray(result.blocks)) {
    return result.blocks.reduce<number>((sum, block) => {
      const text = block && typeof block === 'object' ? (block as { text?: unknown }).text : '';
      return sum + (typeof text === 'string' ? text.length : 0);
    }, 0);
  }
  return typeof result.xml === 'string' ? result.xml.length : 0;
}

/** The key under which the parts of one continued read are counted (the arguments without the cursor). */
export function continuationKey(call: SummarisedCall): string {
  const { cursor: _cursor, ...rest } = call.args;
  void _cursor;
  return `${call.name}:${JSON.stringify(rest)}`;
}
