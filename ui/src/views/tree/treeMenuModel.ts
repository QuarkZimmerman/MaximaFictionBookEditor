/**
 * Feature 010, US7 (spec D19-D22): the Document tree's context menu for each kind of row. The
 * section operations name the section they involve - by its title cut to about 30 characters,
 * an untitled one by its place - and an entry that cannot run now carries the reason as its
 * tooltip; entries that never apply to the row's kind are not listed. Pure: the component
 * decides availability through the command registry.
 */

import type { TFunction } from 'i18next';

import { BLOCK_ROW_KINDS, type TreeIndex, type TreeRow } from './treeModel';

export interface TreeMenuItem {
  /** Test id suffix (`tree-menu-<id>`); the original editor's entries keep theirs. */
  id: string;
  commandId: string;
  label: string;
  /** Why the entry is greyed, shown as its tooltip when the registry refuses it. */
  reason?: string;
}

export type TreeMenuLine = TreeMenuItem | 'separator';

/** Kinds whose rows can be deleted from the tree (D19). */
const DELETABLE: ReadonlySet<string> = new Set([
  'section',
  'body',
  'title',
  'epigraph',
  'annotation',
  'image',
  'poem',
  'cite',
  'table',
]);

const NAME_LENGTH = 30;

/** A section's name in a menu entry: its title, cut, or its place among its siblings. */
export function sectionName(index: TreeIndex, row: TreeRow, t: TFunction): string {
  const caption = row.caption.startsWith('<') ? '' : row.caption.replace(/\s+/g, ' ').trim();
  if (caption) {
    const cut =
      caption.length > NAME_LENGTH ? `${caption.slice(0, NAME_LENGTH - 1)}\u2026` : caption;
    // A literal "&" of a title is no access letter of the entry.
    return cut.replace(/&/g, '&&');
  }
  const parent = row.parentId ? index.rows.get(row.parentId) : null;
  const siblings = parent
    ? parent.childIds.filter((id) => index.rows.get(id)?.kind === 'section')
    : [row.id];
  return t('tree.menuFor.untitled', { number: siblings.indexOf(row.id) + 1 });
}

function siblingSections(index: TreeIndex, row: TreeRow): string[] {
  const parent = row.parentId ? index.rows.get(row.parentId) : null;
  return parent ? parent.childIds.filter((id) => index.rows.get(id)?.kind === 'section') : [];
}

/** The menu of the row `rowId` (D19), or the two navigation entries for an unknown row. */
export function treeMenuFor(index: TreeIndex, rowId: string | null, t: TFunction): TreeMenuLine[] {
  const navigation: TreeMenuLine[] = [
    { id: 'view', commandId: 'tree.view', label: t('tree.menuFor.goTo') },
    { id: 'viewSource', commandId: 'tree.viewSource', label: t('tree.menuFor.goToSource') },
  ];
  const row = rowId ? index.rows.get(rowId) : undefined;
  if (!row || BLOCK_ROW_KINDS.has(row.kind)) return navigation;
  const lines: TreeMenuLine[] = [...navigation];
  if (row.kind === 'section') {
    const self = sectionName(index, row, t);
    const siblings = siblingSections(index, row);
    const at = siblings.indexOf(row.id);
    const previous = at > 0 ? index.rows.get(siblings[at - 1]!) : undefined;
    const next =
      at >= 0 && at < siblings.length - 1 ? index.rows.get(siblings[at + 1]!) : undefined;
    const parent = row.parentId ? index.rows.get(row.parentId) : undefined;
    const name = (other: TreeRow | undefined) => (other ? sectionName(index, other, t) : '');
    const hasSubsections = row.childIds.some((id) => index.rows.get(id)?.kind === 'section');
    lines.push(
      'separator',
      {
        id: 'moveUp',
        commandId: 'tree.moveUp',
        label: previous
          ? t('tree.menuFor.moveUp', { name: name(previous) })
          : t('tree.menuFor.moveUpPlain'),
        reason: t('tree.reason.first', { name: self }),
      },
      {
        id: 'moveDown',
        commandId: 'tree.moveDown',
        label: next
          ? t('tree.menuFor.moveDown', { name: name(next) })
          : t('tree.menuFor.moveDownPlain'),
        reason: t('tree.reason.last', { name: self }),
      },
      {
        id: 'moveWithChildren',
        commandId: 'tree.moveWithChildren',
        label: previous
          ? t('tree.menuFor.moveInto', { name: name(previous) })
          : t('tree.menuFor.moveIntoPlain'),
        reason: t('tree.reason.first', { name: self }),
      },
    );
    if (hasSubsections) {
      lines.push({
        id: 'moveRight',
        commandId: 'tree.moveRight',
        label: previous
          ? t('tree.menuFor.moveIntoOnly', { name: name(previous) })
          : t('tree.menuFor.moveIntoOnlyPlain'),
        reason: t('tree.reason.first', { name: self }),
      });
    }
    lines.push(
      {
        id: 'moveLeft',
        commandId: 'tree.moveLeft',
        label:
          parent?.kind === 'section'
            ? t('tree.menuFor.moveOut', { name: name(parent) })
            : t('tree.menuFor.moveOutPlain'),
        reason: t('tree.reason.topLevel', { name: self }),
      },
      {
        id: 'merge',
        commandId: 'tree.merge',
        label: next ? t('tree.menuFor.merge', { name: name(next) }) : t('tree.menuFor.mergePlain'),
        reason: t('tree.reason.last', { name: self }),
      },
    );
  }
  if (row.kind === 'image') {
    lines.push(
      'separator',
      { id: 'changePicture', commandId: 'image.change', label: t('tree.menuFor.changePicture') },
      { id: 'showPicture', commandId: 'image.show', label: t('tree.menuFor.showPicture') },
      { id: 'saveImage', commandId: 'image.saveAs', label: t('tree.menuFor.saveImage') },
    );
  }
  if (DELETABLE.has(row.kind)) {
    lines.push('separator', {
      id: 'delete',
      commandId: 'tree.delete',
      label: t(`tree.menuFor.delete.${row.kind}`),
      reason: t('tree.reason.cannotDelete'),
    });
  }
  return lines;
}
