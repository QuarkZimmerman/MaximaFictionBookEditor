/**
 * Description | Body | Source switcher (the original frame's view tabs). Each tab runs the
 * corresponding `view.*` command so the Source-view rules (parse before leaving) apply.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ViewId } from '@/rpc/types';

import { useAppRevision, useAppServices, useCommandContext } from './services';

const VIEWS: readonly ViewId[] = ['description', 'body', 'source'];

export function ViewSwitcher() {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  useAppRevision();

  // Keyboard (T153, ARIA tabs): Left/Right/Home/End move to the neighbouring enabled tab and
  // switch to it (the view commands keep the Source-view "parse before leaving" rule).
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, view: ViewId) => {
    const delta =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : (0 as 0 | 1 | -1);
    if (delta === 0 && event.key !== 'Home' && event.key !== 'End') return;
    const enabled = VIEWS.filter((candidate) =>
      services.commands.isEnabled(`view.${candidate}`, ctx),
    );
    if (enabled.length === 0) return;
    event.preventDefault();
    const current = enabled.indexOf(view);
    const next =
      event.key === 'Home'
        ? enabled[0]!
        : event.key === 'End'
          ? enabled[enabled.length - 1]!
          : enabled[(current + delta + enabled.length) % enabled.length]!;
    if (next === view) return;
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-testid="view-${next}"]`)
      ?.focus();
    void services.commands.execute(`view.${next}`, ctx);
  };

  return (
    <div
      className="mfbe-view-switcher"
      role="tablist"
      aria-label={t('views.switcher')}
      data-testid="view-switcher"
    >
      {VIEWS.map((view) => {
        const id = `view.${view}`;
        const active = services.commands.isChecked(id, ctx);
        const enabled = services.commands.isEnabled(id, ctx);
        return (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`panel-${view}`}
            className={`mfbe-view-tab${active ? ' mfbe-view-tab-active' : ''}`}
            data-testid={`view-${view}`}
            disabled={!enabled}
            onClick={() => void services.commands.execute(id, ctx)}
            onKeyDown={(event) => onKeyDown(event, view)}
          >
            {t(`views.${view}.title`)}
          </button>
        );
      })}
    </div>
  );
}
