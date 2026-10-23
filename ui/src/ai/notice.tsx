/**
 * The first-use notice of the AI assistant (feature 005 FR-021, FR-008; research R8.10, R9.3;
 * data-model §2.3; review B4, C14): before the first request to a *hosted* service - the
 * settings page's Test connection (US1), the custom page's Fetch models / Test (US8) and every
 * request of the assistant (US2) - the user is told which service it is (name and host), what
 * leaves the computer (the instruction, the conversation of the session, the book's title and
 * its chapter titles, the parts of the book the assistant reads, the editor's name and version
 * - and nothing else: no authors, no genres), where its terms or privacy page is (opened
 * through `app.openUrl`, never as a navigation), and - for a plain `http` address - that the
 * text travels unencrypted. *Yes* records `{service, host, at}` in `ai.agreements` at once
 * (`saveAgreements`, not the debounced session save) and resolves true; *No* (the button,
 * Escape, the close box) writes nothing and resolves false - the caller sends nothing then.
 *
 * Part of the lazy `ai-assistant` chunk (vite.config.ts): the settings page imports this
 * module only when a notice is due - a user action - so that nothing of the chunk is requested
 * while the assistant is off or disabled (SC-013).
 */

import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import { ExternalLink } from '@/dialogs/ExternalLink';
import { isOpenableUrl } from '@/dialogs/externalUrl';
import type { RpcClient } from '@/rpc/client';

import { hostOf, needsUnencryptedWarning } from './address';
import {
  agreementDue,
  saveAgreements,
  settingsWithAgreement,
  type AgreementSubject,
} from './agreements';

/** What the notice is about: the agreement subject plus what the dialog shows of it. */
export type NoticeTarget = AgreementSubject & {
  /** The service's display name (a free entry's `name`; the host for the custom target). */
  name: string;
  /** The entry's terms or privacy page, when it has one. */
  termsUrl?: string;
};

export interface RequireAgreementOptions {
  /**
   * Show the notice although an agreement is recorded (the core's gate answered 1200
   * `noAgreement`: the stored agreement and the core disagree, the user decides again).
   */
  force?: boolean;
}

export function AiNoticeDialog({
  target,
  rpc,
  onClose,
}: {
  target: NoticeTarget;
  rpc: RpcClient | null;
  onClose: (agreed: boolean) => void;
}) {
  const { t } = useTranslation();
  const host = hostOf(target.address);
  const buttons: DialogButton[] = [
    { id: 'yes', label: t('dialog.buttons.yes'), onClick: () => onClose(true) },
    { id: 'no', label: t('dialog.buttons.no'), onClick: () => onClose(false) },
  ];
  const items = ['instruction', 'conversation', 'outline', 'parts', 'editor'] as const;
  return (
    <Dialog
      title={t('ai.notice.title')}
      buttons={buttons}
      defaultButtonId="yes"
      cancelButtonId="no"
      testId="dialog-ai-notice"
      className="mfbe-ai-notice"
      closeLabel={t('dialog.buttons.close')}
    >
      <p data-testid="dialog-ai-notice-service">
        {t('ai.notice.service', { name: target.name, host })}
      </p>
      <div data-testid="dialog-ai-notice-sent">
        <p>{t('ai.notice.sentIntro')}</p>
        <ul>
          {items.map((item) => (
            <li key={item}>{t(`ai.notice.sent.${item}`)}</li>
          ))}
        </ul>
      </div>
      {target.termsUrl && isOpenableUrl(target.termsUrl) ? (
        <p>
          <ExternalLink url={target.termsUrl} rpc={rpc} testId="dialog-ai-notice-terms">
            {t('ai.notice.terms')}
          </ExternalLink>
        </p>
      ) : null}
      {needsUnencryptedWarning(target.address) ? (
        <p className="mfbe-ai-notice-warning" data-testid="dialog-ai-notice-unencrypted">
          {t('ai.notice.unencrypted')}
        </p>
      ) : null}
      <p>{t('ai.notice.question')}</p>
    </Dialog>
  );
}

/** Opens the notice for `target`; resolves with the user's answer, nothing written. */
// eslint-disable-next-line react-refresh/only-export-components -- the gate lives with its dialog in the lazy chunk
export function showNotice(ctx: CommandContext, target: NoticeTarget): Promise<boolean> {
  return ctx.dialogs.openCustom<boolean>((close) => (
    <AiNoticeDialog target={target} rpc={ctx.rpc} onClose={close} />
  ));
}

/**
 * The gate every hosted exchange passes first (FR-005, FR-021): true at once when no notice is
 * due (a local address, or an agreement for this service **and** this host exists), else the
 * notice - *Yes* records the agreement immediately and resolves true, *No* resolves false and
 * the caller contacts nothing. `force` shows it regardless (a 1200 `noAgreement` answer).
 */
// eslint-disable-next-line react-refresh/only-export-components -- the gate lives with its dialog in the lazy chunk
export async function requireAgreement(
  ctx: CommandContext,
  target: NoticeTarget,
  options: RequireAgreementOptions = {},
): Promise<boolean> {
  if (!options.force && !agreementDue(target, ctx.store.getState().settings)) return true;
  const agreed = await showNotice(ctx, target);
  if (!agreed) return false;
  // The whole array from the latest snapshot, written now (data-model §2.3).
  const agreements = settingsWithAgreement(ctx.store.getState().settings, target);
  await saveAgreements(ctx.store, ctx.rpc, agreements);
  return true;
}
