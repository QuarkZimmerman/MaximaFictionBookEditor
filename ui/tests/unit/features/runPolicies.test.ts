/**
 * Command policies while a script runs (feature 003 FR-011, T031) over the complete application
 * registry: Find, Find Next, incremental search, Copy, the Help menu, About and Exit stay
 * available; everything that changes the document or switches the view - Cut, Paste, Undo, the
 * Add / Style commands, New / Open / Save / Save As / Validate, the description import and the
 * FBD export (feature 004 FR-036 / FR-043), the view switch, the toolbars, Settings, the
 * spelling tools, the tree operations and the scripts - is blocked.
 */

import { createAppServices } from '@/app/services';
import { actions, createAppStore } from '@/model/store';

import { fakeDocument, fakeRpc, makeContext } from './testUtils';

const ALLOWED = [
  'edit.find',
  'edit.findNext',
  'edit.incrementalSearch',
  'edit.copy',
  'help.about',
  'help.checkVersion',
  'file.exit',
];

const BLOCKED = [
  'edit.replace',
  'edit.cut',
  'edit.paste',
  'edit.undo',
  'edit.redo',
  'edit.clone',
  'edit.split',
  'insert.title',
  'insert.binary',
  'style.strong',
  'file.new',
  'file.open',
  'file.save',
  'file.saveAs',
  'file.validate',
  'file.importDescription',
  'file.exportFbd',
  'view.body',
  'view.source',
  'view.description',
  'view.statusBar',
  'view.tree',
  'tools.settings',
  'tools.spellcheck',
  'tools.words',
  'tree.delete',
  'tree.view',
  'scripts.last',
  'scripts.reload',
];

describe('command policies during a script run (feature 003 FR-011)', () => {
  it('allows exactly the reading commands, Help, About and Exit', async () => {
    const store = createAppStore();
    const rpc = fakeRpc({ 'doc.recent': [], 'settings.get': new Error('no settings') });
    const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
    const ctx = { ...(await makeContext({ rpc: rpc.client })), store };
    actions.setConnection(store, 'connected');
    actions.setDocument(store, fakeDocument());
    actions.setScriptRunning(store, true);

    for (const id of ALLOWED) {
      expect(services.commands.has(id), id).toBe(true);
      expect(services.commands.get(id)?.duringScriptRun, id).toBe('allowed');
    }
    for (const id of BLOCKED) {
      expect(services.commands.has(id), id).toBe(true);
      expect(services.commands.get(id)?.duringScriptRun, id).not.toBe('allowed');
      expect(services.commands.isEnabled(id, ctx), id).toBe(false);
    }
    // Allowed commands follow their own enable rule: Help and Exit need nothing more.
    expect(services.commands.isEnabled('help.about', ctx)).toBe(true);
    expect(services.commands.isEnabled('help.checkVersion', ctx)).toBe(true);
    expect(services.commands.isEnabled('file.exit', ctx)).toBe(true);
    // Find follows its own rule (a document with a search target): available during the run.
    expect(services.commands.isEnabled('edit.find', ctx)).toBe(true);
    expect(services.commands.isEnabled('edit.findNext', ctx)).toBe(true);
    expect(services.commands.isEnabled('edit.replace', ctx)).toBe(false);

    actions.setScriptRunning(store, false);
    expect(services.commands.isEnabled('file.open', ctx)).toBe(true);
    expect(services.commands.isEnabled('view.source', ctx)).toBe(true);
    expect(services.commands.isEnabled('tools.settings', ctx)).toBe(true);
  });

  it('every registered command is blocked by default unless it is on the allowed list', async () => {
    const store = createAppStore();
    const rpc = fakeRpc({ 'doc.recent': [], 'settings.get': new Error('no settings') });
    const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
    const allowed = services.commands
      .all()
      .filter((command) => command.duringScriptRun === 'allowed')
      .map((command) => command.id)
      .sort();
    expect(allowed).toEqual([...ALLOWED].sort());
  });
});
