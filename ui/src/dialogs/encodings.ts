/**
 * Encoding list of the original editor (IDS_ENCODINGS) and the name normaliser shared by the
 * Save As flow, the Encoding dialog and the settings.
 */

/** IDS_ENCODINGS of the original editor, in its order. */
export const ENCODING_CHOICES: readonly string[] = [
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

/** Canonical spelling of an encoding name (`UTF8`, `cp1251`, `windows1251`, `latin1`...). */
export function normalizeEncoding(name: string | undefined | null): string | null {
  if (!name) return null;
  const lower = name.trim().toLowerCase().replace(/_/g, '-');
  const compact = lower.replace(/-/g, '');
  for (const choice of ENCODING_CHOICES) {
    if (choice === lower || choice.replace(/-/g, '') === compact) return choice;
  }
  const cp = /^(?:cp|win(?:dows)?)(125[12])$/.exec(compact);
  if (cp) return `windows-${cp[1]}`;
  if (compact === 'utf16le' || compact === 'utf16be') return 'utf-16';
  if (compact === 'latin1') return 'iso-8859-1';
  if (compact === 'koi8r' || compact === 'koi8') return 'koi8-r';
  return null;
}
