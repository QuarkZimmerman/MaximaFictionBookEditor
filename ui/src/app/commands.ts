/**
 * Command registry: every menu item, toolbar button and hotkey target is a `Command` with a
 * stable id (`file.new`, `edit.undo`, `style.subtitle`, `insert.table`, `symbol.<N>`,
 * `script.<id>`...), i18n label/tooltip keys, an enable predicate, a policy for the time a
 * script runs (`duringScriptRun`), an optional checked state for toggles and the action
 * itself. Ids are the identifiers used by `hotkeys.json` (resource-formats.md §7) and by the
 * parity matrix.
 *
 * The built-in table below registers the complete FBE command set. Commands whose feature is
 * delivered by a later task are registered as stubs (`stub: true`, disabled) so menus, toolbars
 * and the Hotkeys page already know about them; the owning task replaces the stub by calling
 * `registry.replace(...)` (T052 file flows, T057-T068 editing, T066 search, T105 scripts...).
 */

import type { TFunction } from 'i18next';

import { documentFileTypes } from '@/dialogs/fileTypes';
import type { Dialogs } from '@/dialogs/types';
import { toggleFastMode } from '@/editor/fastMode';
import { proposedFileName } from '@/features/file/proposedName';
import { parseAccelerator } from '@/i18n';
import type { CaretRegistry } from '@/model/caret';
import { actions, type AppStore, documentFileName, isRunLocked } from '@/model/store';
import type { UndoCoordinator } from '@/model/undo';
import { RpcError, type RpcClient } from '@/rpc/client';
import type { Document, ViewId } from '@/rpc/types';
import { startSourceTagCompletion } from '@/views/source/completion';

import type { HotkeyMap } from './hotkeys';

export type CommandGroup =
  | 'file'
  | 'edit'
  | 'navigation'
  | 'style'
  | 'view'
  | 'tools'
  | 'symbols'
  | 'scripts'
  | 'table'
  | 'help';

/**
 * Hotkey-page group order as in the original (Plugins dropped: no plugin system), with the
 * table commands of feature 006 (C23) after the original groups.
 */
export const COMMAND_GROUPS: readonly CommandGroup[] = [
  'file',
  'edit',
  'navigation',
  'style',
  'view',
  'tools',
  'symbols',
  'scripts',
  'table',
  'help',
];

/**
 * A hotkey focus scope (feature 006, C6): a chord the user assigned to a command of the scope
 * runs it only while the key event's target lies inside the scope's element - for
 * `tableTarget`, the active table edit target's DOM (the Body editor, the focused rich field).
 */
export type HotkeyScope = 'tableTarget';

export interface CommandContext {
  store: AppStore;
  /** Null until the RPC client exists (unit tests, core-less UI). */
  rpc: RpcClient | null;
  undo: UndoCoordinator;
  dialogs: Dialogs;
  hotkeys: HotkeyMap;
  /** Per-view caret providers (optional for minimal test contexts). */
  carets?: CaretRegistry;
  t: TFunction;
  /** Version string for About. */
  version: string;
}

export interface Command {
  id: string;
  group: CommandGroup;
  /** i18n key of the menu label (may contain `&` accelerators). */
  labelKey?: string;
  /** Literal label for dynamic commands (symbols, scripts) whose names come from resources. */
  label?: string;
  /** i18n key of the short name (toolbar tooltip, Hotkeys page). */
  tooltipKey?: string;
  tooltip?: string;
  /** i18n key of the long description (status-bar hint, Hotkeys page "Description"). */
  descriptionKey?: string;
  description?: string;
  /** Interpolation values for the keys above (e.g. `{count}` for collapse levels). */
  labelParams?: Record<string, unknown>;
  /** Icon base name in `public/icons/toolbar24` and `toolbar16` (e.g. `id_file_new`). */
  icon?: string;
  run: (ctx: CommandContext) => void | Promise<void>;
  /** Defaults to always enabled. */
  enabled?: (ctx: CommandContext) => boolean;
  /**
   * Defaults to always visible. An invisible command leaves no menu entry (a separator beside
   * it is not doubled), no toolbar button and no row on the Hotkeys page, while its id stays
   * registered - the hotkey tables may name it and a feature may take it over with `replace`
   * (the AI assistant's commands while the assistant is disabled, feature 005 FR-096).
   */
  visible?: (ctx: CommandContext) => boolean;
  /** Present for toggles; drives menu checkmarks and pressed toolbar buttons. */
  checked?: (ctx: CommandContext) => boolean;
  /**
   * Policy while the run lock is held (`store.runLock` - a script run or an AI request, the
   * quiet lock of feature 003 FR-011 and feature 005 FR-022): `blocked` (the default) disables
   * the command for the whole run; `allowed` leaves it to its own `enabled` predicate. Only
   * commands that neither change the document nor switch the view are allowed (Find, copy,
   * Help, About, Exit...).
   */
  duringScriptRun?: 'blocked' | 'allowed';
  /**
   * Why the command is unavailable, in words for the user (feature 006, FR-043; data-model
   * §9.6), or null. An opt-in: only a command that defines it gets a reason, and it is read
   * through `CommandRegistry.unavailableReason`, which answers for the stub, the enabled and
   * the run-locked cases itself - so the function is asked only while the command is disabled
   * by its own `enabled` predicate.
   */
  unavailableReason?: (ctx: CommandContext) => string | null;
  /**
   * The focus scope of the command's hotkey (feature 006, C6; `HotkeyScope`): unset for every
   * command but the 24 `table.*` ones. Menus, context menus, toolbar buttons and the bars are
   * not affected.
   */
  hotkeyScope?: HotkeyScope;
  /** Registered for parity but not implemented yet; always disabled. */
  stub?: boolean;
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private readonly listeners = new Set<() => void>();
  private readonly scopes = new Map<HotkeyScope, () => HTMLElement | null>();

  register(command: Command): () => void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered`);
    }
    this.commands.set(command.id, command);
    this.emit();
    return () => this.unregister(command.id);
  }

  /** Replaces an existing command (a later task takes over a stub) or registers a new one. */
  replace(command: Command): void {
    this.commands.set(command.id, command);
    this.emit();
  }

  unregister(id: string): void {
    if (this.commands.delete(id)) this.emit();
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  all(): Command[] {
    return [...this.commands.values()];
  }

  byGroup(group: CommandGroup): Command[] {
    return this.all().filter((command) => command.group === group);
  }

  /**
   * A stub is never enabled; while the run lock is held only a command whose
   * `duringScriptRun` policy is `allowed` is, and then according to its own `enabled` predicate.
   */
  isEnabled(id: string, ctx: CommandContext): boolean {
    const command = this.commands.get(id);
    if (!command || command.stub) return false;
    if (isRunLocked(ctx.store.getState()) && command.duringScriptRun !== 'allowed') return false;
    return command.enabled ? command.enabled(ctx) : true;
  }

  /**
   * Why a command is unavailable (feature 006, FR-043; data-model §9.6), for the title of a
   * disabled menu item, popup entry or toolbar button (`unavailableTitle`). Null for an
   * unregistered id, a stub, a command that defines no `unavailableReason` (an opt-in: every
   * other tooltip stays as it is) and an enabled command; while the run lock blocks the
   * command, the text of the lock's kind - a script run or an AI request, which is the only
   * time the assistant is named (feature 005 FR-096); otherwise the command's own text.
   */
  unavailableReason(id: string, ctx: CommandContext): string | null {
    const command = this.commands.get(id);
    if (!command || command.stub || !command.unavailableReason) return null;
    if (this.isEnabled(id, ctx)) return null;
    const state = ctx.store.getState();
    if (isRunLocked(state) && command.duringScriptRun !== 'allowed') {
      return ctx.t(`commands.unavailable.runLock.${state.runLock!.kind}`) as string;
    }
    return command.unavailableReason(ctx);
  }

  /**
   * Installs the element resolver of a hotkey scope (feature 006, C6): the tables feature
   * gives the active table edit target's DOM, so this layer imports nothing of it. Returns the
   * function that removes the resolver again (when it is still the installed one).
   */
  setHotkeyScope(scope: HotkeyScope, resolve: () => HTMLElement | null): () => void {
    this.scopes.set(scope, resolve);
    return () => {
      if (this.scopes.get(scope) === resolve) this.scopes.delete(scope);
    };
  }

  /**
   * Whether a chord bound to `id` may be handed to the command for a key event aimed at
   * `target` (the capture-phase dispatcher of `App.tsx`): always for a command without a
   * scope (and for an unregistered id, which `dispatch` refuses anyway); for a scoped one only
   * when `target` is a node inside the element the scope's resolver gives - never while no
   * resolver is installed. Otherwise the key goes on to the editor, the field or the browser.
   */
  allowsHotkey(id: string, target: EventTarget | null): boolean {
    const scope = this.commands.get(id)?.hotkeyScope;
    if (!scope) return true;
    const resolve = this.scopes.get(scope);
    const element = resolve ? resolve() : null;
    return !!element && target instanceof Node && element.contains(target);
  }

  /**
   * Tells the subscribers (menus, toolbars, the Hotkeys page) to re-evaluate the command
   * states although the set of commands is unchanged; the scripts feature calls it when a run
   * starts or ends, so the run policies take effect at once.
   */
  refresh(): void {
    this.emit();
  }

  isChecked(id: string, ctx: CommandContext): boolean {
    const command = this.commands.get(id);
    return command?.checked ? command.checked(ctx) : false;
  }

  /**
   * False for an unregistered command and for a registered one whose `visible` predicate says
   * so; the menus, the toolbars and the Hotkeys page leave such a command out entirely.
   */
  isVisible(id: string, ctx: CommandContext): boolean {
    const command = this.commands.get(id);
    if (!command) return false;
    return command.visible ? command.visible(ctx) : true;
  }

  /**
   * Runs a command when it exists and is enabled. Returns false otherwise. Errors thrown by the
   * command are shown to the user (Error message box) and reported to the core log.
   */
  async execute(id: string, ctx: CommandContext): Promise<boolean> {
    const command = this.commands.get(id);
    if (!command || !this.isEnabled(id, ctx)) return false;
    try {
      await command.run(ctx);
    } catch (error) {
      await reportCommandError(ctx, command, error);
    }
    return true;
  }

  /** Synchronous variant for keyboard dispatch: starts the command, reports true if accepted. */
  dispatch(id: string, ctx: CommandContext): boolean {
    if (!this.isEnabled(id, ctx)) return false;
    void this.execute(id, ctx);
    return true;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/* ------------------------------------------------------------------------ */
/* Label helpers                                                            */
/* ------------------------------------------------------------------------ */

/** Menu label with `&` markers (for accelerator parsing). */
export function commandLabelRaw(command: Command, t: TFunction): string {
  if (command.label !== undefined) return command.label;
  if (command.labelKey) return t(command.labelKey, command.labelParams ?? {}) as string;
  return commandTooltip(command, t);
}

/** Menu label without `&` markers. */
export function commandLabel(command: Command, t: TFunction): string {
  return parseAccelerator(commandLabelRaw(command, t)).text;
}

/** Short name for tooltips and the Hotkeys page. */
export function commandTooltip(command: Command, t: TFunction): string {
  if (command.tooltip !== undefined) return command.tooltip;
  if (command.tooltipKey) return t(command.tooltipKey, command.labelParams ?? {}) as string;
  if (command.labelKey) return parseAccelerator(t(command.labelKey) as string).text;
  return command.label ?? command.id;
}

/** Long description (status-bar hint). */
export function commandDescription(command: Command, t: TFunction): string {
  if (command.description !== undefined) return command.description;
  if (command.descriptionKey) return t(command.descriptionKey, command.labelParams ?? {}) as string;
  return commandTooltip(command, t);
}

/**
 * The title of a disabled entry whose command gives a reason (feature 006, FR-043; data-model
 * §9.6): "Delete row: the table has only one row; use Delete table". Menus, popup entries and
 * toolbar buttons set it as `title` and `aria-description` - native tooltips do not show on
 * keyboard focus (U40).
 */
export function unavailableTitle(command: Command, reason: string, t: TFunction): string {
  return t('commands.unavailable.title', { command: commandTooltip(command, t), reason }) as string;
}

export function symbolCommandId(index: number): string {
  return `symbol.${index}`;
}

export function scriptCommandId(scriptId: string): string {
  return `script.${scriptId}`;
}

/* ------------------------------------------------------------------------ */
/* Shared helpers for built-in commands                                      */
/* ------------------------------------------------------------------------ */

async function reportCommandError(
  ctx: CommandContext,
  command: Command,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await ctx.rpc?.call('log.error', {
      source: 'ui',
      code: `command.${command.id}`,
      message,
      stack: error instanceof Error ? error.stack : undefined,
      context: { commandId: command.id, docId: ctx.store.getState().docId ?? undefined },
    });
  } catch {
    // the log is best effort
  }
  await ctx.dialogs.showMessage({
    text: message,
    caption: ctx.t('dialog.error.caption'),
    icon: 'error',
    testId: 'command-error',
  });
}

const isConnected = (ctx: CommandContext): boolean =>
  ctx.rpc !== null && ctx.store.getState().connection === 'connected';

const hasDocument = (ctx: CommandContext): boolean => ctx.store.getState().document !== null;

const connectedWithDocument = (ctx: CommandContext): boolean =>
  isConnected(ctx) && hasDocument(ctx);

/** Display name of the current document for prompts and the title bar. */
export function currentDocumentName(ctx: Pick<CommandContext, 'store' | 't'>): string {
  return documentFileName(ctx.store.getState()) ?? ctx.t('app.untitled');
}

/**
 * "Save changes to <name>?" flow used by New/Open/Exit. Resolves true when the caller may
 * proceed (saved or discarded), false when the user cancelled.
 */
export async function confirmDiscardChanges(ctx: CommandContext): Promise<boolean> {
  if (!ctx.store.getState().modified) return true;
  const answer = await ctx.dialogs.showMessage({
    text: ctx.t('msg.saveChanges', { name: currentDocumentName(ctx) }),
    caption: ctx.t('app.name'),
    buttons: 'yesNoCancel',
    icon: 'question',
    testId: 'save-changes-prompt',
  });
  if (answer === 'cancel') return false;
  if (answer === 'yes') return saveDocument(ctx, {});
  return true;
}

/** Switches the active view and commits an undo boundary (data-model.md §2.2, §4.2). */
export function switchView(ctx: Pick<CommandContext, 'store' | 'undo'>, view: ViewId): void {
  if (ctx.store.getState().activeView === view) return;
  actions.setActiveView(ctx.store, view);
  ctx.undo.boundary(view);
}

const ENCODING_CHOICES = [
  'utf-8',
  'utf-16',
  'windows-1251',
  'windows-1252',
  'iso-8859-1',
  'iso-8859-2',
  'iso-8859-5',
  'iso-8859-15',
  'koi8-r',
];

function fileFilters(ctx: CommandContext) {
  return documentFileTypes(ctx.t);
}

function loadDocument(ctx: CommandContext, document: Document): void {
  actions.setDocument(ctx.store, document);
  ctx.undo.clear();
  actions.setStatusMessage(ctx.store, null);
}

async function openDocument(ctx: CommandContext, path: string): Promise<void> {
  const rpc = ctx.rpc!;
  try {
    const result = await rpc.runJob(
      'doc.open',
      { path },
      { onProgress: (progress) => actions.setProgress(ctx.store, progress) },
    );
    loadDocument(ctx, result.document);
  } catch (error) {
    const reason = error instanceof RpcError ? error.message : String(error);
    await ctx.dialogs.showMessage({
      text: ctx.t('msg.openFailed', { path, reason }),
      caption: ctx.t('dialog.error.caption'),
      icon: 'error',
      testId: 'open-failed',
    });
  } finally {
    actions.setProgress(ctx.store, null);
  }
}

/**
 * Minimal Save / Save As flow (T052 replaces it with `features/file/fileCommands.ts`). Returns
 * true when the document was written.
 */
export async function saveDocument(
  ctx: CommandContext,
  options: { saveAs?: boolean },
): Promise<boolean> {
  const rpc = ctx.rpc;
  const state = ctx.store.getState();
  if (!rpc || !state.document || !state.docId) return false;

  let path = state.path ?? undefined;
  let encoding: string | undefined;
  if (options.saveAs || !path) {
    const choice = await rpc.call('dialog.saveFile', {
      title: ctx.t('cmd.file.saveAs.tooltip'),
      filters: fileFilters(ctx),
      // The document's own file, or the bare name composed from its description (feature 004
      // FR-050), as the full flow passes it.
      defaultPath:
        path ?? proposedFileName(state.document.description, ctx.t('app.untitled'), 'fb2'),
      encodingChoices: ENCODING_CHOICES,
    });
    if (!choice.path) return false;
    path = choice.path;
    encoding = choice.encoding;
  }

  let force = false;
  for (;;) {
    const result = await rpc.runJob(
      'doc.save',
      { docId: state.docId, document: ctx.store.getState().document!, path, encoding, force },
      { onProgress: (progress) => actions.setProgress(ctx.store, progress) },
    );
    actions.setProgress(ctx.store, null);
    if (result.needsConfirmation) {
      const answer = await ctx.dialogs.showMessage({
        text: ctx.t('msg.validationFailed', {
          errors: ctx.t('msg.errorsFound', { count: result.validation.errorCount }),
        }),
        caption: ctx.t('msg.validationFailedCaption'),
        buttons: 'yesNo',
        icon: 'warning',
        testId: 'validation-failed-prompt',
      });
      if (answer !== 'yes') return false;
      force = true;
      continue;
    }
    actions.markSaved(ctx.store, result.path);
    actions.setStatusMessage(
      ctx.store,
      result.validation.errorCount === 0
        ? ctx.t('status.savedNoErrors')
        : ctx.t('msg.errorsFound', { count: result.validation.errorCount }),
    );
    return true;
  }
}

interface CommandKeys {
  labelKey?: string;
  tooltipKey: string;
  descriptionKey: string;
}

function stub(id: string, group: CommandGroup, keys: CommandKeys, icon?: string): Command {
  return { id, group, ...keys, icon, stub: true, run: () => {} };
}

/** `cmd.<id>.tooltip` / `cmd.<id>.description` keys for a command id (plus the menu label key). */
function cmdKeys(id: string, labelKey?: string): CommandKeys {
  return { labelKey, tooltipKey: `cmd.${id}.tooltip`, descriptionKey: `cmd.${id}.description` };
}

/**
 * The keys of the table command `table.<name>` (feature 006, data-model §9.1): its label in
 * *Add → Table structure* and its short name and description in the feature's catalogue.
 */
function tableKeys(name: string): CommandKeys {
  return {
    labelKey: `menu.tableStructure.${name}`,
    tooltipKey: `tables.cmd.${name}.tooltip`,
    descriptionKey: `tables.cmd.${name}.description`,
  };
}

const NEVER_VISIBLE = (): boolean => false;

/** Icon pair of the AI assistant's toolbar button (`public/icons/toolbar24|16/ai-assistant.png`). */
export const AI_TOGGLE_ICON = 'ai-assistant';

/**
 * The inert stubs of the AI assistant's commands (feature 005, research R8.3, R8.5): registered
 * from the start so that the hotkey tables may name them (`Mod+Shift+A`, `Mod+K`) and the View
 * menu and the Commands toolbar may list `ai.toggle`, yet invisible and disabled, so nothing of
 * the feature shows before the first settings snapshot or with a core too old for it.
 * `ui/src/ai/index.ts` takes them over with `replace` once the first settings snapshot arrives:
 * `ai.toggle` is live in every mode from then on (it shows and hides the panel - FR-040 and
 * FR-096 as amended 2026-10-23), `ai.ask` only while a service is chosen, its stub coming back
 * when the mode becomes `disabled`.
 */
export function createAiStubCommands(): Command[] {
  return [
    {
      ...stub('ai.toggle', 'view', cmdKeys('ai.toggle', 'menu.view.aiAssistant'), AI_TOGGLE_ICON),
      visible: NEVER_VISIBLE,
    },
    { ...stub('ai.ask', 'tools', cmdKeys('ai.ask')), visible: NEVER_VISIBLE },
  ];
}

/* ------------------------------------------------------------------------ */
/* Built-in commands                                                        */
/* ------------------------------------------------------------------------ */

export function createBuiltinCommands(): Command[] {
  const commands: Command[] = [
    // ---- File -----------------------------------------------------------
    {
      id: 'file.new',
      group: 'file',
      ...cmdKeys('file.new', 'menu.file.new'),
      icon: 'id_file_new',
      enabled: isConnected,
      async run(ctx) {
        if (!(await confirmDiscardChanges(ctx))) return;
        const document = await ctx.rpc!.call('doc.new');
        loadDocument(ctx, document);
      },
    },
    {
      id: 'file.open',
      group: 'file',
      ...cmdKeys('file.open', 'menu.file.open'),
      icon: 'id_file_open',
      enabled: isConnected,
      async run(ctx) {
        if (!(await confirmDiscardChanges(ctx))) return;
        const { paths } = await ctx.rpc!.call('dialog.openFile', {
          title: ctx.t('cmd.file.open.tooltip'),
          filters: fileFilters(ctx),
        });
        if (paths.length > 0) await openDocument(ctx, paths[0]!);
      },
    },
    {
      id: 'file.save',
      group: 'file',
      ...cmdKeys('file.save', 'menu.file.save'),
      icon: 'id_file_save',
      enabled: connectedWithDocument,
      async run(ctx) {
        await saveDocument(ctx, {});
      },
    },
    {
      id: 'file.saveAs',
      group: 'file',
      ...cmdKeys('file.saveAs', 'menu.file.saveAs'),
      enabled: connectedWithDocument,
      async run(ctx) {
        await saveDocument(ctx, { saveAs: true });
      },
    },
    {
      id: 'file.validate',
      group: 'file',
      ...cmdKeys('file.validate', 'menu.file.validate'),
      icon: 'id_file_validate',
      enabled: connectedWithDocument,
      async run(ctx) {
        const state = ctx.store.getState();
        const report = await ctx.rpc!.runJob('doc.validate', {
          docId: state.docId!,
          document: state.document!,
        });
        actions.setStatusMessage(
          ctx.store,
          report.errorCount === 0
            ? ctx.t('status.noErrors')
            : ctx.t('msg.errorsFound', { count: report.errorCount }),
        );
      },
    },
    {
      id: 'file.exit',
      group: 'file',
      ...cmdKeys('file.exit', 'menu.file.exit'),
      duringScriptRun: 'allowed',
      async run(ctx) {
        if (!(await confirmDiscardChanges(ctx))) return;
        if (ctx.rpc && ctx.store.getState().connection === 'connected') {
          await ctx.rpc.call('app.quit', {});
        } else {
          window.close();
        }
      },
    },

    // ---- Edit -----------------------------------------------------------
    {
      id: 'edit.undo',
      group: 'edit',
      ...cmdKeys('edit.undo', 'menu.edit.undo'),
      icon: 'id_edit_undo',
      enabled: (ctx) => ctx.undo.canUndo,
      run(ctx) {
        ctx.undo.undo();
      },
    },
    {
      id: 'edit.redo',
      group: 'edit',
      ...cmdKeys('edit.redo', 'menu.edit.redo'),
      icon: 'id_edit_redo',
      enabled: (ctx) => ctx.undo.canRedo,
      run(ctx) {
        ctx.undo.redo();
      },
    },
    stub('edit.cut', 'edit', cmdKeys('edit.cut', 'menu.edit.cut'), 'id_edit_cut'),
    stub('edit.copy', 'edit', cmdKeys('edit.copy', 'menu.edit.copy'), 'id_edit_copy'),
    stub('edit.paste', 'edit', cmdKeys('edit.paste', 'menu.edit.paste'), 'id_edit_paste'),
    stub('edit.find', 'edit', cmdKeys('edit.find', 'menu.edit.find'), 'id_edit_find'),
    stub(
      'edit.findNext',
      'edit',
      cmdKeys('edit.findNext', 'menu.edit.findNext'),
      'id_edit_findnext',
    ),
    stub('edit.replace', 'edit', cmdKeys('edit.replace', 'menu.edit.replace'), 'id_edit_replace'),
    stub('edit.incrementalSearch', 'edit', cmdKeys('edit.incrementalSearch')),
    stub(
      'edit.gotoFootnote',
      'navigation',
      cmdKeys('edit.gotoFootnote', 'menu.edit.gotoFootnote'),
      'id_goto_footnote',
    ),
    stub('edit.gotoMatchTag', 'navigation', cmdKeys('edit.gotoMatchTag', 'menu.edit.gotoMatchTag')),
    stub('edit.gotoWrongTag', 'navigation', cmdKeys('edit.gotoWrongTag', 'menu.edit.gotoWrongTag')),
    stub('edit.clone', 'edit', cmdKeys('edit.clone', 'menu.edit.clone')),
    stub('edit.split', 'edit', cmdKeys('edit.split', 'menu.edit.split')),
    stub('edit.merge', 'edit', cmdKeys('edit.merge', 'menu.edit.merge')),
    stub('edit.removeOuter', 'edit', cmdKeys('edit.removeOuter', 'menu.edit.removeOuter')),
    {
      // Source view tag completion on demand (feature 003 US8, FR-072): hotkey only, no menu
      // entry; blocked while a script runs like every editing command. Available in the Source
      // view while Settings > View > "Tag completion" is on (FR-075).
      id: 'edit.completeTag',
      group: 'edit',
      ...cmdKeys('edit.completeTag'),
      enabled: (ctx) => {
        const state = ctx.store.getState();
        return (
          state.document !== null &&
          state.activeView === 'source' &&
          state.settings?.view?.sourceTagCompletion !== false
        );
      },
      run(ctx) {
        startSourceTagCompletion(ctx.store);
      },
    },

    // ---- View -----------------------------------------------------------
    toggleToolbar('view.toolbarCommands', 'menu.view.toolbarCommands', 'commands'),
    toggleToolbar('view.toolbarScripts', 'menu.view.toolbarScripts', 'scripts'),
    toggleToolbar('view.linksBar', 'menu.view.linksBar', 'links'),
    toggleToolbar('view.tableBar', 'menu.view.tableBar', 'table'),
    toggleToolbar('view.statusBar', 'menu.view.statusBar', 'status'),
    {
      id: 'view.tree',
      group: 'view',
      ...cmdKeys('view.tree', 'menu.view.tree'),
      checked: (ctx) => ctx.store.getState().treeVisible,
      run(ctx) {
        actions.toggleTree(ctx.store);
      },
    },
    viewCommand('description', 'id_view_desc'),
    viewCommand('body', 'id_view_body'),
    viewCommand('source', 'id_view_source'),
    {
      id: 'view.fastMode',
      group: 'view',
      ...cmdKeys('view.fastMode', 'menu.view.fastMode'),
      checked: (ctx) => ctx.store.getState().fastMode,
      run: (ctx) => toggleFastMode(ctx), // reduced-fidelity Body rendering, persisted (T154)
    },
    // The AI assistant's `ai.toggle` (View) and `ai.ask` (Tools): inert and invisible until
    // ui/src/ai/index.ts takes them over (feature 005).
    ...createAiStubCommands(),

    // ---- Add (insert.*) -------------------------------------------------
    stub('insert.body', 'edit', cmdKeys('insert.body', 'menu.add.body'), 'id_edit_add_body'),
    stub('insert.title', 'edit', cmdKeys('insert.title', 'menu.add.title'), 'id_edit_add_title'),
    stub(
      'insert.epigraph',
      'edit',
      cmdKeys('insert.epigraph', 'menu.add.epigraph'),
      'id_edit_add_epigraph',
    ),
    stub(
      'insert.annotation',
      'edit',
      cmdKeys('insert.annotation', 'menu.add.annotation'),
      'id_edit_add_ann',
    ),
    stub('insert.textAuthor', 'edit', cmdKeys('insert.textAuthor', 'menu.add.textAuthor')),
    stub('insert.image', 'edit', cmdKeys('insert.image', 'menu.add.image'), 'id_edit_ins_image'),
    stub(
      'insert.inlineImage',
      'edit',
      cmdKeys('insert.inlineImage', 'menu.add.inlineImage'),
      'id_edit_ins_inlineimage',
    ),
    stub('insert.poem', 'edit', cmdKeys('insert.poem', 'menu.add.poem'), 'id_edit_ins_poem'),
    stub('insert.cite', 'edit', cmdKeys('insert.cite', 'menu.add.cite'), 'id_edit_ins_cite'),
    // The project's own 24 px icon (feature 006, C27): the original's exists at 16 px only.
    stub('insert.table', 'edit', cmdKeys('insert.table', 'menu.add.table'), 'table-insert'),
    stub(
      'insert.sectionImage',
      'edit',
      cmdKeys('insert.sectionImage', 'menu.add.sectionImage'),
      'id_edit_add_image',
    ),
    stub('insert.binary', 'edit', cmdKeys('insert.binary', 'menu.add.binary'), 'id_edit_addbinary'),

    // ---- Table (table.*, feature 006) -----------------------------------
    // The 24 table commands in the order of FR-039 (data-model §9.1): disabled stubs, so the
    // menus, Customize and the Hotkeys page list them, until the tables feature replaces each
    // (`registerTablesFeature`); their chords run only inside the active table edit target
    // (`hotkeyScope`, C6), and none has a default chord (decision 15).
    {
      ...stub(
        'table.insertRowAbove',
        'table',
        tableKeys('insertRowAbove'),
        'table-insert-row-above',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.insertRowBelow',
        'table',
        tableKeys('insertRowBelow'),
        'table-insert-row-below',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub('table.deleteRow', 'table', tableKeys('deleteRow'), 'table-delete-row'),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.insertColumnLeft',
        'table',
        tableKeys('insertColumnLeft'),
        'table-insert-column-left',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.insertColumnRight',
        'table',
        tableKeys('insertColumnRight'),
        'table-insert-column-right',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub('table.deleteColumn', 'table', tableKeys('deleteColumn'), 'table-delete-column'),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub('table.mergeCells', 'table', tableKeys('mergeCells'), 'table-merge-cells'),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub('table.splitCell', 'table', tableKeys('splitCell'), 'table-split-cell'),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.toggleHeaderCell',
        'table',
        tableKeys('toggleHeaderCell'),
        'table-toggle-header-cell',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.makeHeaderCells',
        'table',
        tableKeys('makeHeaderCells'),
        'table-make-header-cells',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.makeNormalCells',
        'table',
        tableKeys('makeNormalCells'),
        'table-make-normal-cells',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.toggleHeaderRow',
        'table',
        tableKeys('toggleHeaderRow'),
        'table-toggle-header-row',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.toggleHeaderColumn',
        'table',
        tableKeys('toggleHeaderColumn'),
        'table-toggle-header-column',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub('table.repair', 'table', tableKeys('repair'), 'table-repair'),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub('table.select', 'table', tableKeys('select'), 'table-select'),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub('table.delete', 'table', tableKeys('delete'), 'table-delete'),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub('table.moveRowUp', 'table', tableKeys('moveRowUp'), 'table-move-row-up'),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub('table.moveRowDown', 'table', tableKeys('moveRowDown'), 'table-move-row-down'),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.moveColumnLeft',
        'table',
        tableKeys('moveColumnLeft'),
        'table-move-column-left',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.moveColumnRight',
        'table',
        tableKeys('moveColumnRight'),
        'table-move-column-right',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub('table.duplicateRow', 'table', tableKeys('duplicateRow'), 'table-duplicate-row'),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.duplicateColumn',
        'table',
        tableKeys('duplicateColumn'),
        'table-duplicate-column',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.paragraphBefore',
        'table',
        tableKeys('paragraphBefore'),
        'table-paragraph-before',
      ),
      hotkeyScope: 'tableTarget',
    },
    {
      ...stub(
        'table.paragraphAfter',
        'table',
        tableKeys('paragraphAfter'),
        'table-paragraph-after',
      ),
      hotkeyScope: 'tableTarget',
    },

    // ---- Style ----------------------------------------------------------
    stub('style.normal', 'style', cmdKeys('style.normal', 'menu.style.normal'), 'id_style_normal'),
    stub(
      'style.textAuthor',
      'style',
      cmdKeys('style.textAuthor', 'menu.style.textAuthor'),
      'id_style_textauthor',
    ),
    stub(
      'style.subtitle',
      'style',
      cmdKeys('style.subtitle', 'menu.style.subtitle'),
      'id_style_subtitle',
    ),
    stub('style.link', 'style', cmdKeys('style.link', 'menu.style.link'), 'id_style_link'),
    stub(
      'style.footnote',
      'style',
      cmdKeys('style.footnote', 'menu.style.footnote'),
      'id_style_note',
    ),
    stub(
      'style.removeLink',
      'style',
      cmdKeys('style.removeLink', 'menu.style.removeLink'),
      'id_style_nolink',
    ),
    stub('style.strong', 'edit', cmdKeys('style.strong'), 'id_edit_bold'),
    stub('style.emphasis', 'edit', cmdKeys('style.emphasis'), 'id_edit_italic'),
    stub('style.strikethrough', 'edit', cmdKeys('style.strikethrough'), 'id_edit_strik'),
    stub('style.sub', 'edit', cmdKeys('style.sub'), 'id_edit_sub'),
    stub('style.sup', 'edit', cmdKeys('style.sup'), 'id_edit_sup'),
    stub('style.code', 'edit', cmdKeys('style.code'), 'id_edit_code'),

    // ---- Tools ----------------------------------------------------------
    stub('tools.words', 'tools', cmdKeys('tools.words', 'menu.tools.words')),
    stub(
      'tools.settings',
      'tools',
      cmdKeys('tools.settings', 'menu.tools.settings'),
      'id_view_options',
    ),
    stub(
      'tools.spellcheck',
      'tools',
      cmdKeys('tools.spellcheck', 'menu.tools.spellcheck'),
      'id_tools_spellcheck',
    ),
    stub('tools.spellHighlight', 'tools', cmdKeys('tools.spellHighlight')),

    // ---- Scripts --------------------------------------------------------
    stub('scripts.last', 'scripts', cmdKeys('scripts.last', 'menu.scripts.last'), 'id_last_script'),

    // ---- Help -----------------------------------------------------------
    {
      id: 'help.about',
      group: 'help',
      ...cmdKeys('help.about', 'menu.help.about'),
      duringScriptRun: 'allowed',
      async run(ctx) {
        await ctx.dialogs.showMessage({
          text: `${ctx.t('app.name')}\n${ctx.t('dialog.about.version', { version: ctx.version })}`,
          caption: ctx.t('dialog.about.caption'),
          icon: 'info',
          testId: 'about',
        });
      },
    },

    // ---- Navigation (hotkey-only in the original) -------------------------
    stub('nav.nextItem', 'navigation', cmdKeys('nav.nextItem')),
    stub('nav.selectHref', 'navigation', cmdKeys('nav.selectHref')),
    stub('nav.selectId', 'navigation', cmdKeys('nav.selectId')),
    stub('nav.selectTableId', 'navigation', cmdKeys('nav.selectTableId')),
    stub('nav.selectText', 'navigation', cmdKeys('nav.selectText')),
    stub('nav.selectTree', 'navigation', cmdKeys('nav.selectTree')),
  ];

  // Source folding levels 1-9 (T079 implements them).
  for (let level = 1; level <= 9; level += 1) {
    commands.push({
      ...stub(`source.collapse${level}`, 'navigation', cmdKeys('source.collapse')),
      labelParams: { count: level },
    });
    commands.push({
      ...stub(`source.expand${level}`, 'navigation', cmdKeys('source.expand')),
      labelParams: { count: level },
    });
  }
  return commands;
}

function toggleToolbar(
  id: string,
  labelKey: string,
  name: 'commands' | 'scripts' | 'links' | 'table' | 'status',
): Command {
  return {
    id,
    group: 'view',
    ...cmdKeys(id, labelKey),
    checked: (ctx) => ctx.store.getState().toolbars[name],
    run(ctx) {
      actions.toggleToolbar(ctx.store, name);
    },
  };
}

function viewCommand(view: ViewId, icon: string): Command {
  return {
    id: `view.${view}`,
    group: 'view',
    ...cmdKeys(`view.${view}`, `menu.view.${view}`),
    icon,
    checked: (ctx) => ctx.store.getState().activeView === view,
    // Source-only documents (malformed XML) stay in the Source view until repaired (FR-021).
    enabled: (ctx) => view === 'source' || !ctx.store.getState().sourceOnly,
    run(ctx) {
      switchView(ctx, view);
    },
  };
}

export function createCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  for (const command of createBuiltinCommands()) registry.register(command);
  return registry;
}
