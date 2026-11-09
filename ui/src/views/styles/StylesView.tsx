/**
 * Feature 011 (US8; D42 and its clarifications; FR-020a-FR-020e, FR-020h, FR-020j; research DP-13 to
 * DP-16): the Styles view, the fourth view after Source - the book's stylesheets as groups of rules,
 * the selected rule's declarations in a CSS editor with completion, and *Add selector*, *Rename*,
 * *Remove*, *New stylesheet*. Selectors that match nothing in an FB2 book and declarations that are
 * not standard CSS are refused with their reason; a conflict between two stylesheets is marked on
 * both (the core's `styles.check`, as in Validate). Each change is one undo step of the view and is
 * written by Save. Loaded lazily with css-tree and the CSS editor (PD2, PD3).
 */
import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { formatChordForDisplay, parseChord } from '@/app/hotkeys';
import { useAppServices, useCommandContext } from '@/app/services';
import { tip } from '@/app/tooltips';
import {
  classUses,
  commitDocument,
  renameClassUses,
  setStylesheets,
} from '@/features/styles/apply';
import {
  canonicalDeclarations,
  checkDeclarations,
  type DeclarationIssue,
} from '@/features/styles/declarations';
import { checkSelector, classesOf } from '@/features/styles/selectors';
import {
  defaultGroup,
  readStylesheets,
  writeStylesheet,
  type StyleGroup,
  type StyleRule,
} from '@/features/styles/stylesheetModel';
import { useAppState } from '@/model/store';
import type { Stylesheet } from '@/model/document';
import type { ValidationIssue } from '@/rpc/types';

import { createDeclarationEditor, type DeclarationEditor } from './DeclarationEditor';
import { StylesheetGroups, type StyleSelection } from './StylesheetGroups';

import './styles.css';

import { AddStyleDialog } from './AddStyleDialog';

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** A rule's declarations as the editor shows them (one per line, without the indentation). */
const editorText = (rule: StyleRule | null) => rule?.declarations.replace(/^ {2}/gm, '') ?? '';

/** The core's normalisation of a selector (css_rules.cpp), to match conflicts to rules. */
function normalizeSelector(selector: string): string {
  return collapse(selector).replace(/\s*([>+~,])\s*/g, '$1');
}

export default function StylesView() {
  const { t } = useTranslation();
  const { store, rpc } = useAppServices();
  const ctx = useCommandContext();
  const document = useAppState((s) => s.document, store);
  const docId = useAppState((s) => s.docId, store);
  const stylesheets = document?.stylesheets;
  const groups = useMemo(() => readStylesheets(stylesheets ?? []), [stylesheets]);
  const fallback = defaultGroup(groups);
  const [chosen, setSelection] = useState<StyleSelection | null>(null);
  const [edited, setEdited] = useState<{ rule: StyleRule; text: string } | null>(null);
  const [conflictIssues, setConflictIssues] = useState<ValidationIssue[]>([]);
  const editorParent = useRef<HTMLDivElement>(null);
  const editor = useRef<DeclarationEditor | null>(null);
  const focusEditorNext = useRef(false);
  // Apply's keys as this platform names them (Ctrl+Enter, Cmd+Enter on macOS).
  const applyKeys = useMemo(() => {
    const platform = ctx.hotkeys.platform;
    const chord = parseChord('Mod+Enter', platform);
    return chord ? formatChordForDisplay(chord, platform) : 'Ctrl+Enter';
  }, [ctx.hotkeys]);

  // The selection stays on its rule while the stylesheets change (an edit, an undo); a rule that
  // is gone leaves its group selected.
  const selection = useMemo((): StyleSelection | null => {
    if (!chosen) return null;
    const group = groups[chosen.group];
    if (!group) return null;
    if (chosen.rule !== null && !group.rules[chosen.rule])
      return { group: chosen.group, rule: null };
    return chosen;
  }, [chosen, groups]);
  const selectedGroup: StyleGroup | null =
    selection !== null ? (groups[selection.group] ?? null) : null;
  const selectedRule =
    selectedGroup && selection?.rule !== null && selection?.rule !== undefined
      ? (selectedGroup.rules[selection.rule] ?? null)
      : null;
  // What the editor holds: the user's text for this rule, else the rule's own declarations.
  const draft = edited && edited.rule === selectedRule ? edited.text : editorText(selectedRule);
  const issues: DeclarationIssue[] = useMemo(
    () => (selectedRule ? checkDeclarations(draft).issues : []),
    [draft, selectedRule],
  );

  // The core judges conflicts between stylesheets (one source with Validate).
  useEffect(() => {
    if (!rpc || !docId || !stylesheets) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void rpc
        .call('styles.check', {
          docId,
          stylesheets: stylesheets.map((sheet) => ({ type: sheet.type, text: sheet.content })),
        })
        .then((result) => {
          if (live) setConflictIssues(result.issues);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [rpc, docId, stylesheets]);

  const conflicts = useMemo(() => {
    const marks = new Map<string, string[]>();
    for (const issue of conflictIssues) {
      if (issue.code !== 'style.conflict') continue;
      const params = issue.params as { selector?: string; sheets?: number[] };
      for (const group of groups) {
        if (!params.sheets?.includes(group.index + 1)) continue;
        group.rules.forEach((rule, index) => {
          if (normalizeSelector(rule.selector) !== params.selector) return;
          const key = `${group.index}:${index}`;
          const text = t('validation.style.conflict', issue.params as Record<string, unknown>);
          marks.set(key, [...(marks.get(key) ?? []), text]);
        });
      }
    }
    return marks;
  }, [conflictIssues, groups, t]);

  const replaceGroup = useCallback(
    (sheets: Stylesheet[], index: number, group: Pick<StyleGroup, 'rules' | 'atrules'>) => {
      const next = [...sheets];
      next[index] = { ...next[index]!, content: writeStylesheet(group) };
      return next;
    },
    [],
  );

  /** Writes the editor's declarations into the selected rule (one undo step). */
  const apply = useCallback((): boolean => {
    if (!document || !selectedGroup?.editable || !selectedRule || selection?.rule == null)
      return false;
    const check = checkDeclarations(draft);
    if (check.issues.length > 0) return false;
    const declarations = canonicalDeclarations(check.declarations);
    if (declarations === selectedRule.declarations) return true;
    const rules = selectedGroup.rules.map((rule, index) =>
      index === selection.rule ? { ...rule, declarations } : rule,
    );
    return setStylesheets(
      ctx,
      replaceGroup(document.stylesheets, selectedGroup.index, {
        rules,
        atrules: selectedGroup.atrules,
      }),
      t('styles.undo.edit', { selector: selectedRule.selector }),
    );
  }, [ctx, document, draft, replaceGroup, selectedGroup, selectedRule, selection, t]);
  const applyRef = useRef(apply);
  useLayoutEffect(() => {
    applyRef.current = apply;
  });

  // The CSS editor follows the selected rule.
  useEffect(() => {
    const parent = editorParent.current;
    if (!parent || !selectedRule) return;
    const rule = selectedRule;
    const created = createDeclarationEditor(parent, editorText(rule), {
      onChange: (text) => setEdited({ rule, text }),
      onApply: () => void applyRef.current(),
      label: t('styles.declarations', { selector: selectedRule.selector }),
      hint: t('styles.editorHint', { selector: selectedRule.selector, keys: applyKeys }),
    });
    editor.current = created;
    // A rule just added (or chosen again) by *Add selector…* takes the caret at once.
    if (focusEditorNext.current) {
      focusEditorNext.current = false;
      created.focus();
    }
    return () => {
      created.destroy();
      editor.current = null;
    };
  }, [selectedRule, t, applyKeys]);

  const selectorReason = (value: string): string | null => {
    const check = checkSelector(value);
    if (check.ok) return null;
    return check.reason === 'matchesNothing'
      ? t('styles.reason.matchesNothing', { detail: check.detail })
      : t('styles.reason.syntax');
  };

  const select = (next: StyleSelection) => {
    // Leaving a rule writes what the editor holds when it is valid.
    if (selectedRule && draft !== editorText(selectedRule)) apply();
    setSelection(next);
  };

  const addSelector = async () => {
    if (!document) return;
    // Feature 011 (rc.2 review): a style of an element, or a named style typed by its name alone.
    const chosenSelector = await ctx.dialogs.openCustom<string | null>((close) =>
      createElement(AddStyleDialog, { reasonOf: selectorReason, onClose: close }),
    );
    if (!chosenSelector) return;
    const selector = collapse(chosenSelector);
    const chosen = selectedGroup?.editable ? selectedGroup : fallback;
    let sheets = [...document.stylesheets];
    let index: number;
    let rules = chosen?.rules ?? [];
    const atrules = chosen?.atrules ?? [];
    if (chosen) index = chosen.index;
    else {
      // The book's first CSS stylesheet, made for its first selector (D42).
      sheets = [...sheets, { type: 'text/css', content: '' }];
      index = sheets.length - 1;
    }
    const existing = rules.findIndex(
      (rule) => normalizeSelector(rule.selector) === normalizeSelector(selector),
    );
    if (existing >= 0) {
      if (selection?.group === index && selection.rule === existing) editor.current?.focus();
      else focusEditorNext.current = true;
      setSelection({ group: index, rule: existing });
      return;
    }
    focusEditorNext.current = true;
    rules = [...rules, { selector, declarations: '' }];
    if (
      setStylesheets(
        ctx,
        replaceGroup(sheets, index, { rules, atrules }),
        t('styles.undo.add', { selector }),
      )
    ) {
      setSelection({ group: index, rule: rules.length - 1 });
    }
  };

  const rename = async () => {
    if (!document || !selectedGroup?.editable || !selectedRule || selection?.rule == null) return;
    const result = await ctx.dialogs.showInput({
      caption: t('styles.renameCaption'),
      prompt: t('styles.selectorPrompt'),
      defaultValue: selectedRule.selector,
      validate: selectorReason,
      buttons: 'okCancel',
      testId: 'dialog-styles-rename',
    });
    if (result.button !== 'ok') return;
    const selector = collapse(result.value);
    if (selector === selectedRule.selector) return;
    let book = document;
    const before = classesOf(selectedRule.selector);
    const after = classesOf(selector);
    const removed = before.filter((name) => !after.includes(name));
    const added = after.filter((name) => !before.includes(name));
    if (removed.length === 1 && added.length === 1) {
      const uses = classUses(document, removed[0]!);
      if (uses > 0) {
        const answer = await ctx.dialogs.showMessage({
          text: t('styles.renameUses', { count: uses, name: removed[0] }),
          buttons: 'okCancel',
          labels: { ok: t('styles.renameUsesOk') },
          icon: 'question',
          testId: 'dialog-styles-rename-uses',
        });
        if (answer !== 'ok') return;
        book = renameClassUses(document, removed[0]!, added[0]!);
      }
    }
    const rules = selectedGroup.rules.map((rule, index) =>
      index === selection.rule ? { ...rule, selector } : rule,
    );
    commitDocument(
      ctx,
      {
        ...book,
        stylesheets: replaceGroup(document.stylesheets, selectedGroup.index, {
          rules,
          atrules: selectedGroup.atrules,
        }),
      },
      t('styles.undo.rename', { selector }),
    );
  };

  const remove = () => {
    if (!document || !selectedGroup?.editable || !selectedRule || selection?.rule == null) return;
    const rules = selectedGroup.rules.filter((_, index) => index !== selection.rule);
    setStylesheets(
      ctx,
      replaceGroup(document.stylesheets, selectedGroup.index, {
        rules,
        atrules: selectedGroup.atrules,
      }),
      t('styles.undo.remove', { selector: selectedRule.selector }),
    );
    setSelection({ group: selectedGroup.index, rule: null });
  };

  const newStylesheet = () => {
    if (!document) return;
    if (
      setStylesheets(
        ctx,
        [...document.stylesheets, { type: 'text/css', content: '' }],
        t('styles.undo.newStylesheet'),
      )
    ) {
      setSelection({ group: document.stylesheets.length, rule: null });
    }
  };

  if (!document) {
    return (
      <div
        className="mfbe-styles-view mfbe-view-placeholder"
        data-testid="styles-view"
        id="panel-styles"
      >
        {t('styles.noDocument')}
      </div>
    );
  }

  const ruleSelected = !!selectedRule && !!selectedGroup?.editable;
  const issueText = (issue: DeclarationIssue) =>
    t(`styles.issue.${issue.reason}`, { property: issue.property, detail: issue.detail ?? '' });

  return (
    <div className="mfbe-styles-view" data-testid="styles-view" id="panel-styles">
      <div className="mfbe-styles-toolbar" role="toolbar" aria-label={t('styles.toolbar')}>
        <button
          type="button"
          data-testid="styles-add"
          onClick={() => void addSelector()}
          {...tip(t('styles.addTip'))}
        >
          {t('styles.add')}
        </button>
        <button
          type="button"
          data-testid="styles-rename"
          disabled={!ruleSelected}
          onClick={() => void rename()}
          {...tip(ruleSelected ? t('styles.renameTip') : t('styles.needsRule'))}
        >
          {t('styles.rename')}
        </button>
        <button
          type="button"
          data-testid="styles-remove"
          disabled={!ruleSelected}
          onClick={remove}
          {...tip(ruleSelected ? t('styles.removeTip') : t('styles.needsRule'))}
        >
          {t('styles.remove')}
        </button>
        <button
          type="button"
          data-testid="styles-new"
          onClick={newStylesheet}
          {...tip(t('styles.newTip'))}
        >
          {t('styles.newStylesheet')}
        </button>
      </div>
      <div className="mfbe-styles-main">
        <StylesheetGroups
          groups={groups}
          defaultIndex={fallback?.index ?? null}
          selection={selection}
          conflicts={conflicts}
          onSelect={select}
        />
        <div className="mfbe-styles-editor-pane" data-testid="styles-editor-pane">
          {ruleSelected ? (
            <>
              <div className="mfbe-styles-editor-caption">
                <span>{t('styles.declarationsLabel')}</span>
                <code data-testid="styles-selected-selector">{selectedRule!.selector}</code>
              </div>
              <div ref={editorParent} className="mfbe-styles-editor" data-testid="styles-editor" />
              {issues.length > 0 ? (
                <ul className="mfbe-styles-issues" data-testid="styles-issues">
                  {issues.map((issue, index) => (
                    <li key={index}>{issueText(issue)}</li>
                  ))}
                </ul>
              ) : null}
              <div className="mfbe-styles-editor-actions">
                <button
                  type="button"
                  data-testid="styles-apply"
                  disabled={issues.length > 0}
                  onClick={() => void apply()}
                  {...tip(
                    issues.length > 0
                      ? t('styles.applyRefused')
                      : t('styles.applyTip', { keys: applyKeys }),
                  )}
                >
                  {t('styles.apply')}
                </button>
              </div>
            </>
          ) : (
            <p className="mfbe-styles-hint" data-testid="styles-hint">
              {t('styles.hint')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
