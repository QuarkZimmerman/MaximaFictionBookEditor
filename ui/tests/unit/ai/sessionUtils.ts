/**
 * Shared harness of the request-session and validity-hook tests (feature 005 T045): a store
 * with a fixture book, the application services (the undo coordinator), a fake RPC client whose
 * `doc.validate` is a small scripted validator over the document it receives - so that moved,
 * duplicated and fixed errors behave as the core's reports do - and whose `doc.fragmentFromXml`
 * answers from a table of fragments.
 */

import { createAppServices } from '@/app/services';
import type { ModelNodeJson } from '@/editor/fromModel';
import { gridOfModel } from '@/editor/table/grid';
import type {
  BodyNode,
  Document,
  SectionNode,
  TableNode,
  ValidationIssue,
  ValidationReport,
} from '@/model/document';
import { actions, createAppStore, type AppStore } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type FragmentResultNode } from '@/rpc/types';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDocument, fakeRpc, type FakeRpc } from '../features/testUtils';

export const TITLE_UNEXPECTED = "Element 'title': This element is not expected.";
export const BAD_WORD_MESSAGE = "Element 'p': the word BAD is not allowed here.";

export function paragraph(nodeId: string, text: string): SectionNode['content'][number] {
  return {
    type: 'p',
    attrs: { nodeId },
    content: [{ type: 'text', text }],
  } as SectionNode['content'][number];
}

export function title(nodeId: string, text: string): SectionNode['content'][number] {
  return {
    type: 'title',
    attrs: { nodeId },
    content: [paragraph(`${nodeId}p`, text)],
  } as SectionNode['content'][number];
}

export function section(nodeId: string, content: SectionNode['content']): SectionNode {
  return { type: 'section', attrs: { nodeId }, content } as SectionNode;
}

/**
 * The fixture book: section 1 valid, section 2 with a pre-existing error - a `title` after its
 * first paragraph (US4 scenario 2, review C3) - and a notes body.
 */
export function book(options: { preExisting?: boolean; bookTitle?: string } = {}): Document {
  const base = fakeDocument();
  const second: SectionNode['content'] = [paragraph('p3', 'Third paragraph.')];
  if (options.preExisting ?? true) second.push(title('t2', 'Late title'));
  second.push(paragraph('p4', 'Fourth paragraph.'));
  const body: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'b1' },
    content: [
      title('t0', 'The Book'),
      section('s1', [
        title('t1', 'ONE'),
        paragraph('p1', 'First paragraph.'),
        paragraph('p2', 'Second paragraph.'),
      ]),
      section('s2', second),
    ] as BodyNode['content'],
  };
  const notes: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'b2', name: 'notes' },
    content: [section('n1', [paragraph('np1', 'A note.')])] as BodyNode['content'],
  };
  return {
    ...base,
    description: {
      ...base.description,
      titleInfo: {
        ...base.description.titleInfo,
        bookTitle: options.bookTitle ?? base.description.titleInfo.bookTitle,
      },
    },
    bodies: [body, notes],
  };
}

/**
 * The scripted validator: a `title` that is not the first child of its section is an error
 * (`schema.invalid`, element `title`, libxml2's wording) with the section's path, the title's
 * nodeId and a line that grows with the position; a paragraph holding the word `BAD` is an
 * error of another kind; a paragraph holding `warn` is a warning; a book titled `NO SCHEMA`
 * answers `schema.unavailable`. Lines and paths shift with insertions, as the core's do. Since
 * feature 006 (T172) every irregular `table` of the bodies, both annotations and the history is a
 * `table.irregular` warning in the document form - its grid summary as `params`, its line, node
 * id and path - after the walk's other issues (the core's `table.irregular`, I20).
 */
export function validateDocument(document: Document): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (document.description.titleInfo.bookTitle === 'NO SCHEMA') {
    issues.push({ severity: 'error', code: 'schema.unavailable', params: { reason: 'no schema' } });
  }
  let line = 10;
  const visitSection = (node: ModelNodeJson, path: string) => {
    let sections = 0;
    let titles = 0;
    (node.content ?? []).forEach((child, index) => {
      line += 1;
      if (child.type === 'title') {
        titles += 1;
        if (index > 0) {
          issues.push({
            severity: 'error',
            code: 'schema.invalid',
            params: { element: 'title', message: TITLE_UNEXPECTED },
            line,
            nodeId: String(child.attrs?.nodeId ?? ''),
            path: `${path}/title[${titles}]`,
          });
        }
      } else if (child.type === 'p') {
        const text = (child.content ?? []).map((c) => c.text ?? '').join('');
        if (text.includes('BAD')) {
          issues.push({
            severity: 'error',
            code: 'schema.invalid',
            params: { element: 'p', message: BAD_WORD_MESSAGE },
            line,
            nodeId: String(child.attrs?.nodeId ?? ''),
            path,
          });
        }
        if (text.includes('warn')) {
          issues.push({
            severity: 'warning',
            code: 'text.suspicious',
            params: {},
            nodeId: String(child.attrs?.nodeId ?? ''),
          });
        }
      } else if (child.type === 'section') {
        sections += 1;
        visitSection(child, `${path}/section[${sections}]`);
      }
    });
  };
  document.bodies.forEach((body, index) =>
    visitSection(body as unknown as ModelNodeJson, `body[${index + 1}]`),
  );
  issues.push(...irregularTableWarnings(document));
  return {
    issues,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    durationMs: 3,
  };
}

/**
 * The `table.irregular` warnings of a document in the document form (rpc-api §3.2): every table
 * at any depth of the bodies and the description roots, in document order, an irregular one with
 * its summary, a line that grows with the walk, its node id and its structural path.
 */
export function irregularTableWarnings(document: Document): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let line = 100;
  const visit = (node: ModelNodeJson, path: string) => {
    line += 1;
    if (node.type === 'table') {
      const grid = gridOfModel(node as unknown as TableNode);
      if (!grid.regular) {
        issues.push({
          severity: 'warning',
          code: 'table.irregular',
          params: { ...grid.summary },
          line,
          nodeId: String(node.attrs?.nodeId ?? ''),
          path,
        });
      }
      return;
    }
    const counts = new Map<string, number>();
    for (const child of node.content ?? []) {
      if (child.type === 'text') continue;
      const n = (counts.get(child.type) ?? 0) + 1;
      counts.set(child.type, n);
      visit(child, `${path}/${child.type}[${n}]`);
    }
  };
  document.bodies.forEach((body, index) =>
    visit(body as unknown as ModelNodeJson, `body[${index + 1}]`),
  );
  const { titleInfo, srcTitleInfo, documentInfo } = document.description;
  const roots: [unknown, string][] = [
    [titleInfo.annotation, 'title-info/annotation[1]'],
    [srcTitleInfo?.annotation, 'src-title-info/annotation[1]'],
    [documentInfo.history, 'document-info/history[1]'],
  ];
  for (const [root, path] of roots) if (root) visit(root as ModelNodeJson, path);
  return issues;
}

/** A parsed fragment the fake `doc.fragmentFromXml` answers, by its (fence-stripped) xml text. */
export type FragmentTable = Record<
  string,
  { nodes: FragmentResultNode[]; inline: boolean } | RpcError
>;

export interface Harness {
  store: AppStore;
  rpc: FakeRpc;
  undo: ReturnType<typeof createAppServices>['undo'];
  /** Every document `doc.validate` received. */
  validated: Document[];
  deps: {
    store: AppStore;
    rpc: FakeRpc['client'];
    undo: ReturnType<typeof createAppServices>['undo'];
    getController: () => ReturnType<typeof getBodyController> | null;
    tickMs: number;
  };
}

export function harness(
  options: {
    document?: Document;
    controller?: boolean;
    fragments?: FragmentTable;
    /**
     * The reports the fake `doc.validate({docId, text})` answers, by the text (the Source text
     * path; text-form warnings carry `path`, `line`, `column` and a scratch `nodeId`); a text
     * without an entry answers an empty report.
     */
    textReports?: Record<string, ValidationReport>;
  } = {},
): Harness {
  const store = createAppStore();
  const validated: Document[] = [];
  const rpc = fakeRpc({
    'doc.validate': (params: unknown) => {
      const { document, text } = params as { docId: string; document?: Document; text?: string };
      if (text !== undefined) {
        return (
          options.textReports?.[text] ?? {
            issues: [],
            errorCount: 0,
            warningCount: 0,
            durationMs: 3,
          }
        );
      }
      validated.push(document!);
      return validateDocument(document!);
    },
    'doc.fragmentFromXml': (params: unknown) => {
      const { xml } = params as { xml: string };
      const entry = options.fragments?.[xml];
      if (!entry)
        return new RpcError(RpcErrorCode.docParseError, 'Document parse error', {
          line: 1,
          column: 1,
          message: `unknown fixture fragment: ${xml}`,
        });
      if (entry instanceof RpcError) return entry;
      return { ...entry, warnings: [] };
    },
    'job.cancel': {},
  });
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  actions.setConnection(store, 'connected');
  actions.setDocument(store, options.document ?? book());
  return {
    store,
    rpc,
    undo: services.undo,
    validated,
    deps: {
      store,
      rpc: rpc.client,
      undo: services.undo,
      getController: () => (options.controller ? getBodyController(store) : null),
      tickMs: 10_000,
    },
  };
}

/** The texts of the paragraphs of section `index` of the first body of the store's document. */
export function sectionTexts(document: Document, index: number): string[] {
  const body = document.bodies[0] as unknown as ModelNodeJson;
  const sections = (body.content ?? []).filter((c) => c.type === 'section');
  return (sections[index]?.content ?? []).map((child) =>
    child.type === 'title'
      ? `title:${(child.content ?? []).map((p) => (p.content ?? []).map((t) => t.text ?? '').join('')).join('')}`
      : (child.content ?? []).map((t) => t.text ?? '').join(''),
  );
}
