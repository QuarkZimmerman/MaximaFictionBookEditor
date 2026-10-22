/**
 * Opening a web page through the core (feature 005; rpc-api §3.1 `app.openUrl`): the helpers
 * behind `ExternalLink.tsx` - which URLs may be opened (absolute `http(s)` only; anything else
 * is shown as text and never becomes a link) and the call itself, whose refusal (no opener,
 * 1050, an older core) is nothing the user needs to be told beyond the link's own text.
 */

import type { RpcClient } from '@/rpc/client';

/** True for an absolute `http` or `https` URL - the only kind `app.openUrl` opens. */
export function isOpenableUrl(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url.trim());
}

/** Asks the core to open `url` in the system browser; a refusal (no opener, 1050) is ignored. */
export function openExternalUrl(rpc: RpcClient | null, url: string): void {
  if (!rpc || !isOpenableUrl(url)) return;
  rpc.call('app.openUrl', { url: url.trim() }).catch(() => {
    // headless or without an opener: nothing to show the user beyond the link itself
  });
}
