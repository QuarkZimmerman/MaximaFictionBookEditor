import { describe, expect, it } from 'vitest';

import {
  PACKAGE_MODE_VIEWS,
  isCommandAllowedInPackageMode,
  isCommandVisibleInPackageMode,
  requiresActivePackageEntry,
} from '@/features/package/packageModePolicy';

describe('packageModePolicy', () => {
  it('exposes strictly Description and Source views (hiding Body and Styles)', () => {
    expect(PACKAGE_MODE_VIEWS).toEqual(['description', 'source']);
    expect(isCommandVisibleInPackageMode('view.body')).toBe(false);
    expect(isCommandVisibleInPackageMode('view.styles')).toBe(false);
    expect(isCommandVisibleInPackageMode('view.description')).toBe(true);
    expect(isCommandVisibleInPackageMode('view.source')).toBe(true);
    expect(isCommandVisibleInPackageMode('view.tree')).toBe(true);
  });

  it('allows Package lifecycle, Description editing, View, Settings, Batch Converter, Help, and Recent Files', () => {
    const allowed = [
      'file.new',
      'file.newPackage',
      'file.open',
      'file.save',
      'file.saveAs',
      'file.validate',
      'file.importDescription',
      'file.recent1',
      'file.recent5',
      'file.recent10',
      'file.exit',
      'edit.undo',
      'edit.redo',
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.pastePlain',
      'view.toolbarCommands',
      'view.statusBar',
      'view.tree',
      'view.description',
      'view.source',
      'ai.toggle',
      'tools.settings',
      'tools.batchConverter',
      'help.checkVersion',
      'help.about',
    ];
    for (const id of allowed) {
      expect(isCommandAllowedInPackageMode(id), id).toBe(true);
    }
  });

  it('blocks FB2-body commands, Find/Replace, Exports, non-FBD Imports, Scripts, Tree ops, Words, Spellcheck, Preview, and Styles', () => {
    const blocked = [
      'view.body',
      'view.styles',
      'view.toolbarScripts',
      'view.linksBar',
      'view.tableBar',
      'file.preview',
      'file.exportFbd',
      'file.exportEpub',
      'file.exportPdf',
      'file.exportMarkdown',
      'file.exportTxt',
      'file.exportMobi',
      'file.importMarkdown',
      'file.importEpub',
      'file.importPdf',
      'file.importTxt',
      'file.importMobi',
      'edit.find',
      'edit.findNext',
      'edit.replace',
      'insert.section',
      'insert.binary',
      'insert.image',
      'insert.table',
      'style.strong',
      'style.emphasis',
      'tools.words',
      'tools.spellCheck',
      'tools.scripts',
      'scripts.last',
      'scripts.reload',
      'scripts.openFolder',
      'script.custom.cleanup',
      'tree.moveUp',
      'tree.delete',
      'tree.merge',
      'table.insertRowBelow',
      'ai.ask',
    ];
    for (const id of blocked) {
      expect(isCommandAllowedInPackageMode(id), id).toBe(false);
    }
  });

  it('marks Validate and Import Description as requiring an active package entry', () => {
    expect(requiresActivePackageEntry('file.validate')).toBe(true);
    expect(requiresActivePackageEntry('file.importDescription')).toBe(true);
    expect(requiresActivePackageEntry('file.save')).toBe(false);
    expect(requiresActivePackageEntry('file.newPackage')).toBe(false);
  });
});
