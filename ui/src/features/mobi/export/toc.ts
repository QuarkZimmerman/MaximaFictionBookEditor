/**
 * Feature 018 (T020, contracts/mobi-export.md §1–§2): hierarchical navigation tree builder and
 * inline HTML Table of Contents renderers for MOBI 7 and KF8.
 */
import type { BodyNode, SectionNode, TitleNode } from '@/model/document';

import {
  escapeAttr,
  escapeXml,
  titlePlainText,
  type BookExportPlan,
  type MobiNavItem,
} from './metadata';

function bodyTitleNode(body: BodyNode): TitleNode | undefined {
  return body.content.find((child): child is TitleNode => child.type === 'title');
}

function sectionTitleNode(section: SectionNode): TitleNode | undefined {
  return section.content.find((child): child is TitleNode => child.type === 'title');
}

/**
 * Builds the flat, document-ordered hierarchical navigation tree (`depth` 0-based) for native
 * `INDX`/`CNCX` and inline TOC. Generated whenever titled sections, further bodies, or notes exist.
 */
export function buildNavTree(
  bodies: readonly BodyNode[],
  plan: BookExportPlan,
): { nav: MobiNavItem[]; bodyAnchorIds: Map<number, string> } {
  const nav: MobiNavItem[] = [];
  const bodyAnchorIds = new Map<number, string>();

  const walkSection = (section: SectionNode, depth: number): void => {
    const anchorId = plan.elementIds.get(section.attrs.nodeId) ?? plan.ids.allocate('s');
    const heading = titlePlainText(sectionTitleNode(section));
    if (heading) {
      nav.push({ label: heading, anchorId, depth });
    }
    for (const child of section.content) {
      if (child.type === 'section') {
        walkSection(child, heading ? depth + 1 : depth);
      }
    }
  };

  // Main body sections at depth 0
  if (plan.mainBodyIndex >= 0) {
    const mainBody = bodies[plan.mainBodyIndex]!;
    bodyAnchorIds.set(plan.mainBodyIndex, 'fb2-main-start');
    for (const child of mainBody.content) {
      if (child.type === 'section') walkSection(child, 0);
    }
  }

  // Further non-notes bodies (each starts a depth-0 entry; its sections nest under depth 1)
  for (const idx of plan.furtherBodyIndices) {
    const body = bodies[idx]!;
    const anchorId = plan.ids.allocate(`fb2-body-${idx}`);
    bodyAnchorIds.set(idx, anchorId);
    const label =
      titlePlainText(bodyTitleNode(body)) || (body.attrs.name ?? '').trim() || `Body ${idx + 1}`;
    nav.push({ label, anchorId, depth: 0 });
    for (const child of body.content) {
      if (child.type === 'section') walkSection(child, 1);
    }
  }

  // Notes bodies (grouped under a single depth-0 entry when present)
  if (plan.notesBodyIndices.length > 0) {
    const firstNotes = bodies[plan.notesBodyIndices[0]!]!;
    const label = titlePlainText(bodyTitleNode(firstNotes)) || plan.words.notes;
    for (const idx of plan.notesBodyIndices) {
      bodyAnchorIds.set(
        idx,
        idx === plan.notesBodyIndices[0] ? 'fb2-notes' : plan.ids.allocate(`fb2-notes-${idx}`),
      );
    }
    nav.push({ label, anchorId: 'fb2-notes', depth: 0 });
  }

  return { nav, bodyAnchorIds };
}

/** MOBI 7 HTML 3.2 inline Table of Contents block (with `filepos` placeholders patched by core). */
export function renderInlineTocMobi7(nav: readonly MobiNavItem[], heading: string): string {
  if (nav.length === 0) return '';
  const items = nav
    .map((entry) => {
      const indent = Math.min(entry.depth, 5) * 1.5;
      const widthAttr = indent > 0 ? ` width="${indent}em"` : ' width="0"';
      return `<p${widthAttr}><a filepos="0000000000" data-target="${escapeAttr(entry.anchorId)}">${escapeXml(entry.label)}</a></p>`;
    })
    .join('');
  return `<div id="fb2-toc" class="fb2-toc"><h2>${escapeXml(heading)}</h2>${items}</div>`;
}

/** KF8 XHTML5 inline Table of Contents `<nav epub:type="toc">` block. */
export function renderInlineTocKf8(nav: readonly MobiNavItem[], heading: string): string {
  if (nav.length === 0) return '';
  const items = nav
    .map((entry) => {
      const pad = Math.min(entry.depth, 5);
      const cls = pad > 0 ? ` class="fb2-toc-d${pad}"` : '';
      return `<li${cls}><a href="#${escapeAttr(entry.anchorId)}" data-kf8-target="${escapeAttr(entry.anchorId)}">${escapeXml(entry.label)}</a></li>`;
    })
    .join('');
  return `<nav id="fb2-toc" class="fb2-toc" epub:type="toc"><h2>${escapeXml(heading)}</h2><ol>${items}</ol></nav>`;
}
