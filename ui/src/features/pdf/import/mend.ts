/**
 * Feature 016 (D15; tasks T041): letters a broken font mapping turned into others - windows-1251 text read as
 * Latin-1 ("Íî íè÷åãî" for "Но ничего") - mended when the mended words are known to the dictionaries.
 */

const CP1251 =
  'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0098™љ›њќћџ\u00a0ЎўЈ¤Ґ¦§Ё©Є«¬\u00ad®Ї°±Ііґµ¶·ё№є»јЅѕї' +
  'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя';

/** Latin-1 letters read as the windows-1251 letters they were. */
export function fromLatin1(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    out += code >= 0x80 && code <= 0xff ? CP1251[code - 0x80] : char;
  }
  return out;
}

/** True when most letters of `text` are Latin-1 accented letters of the 0xC0-0xFF range (the symptom). */
export function looksLatin1Cyrillic(text: string): boolean {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 8) return false;
  const high = letters.filter((c) => c.charCodeAt(0) >= 0xc0 && c.charCodeAt(0) <= 0xff).length;
  return high / letters.length > 0.6;
}
