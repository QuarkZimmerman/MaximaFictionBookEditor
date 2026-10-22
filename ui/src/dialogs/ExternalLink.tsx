/**
 * A link to a web page opened through the core's `app.openUrl` (feature 005 T018/T037;
 * rpc-api §3.1): the one mechanism behind every terms and privacy link of the AI assistant -
 * the settings page and the first-use notice. The element is a real `<a href>` (the journeys
 * assert the `href`, screen readers announce a link) whose click - and Enter while focused -
 * calls `app.openUrl({url})` and prevents the default navigation; never `target="_blank"` and
 * never the shell's popup path. A URL that is not `http(s)` is shown as text, never as a link
 * (`javascript:`, `file:` and the like stay inert).
 */

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

import type { RpcClient } from '@/rpc/client';

import { isOpenableUrl, openExternalUrl } from './externalUrl';

export function ExternalLink({
  url,
  rpc,
  testId,
  className,
  children,
}: {
  url: string;
  rpc: RpcClient | null;
  testId?: string;
  className?: string;
  /** The link text; the URL itself when absent. */
  children?: ReactNode;
}) {
  const text = children ?? url;
  if (!isOpenableUrl(url)) {
    return (
      <span className={className} data-testid={testId}>
        {text}
      </span>
    );
  }
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openExternalUrl(rpc, url);
  };
  return (
    <a
      href={url}
      className={className}
      data-testid={testId}
      onClick={open}
      onKeyDown={(event) => {
        // Enter opens the link; the dialog's default button must not take it.
        if (event.key === 'Enter') open(event);
      }}
    >
      {text}
    </a>
  );
}
