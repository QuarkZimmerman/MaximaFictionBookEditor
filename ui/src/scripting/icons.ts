/** Icon URLs of script packages (served by the core from the package folder). */

import { resolveToken } from '@/rpc/client';

import type { ScriptInfo } from './types';

/** Absolute icon URL on the core (the page token authenticates the <img> request). */
export function scriptIconUrl(script: ScriptInfo): string | undefined {
  if (!script.iconUrl) return undefined;
  const base = script.iconUrl.startsWith('/') ? script.iconUrl.slice(1) : script.iconUrl;
  const url = `${import.meta.env.BASE_URL}${base}`;
  const token = resolveToken();
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}
