/**
 * Spell session state (T088/T089, data-model.md §2.4): the dictionaries in use (document
 * language by default, user override), the words ignored for the session ("Ignore All" of
 * the dialog and the context menu), the "Change All" replacements, and the last dialog action
 * that "Undo last" reverts. Reset when another document is opened (the original cleared its
 * ignore/replace lists in `CSpeller::AttachDocument`).
 */

export type LastSpellAction =
  | { kind: 'change'; word: string; replacement: string; blockId: string; offset: number }
  | { kind: 'changeAll'; word: string; replacement: string; blockId: string; offset: number }
  | { kind: 'add'; word: string; blockId: string; offset: number };

export class SpellSession {
  private readonly ignoredAllWords = new Set<string>();
  private readonly changedAllWords = new Map<string, string>();
  private override: string[] | null = null;
  private readonly listeners = new Set<() => void>();
  /** Last Change / Change All / Add of the dialog (cleared by Undo last and on reset). */
  lastAction: LastSpellAction | null = null;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /* ------------------------------------------------------------ languages */

  /** Dictionaries chosen by the user for this session, or null = follow the document. */
  get languageOverride(): readonly string[] | null {
    return this.override;
  }

  setLanguageOverride(langs: readonly string[] | null): void {
    const next = langs ? [...langs] : null;
    const same =
      (next === null && this.override === null) ||
      (next !== null &&
        this.override !== null &&
        next.length === this.override.length &&
        next.every((lang, i) => lang === this.override![i]));
    if (same) return;
    this.override = next;
    this.emit();
  }

  /* ---------------------------------------------------------- ignore lists */

  isIgnored(check: string): boolean {
    return this.ignoredAllWords.has(check);
  }

  ignoreAll(check: string): void {
    if (this.ignoredAllWords.has(check)) return;
    this.ignoredAllWords.add(check);
    this.emit();
  }

  get ignoredAll(): ReadonlySet<string> {
    return this.ignoredAllWords;
  }

  /* ----------------------------------------------------------- change all */

  replacementFor(check: string): string | undefined {
    return this.changedAllWords.get(check);
  }

  changeAll(check: string, replacement: string): void {
    this.changedAllWords.set(check, replacement);
    this.emit();
  }

  forgetChangeAll(check: string): void {
    if (this.changedAllWords.delete(check)) this.emit();
  }

  get changedAll(): ReadonlyMap<string, string> {
    return this.changedAllWords;
  }

  /* ---------------------------------------------------------------- reset */

  /** Another document: session lists and the override are forgotten. */
  reset(): void {
    this.ignoredAllWords.clear();
    this.changedAllWords.clear();
    this.override = null;
    this.lastAction = null;
    this.emit();
  }
}
