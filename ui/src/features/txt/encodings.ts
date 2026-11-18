/**
 * Feature 017 (D10, D11, D17, D19): the encodings the TXT export offers a book and the one its
 * dialog proposes. The lists come from the core (`txt.encodings`, the one source of the dialog, the
 * settings page and the tests); static and small, so the dialog needs no lazy part.
 */
import type { RpcClient } from '@/rpc/client';
import type { Settings, TxtEncodings } from '@/rpc/types';

let cached: Promise<TxtEncodings> | null = null;

/** The core's lists, asked once per start of the editor. */
export function loadTxtEncodings(rpc: RpcClient): Promise<TxtEncodings> {
  cached ??= rpc.call('txt.encodings', {}).catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

/** The list of a Russian, Ukrainian or English book (the main part of its language code), else none. */
export function bookList(lang: string | null | undefined): 'ru' | 'uk' | 'en' | null {
  const primary = (lang ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return primary === 'ru' || primary === 'uk' || primary === 'en' ? primary : null;
}

/** The encodings offered to a book of `lang` (D11): its language's list, else all 29. */
export function offeredEncodings(lists: TxtEncodings, lang: string | null | undefined): string[] {
  const key = bookList(lang);
  return key ? [...lists[key]] : lists.all.map((e) => e.name);
}

/** The settings' default for a book of `lang` (D19, contracts/settings.md), within the offered list. */
export function defaultEncoding(
  lists: TxtEncodings,
  lang: string | null | undefined,
  txt: Settings['txt'] | undefined,
): string {
  if (!txt || txt.encodingMode !== 'language') return 'utf-8';
  const chosen = txt.encodings[bookList(lang) ?? 'other'];
  return offeredEncodings(lists, lang).includes(chosen) ? chosen : 'utf-8';
}

/** The catalogue key of an encoding's name in the dialog's list. */
export function encodingLabelKey(lists: TxtEncodings, name: string): string {
  return lists.all.find((e) => e.name === name)?.labelKey ?? `txt.encoding.${name}`;
}
