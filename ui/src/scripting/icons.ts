/**
 * Icon URLs of the scripts and their groups (served by the core: a package's icon from its
 * folder, a group's declared icon from `/script-groups/<folder>/icon` - feature 007). The one
 * place that turns the core's icon paths into what the page loads: the Scripts toolbar and the
 * Scripts menu use it.
 */

import { resolveToken } from '@/rpc/client';

import type { ScriptGroup, ScriptInfo } from './types';

/** A core path (`/scripts/...`, `/script-groups/...`) under the page's base, with the token. */
function coreUrl(path: string): string {
  const base = path.startsWith('/') ? path.slice(1) : path;
  const url = `${import.meta.env.BASE_URL}${base}`;
  const token = resolveToken();
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

/** Absolute icon URL on the core (the page token authenticates the <img> request). */
export function scriptIconUrl(script: ScriptInfo): string | undefined {
  return script.iconUrl ? coreUrl(script.iconUrl) : undefined;
}

/** The group's icon URL on the core, as `scriptIconUrl` (feature 007, User Story 8). */
export function groupIconUrl(group: ScriptGroup): string | undefined {
  return group.iconUrl ? coreUrl(group.iconUrl) : undefined;
}
