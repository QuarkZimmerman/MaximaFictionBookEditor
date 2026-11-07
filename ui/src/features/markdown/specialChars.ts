/**
 * Feature 010, US8 (spec D37, research PD2, DP-4, DP-5; contracts/markdown-mapping.md §3): the
 * special characters of an imported Markdown file. Letters, digits and marks of every script stay
 * text, with the safe set of symbols readers' fonts have; emoji become inline pictures from Noto
 * Color Emoji, one per distinct emoji with its skin tone, flag, keycap or joined sequence; check
 * boxes, dingbats, shapes, box drawing and other symbols pictures from Noto Sans Symbols 2 and
 * Noto Sans Symbols; mathematical symbols outside the safe set pictures from Noto Sans Math.
 * Private-use characters (icon fonts) and characters no bundled font draws are dropped and listed.
 * GitHub's emoji codes (`:white_check_mark:`) stand for their emoji first.
 */

export type CharTreatment = 'keep' | 'emoji' | 'symbol' | 'math' | 'drop' | 'invisible';

export interface SpecialChar {
  /** The id of its picture: `ch-` and the code points in hex, joined by '-'. */
  id: string;
  /** The character: one grapheme, possibly several code points. */
  text: string;
  font: 'emoji' | 'symbol' | 'math';
}

const KEEP_CATEGORY = /^[\p{L}\p{M}\p{N}\p{P}\p{Z}\p{Sc}\p{Sk}]$/u;
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}$/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const REGIONAL = /\p{Regional_Indicator}/u;
const PRIVATE_OR_UNASSIGNED = /^[\p{Co}\p{Cn}\p{Cs}]$/u;

/** Symbols every reader's fonts have (contracts §3's safe set beyond letters and punctuation). */
const SAFE_SYMBOLS = new Set(
  [
    0x00a9, 0x00ae, 0x00b0, 0x00b1, 0x00d7, 0x00f7, 0x2116, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193,
    0x2194, 0x2212, 0x2215, 0x2219, 0x221a, 0x221e, 0x2248, 0x2260, 0x2261, 0x2264, 0x2265, 0x2030,
    0x2032, 0x2033, 0x00b5, 0x00a7, 0x00b6, 0x00ac, 0x00a6, 0x007e, 0x005e, 0x002b, 0x003c, 0x003d,
    0x003e, 0x007c,
  ].map((cp) => String.fromCodePoint(cp)),
);

function inRange(cp: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([from, to]) => cp >= from && cp <= to);
}

/** Blocks Noto Sans Symbols 2 / Noto Sans Symbols draw. */
const SYMBOL_BLOCKS = [
  [0x2190, 0x21ff], // arrows
  [0x2300, 0x23ff], // miscellaneous technical
  [0x2400, 0x243f], // control pictures
  [0x2460, 0x24ff], // enclosed alphanumerics
  [0x2500, 0x257f], // box drawing
  [0x2580, 0x259f], // block elements
  [0x25a0, 0x25ff], // geometric shapes
  [0x2600, 0x26ff], // miscellaneous symbols
  [0x2700, 0x27bf], // dingbats
  [0x27f0, 0x27ff], // supplemental arrows-A
  [0x2800, 0x28ff], // braille
  [0x2900, 0x297f], // supplemental arrows-B
  [0x2b00, 0x2bff], // miscellaneous symbols and arrows
  [0x1f000, 0x1f0ff], // mahjong, domino, playing cards
  [0x1f100, 0x1f1ff], // enclosed alphanumeric supplement
  [0x1f300, 0x1f6ff], // symbols and pictographs (text presentation)
  [0x1f780, 0x1f7ff], // geometric shapes extended
  [0x1f800, 0x1f8ff], // supplemental arrows-C
] as const;

/** Blocks Noto Sans Math draws. */
const MATH_BLOCKS = [
  [0x2100, 0x214f], // letterlike symbols
  [0x2200, 0x22ff], // mathematical operators
  [0x27c0, 0x27ef], // miscellaneous mathematical symbols-A
  [0x2980, 0x29ff], // miscellaneous mathematical symbols-B
  [0x2a00, 0x2aff], // supplemental mathematical operators
  [0x1d400, 0x1d7ff], // mathematical alphanumeric symbols
  [0x1ee00, 0x1eeff], // Arabic mathematical alphabetic symbols
] as const;

/** How one grapheme is carried over (contracts §3). */
export function treatmentOf(grapheme: string): CharTreatment {
  const points = [...grapheme];
  if (points.length === 0) return 'keep';
  const first = points[0]!;
  const cp = first.codePointAt(0)!;
  if (points.length === 1) {
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 'invisible';
    if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a) return 'invisible';
    // Mathematical letters (𝔸, 𝑥) are \p{L} too, but only the mathematical fonts draw them.
    if (
      inRange(cp, [
        [0x1d400, 0x1d7ff],
        [0x1ee00, 0x1eeff],
      ])
    ) {
      return 'math';
    }
    if (SAFE_SYMBOLS.has(first) || KEEP_CATEGORY.test(first)) {
      // Letterlike letters (ℕ, ℝ) are \p{L} but drawn by the mathematical fonts only.
      return inRange(cp, [[0x2100, 0x214f]]) && cp !== 0x2116 && cp !== 0x2122 ? 'math' : 'keep';
    }
    if (PRIVATE_OR_UNASSIGNED.test(first)) return 'drop';
    if (EMOJI_PRESENTATION.test(first)) return 'emoji';
    if (inRange(cp, MATH_BLOCKS)) return 'math';
    if (inRange(cp, SYMBOL_BLOCKS)) return 'symbol';
    return /^[\p{S}]$/u.test(first) ? 'drop' : 'keep';
  }
  // Several code points: an emoji with its modifiers, a flag, a keycap, a joined sequence, or a
  // letter with combining marks.
  if (REGIONAL.test(grapheme) || grapheme.includes('\u20e3') || grapheme.includes('\u200d')) {
    return 'emoji';
  }
  if (
    PICTOGRAPHIC.test(first) &&
    (grapheme.includes('\ufe0f') || /[\u{1f3fb}-\u{1f3ff}]/u.test(grapheme))
  ) {
    return 'emoji';
  }
  // A text-presentation selector, or marks over a base: as the base alone.
  const base = treatmentOf(first);
  return base === 'invisible' ? 'drop' : base;
}

/** The grapheme without a text-presentation selector, the form its picture shows. */
function pictureText(grapheme: string): string {
  return grapheme.replace(/\ufe0e/g, '');
}

/** The picture id of a grapheme: `ch-` and its code points in lower-case hex. */
export function pictureId(grapheme: string): string {
  return `ch-${[...pictureText(grapheme).replace(/\ufe0f$/u, '')]
    .map((ch) => ch.codePointAt(0)!.toString(16))
    .join('-')}`;
}

/** The text's graphemes (user-perceived characters), emoji sequences kept whole. */
export function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (...args: unknown[]) => unknown })
    .Segmenter;
  if (!Segmenter) return [...text];
  const segmenter = new Segmenter(undefined, { granularity: 'grapheme' }) as {
    segment(input: string): Iterable<{ segment: string }>;
  };
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** The special character a grapheme becomes, or null when it stays text or is dropped. */
export function specialChar(grapheme: string): SpecialChar | null {
  const treatment = treatmentOf(grapheme);
  if (treatment !== 'emoji' && treatment !== 'symbol' && treatment !== 'math') return null;
  return { id: pictureId(grapheme), text: pictureText(grapheme), font: treatment };
}

/** `U+XXXX U+YYYY` - how the summary names a dropped character. */
export function codePoints(grapheme: string): string {
  return [...grapheme]
    .map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');
}

/**
 * GitHub's emoji codes (gemoji names) the import knows, for the emoji they stand for. The common
 * ones of READMEs, issues and notes; an unknown code stays as written.
 */
export const EMOJI_CODES: Readonly<Record<string, string>> = {
  '+1': '👍',
  '-1': '👎',
  '100': '💯',
  airplane: '✈️',
  alarm_clock: '⏰',
  alien: '👽',
  angry: '😠',
  apple: '🍎',
  arrow_down: '⬇️',
  arrow_left: '⬅️',
  arrow_right: '➡️',
  arrow_up: '⬆️',
  arrows_counterclockwise: '🔄',
  art: '🎨',
  ballot_box_with_check: '☑️',
  bar_chart: '📊',
  basketball: '🏀',
  beer: '🍺',
  bell: '🔔',
  bird: '🐦',
  black_circle: '⚫',
  black_square_button: '🔲',
  blush: '😊',
  book: '📖',
  books: '📚',
  boom: '💥',
  broken_heart: '💔',
  bug: '🐛',
  bulb: '💡',
  cake: '🍰',
  calendar: '📅',
  camera: '📷',
  car: '🚗',
  cat: '🐱',
  chart_with_downwards_trend: '📉',
  chart_with_upwards_trend: '📈',
  checkered_flag: '🏁',
  clap: '👏',
  clipboard: '📋',
  clock1: '🕐',
  cloud: '☁️',
  coffee: '☕',
  computer: '💻',
  confused: '😕',
  construction: '🚧',
  copyright: '©️',
  crossed_fingers: '🤞',
  crown: '👑',
  cry: '😢',
  dash: '💨',
  date: '📅',
  dog: '🐶',
  dollar: '💵',
  droplet: '💧',
  earth_africa: '🌍',
  email: '📧',
  envelope: '✉️',
  evergreen_tree: '🌲',
  exclamation: '❗',
  eyes: '👀',
  facepalm: '🤦',
  file_folder: '📁',
  fire: '🔥',
  fish: '🐟',
  four_leaf_clover: '🍀',
  free: '🆓',
  gear: '⚙️',
  gem: '💎',
  ghost: '👻',
  gift: '🎁',
  globe_with_meridians: '🌐',
  grinning: '😀',
  hammer: '🔨',
  handshake: '🤝',
  heart: '❤️',
  heart_eyes: '😍',
  heavy_check_mark: '✔️',
  heavy_division_sign: '➗',
  heavy_minus_sign: '➖',
  heavy_multiplication_x: '✖️',
  heavy_plus_sign: '➕',
  hospital: '🏥',
  hourglass: '⌛',
  house: '🏠',
  hugs: '🤗',
  information_source: 'ℹ️',
  innocent: '😇',
  iphone: '📱',
  joy: '😂',
  key: '🔑',
  keyboard: '⌨️',
  large_blue_circle: '🔵',
  laughing: '😆',
  link: '🔗',
  lock: '🔒',
  loudspeaker: '📢',
  mag: '🔍',
  medal: '🏅',
  memo: '📝',
  moneybag: '💰',
  moon: '🌙',
  movie_camera: '🎥',
  muscle: '💪',
  musical_note: '🎵',
  negative_squared_cross_mark: '❎',
  neutral_face: '😐',
  new: '🆕',
  no_entry: '⛔',
  no_entry_sign: '🚫',
  notes: '🎶',
  ok: '🆗',
  ok_hand: '👌',
  open_file_folder: '📂',
  package: '📦',
  page_facing_up: '📄',
  paperclip: '📎',
  pencil2: '✏️',
  phone: '☎️',
  pizza: '🍕',
  point_down: '👇',
  point_left: '👈',
  point_right: '👉',
  point_up: '👆',
  poop: '💩',
  pray: '🙏',
  pushpin: '📌',
  question: '❓',
  radio_button: '🔘',
  rabbit: '🐰',
  rage: '😡',
  rainbow: '🌈',
  raised_hands: '🙌',
  red_circle: '🔴',
  registered: '®️',
  robot: '🤖',
  rocket: '🚀',
  rofl: '🤣',
  rotating_light: '🚨',
  rose: '🌹',
  school: '🏫',
  scissors: '✂️',
  scream: '😱',
  see_no_evil: '🙈',
  seedling: '🌱',
  ship: '🚢',
  shrug: '🤷',
  skull: '💀',
  sleeping: '😴',
  slightly_smiling_face: '🙂',
  small_blue_diamond: '🔹',
  small_orange_diamond: '🔸',
  small_red_triangle: '🔺',
  smile: '😄',
  smiley: '😃',
  smiling_imp: '😈',
  snowflake: '❄️',
  sob: '😭',
  soccer: '⚽',
  sos: '🆘',
  sparkles: '✨',
  speech_balloon: '💬',
  star: '⭐',
  star2: '🌟',
  stop_sign: '🛑',
  stuck_out_tongue: '😛',
  sun_with_face: '🌞',
  sunglasses: '😎',
  sunny: '☀️',
  sweat_drops: '💦',
  sweat_smile: '😅',
  tada: '🎉',
  thinking: '🤔',
  thought_balloon: '💭',
  thumbsdown: '👎',
  thumbsup: '👍',
  tm: '™️',
  triangular_flag_on_post: '🚩',
  trophy: '🏆',
  tv: '📺',
  umbrella: '☔',
  unlock: '🔓',
  upside_down_face: '🙃',
  v: '✌️',
  video_game: '🎮',
  warning: '⚠️',
  wave: '👋',
  white_check_mark: '✅',
  white_circle: '⚪',
  white_square_button: '🔳',
  wine_glass: '🍷',
  wink: '😉',
  woman: '👩',
  man: '👨',
  baby: '👶',
  wrench: '🔧',
  writing_hand: '✍️',
  x: '❌',
  zap: '⚡',
  zzz: '💤',
};

/** Replaces the known `:code:`s of a text by their emoji. */
export function expandEmojiCodes(text: string): string {
  return text.replace(/:([a-z0-9_+-]+):/g, (whole, code: string) => EMOJI_CODES[code] ?? whole);
}
