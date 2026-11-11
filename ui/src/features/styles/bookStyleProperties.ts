/**
 * Feature 012 (T056; D37, FR-062; contracts/book-styles.md §3): every standard CSS property the Styles
 * view knows - css-tree's lexer, `standardProperties()` - with its treatment in the Body view while the
 * book's styles are shown. A unit test compares this table with the lexer's list: a property a newer
 * css-tree knows is classified here before the Body view can draw it. Generated once from the contract's
 * rules, then kept by hand.
 *
 * - **held**: never drawn - it moves or scales text out of its place, clips or hides it, takes editing
 *   away (the pointer, the selection, the caret, scrolling), or moves by itself;
 * - **limited**: drawn within limits (`treat()` in bookStyles.ts): a readable size, a visible opacity,
 *   shifts of at most two lines, the displays and wrapping that keep text reachable;
 * - **drawn**: as written, colours included (D38); `url()` other than `data:` is held back whatever
 *   the property.
 */

export type Treatment = 'drawn' | 'limited' | 'held';

const HELD = [
  'all anchor-name anchor-scope animation animation-composition animation-delay',
  'animation-direction animation-duration animation-fill-mode animation-iteration-count',
  'animation-name animation-play-state animation-range animation-range-end',
  'animation-range-start animation-timeline animation-timing-function animation-trigger',
  'backdrop-filter backface-visibility block-size caret caret-animation caret-color caret-shape',
  'clip clip-path contain contain-intrinsic-block-size contain-intrinsic-height',
  'contain-intrinsic-inline-size contain-intrinsic-size contain-intrinsic-width container',
  'container-name container-type content-visibility cursor filter font-size-adjust',
  'forced-color-adjust height interactivity mask mask-border mask-border-mode',
  'mask-border-outset mask-border-repeat mask-border-slice mask-border-source mask-border-width',
  'mask-clip mask-composite mask-image mask-mode mask-origin mask-position mask-repeat',
  'mask-size mask-type max-block-size max-height offset offset-anchor offset-distance',
  'offset-path offset-position offset-rotate overflow overflow-anchor overflow-block',
  'overflow-clip-box overflow-clip-margin overflow-inline overflow-x overflow-y',
  'overscroll-behavior overscroll-behavior-block overscroll-behavior-inline',
  'overscroll-behavior-x overscroll-behavior-y perspective perspective-origin pointer-events',
  'position-anchor position-area position-try position-try-fallbacks position-try-options',
  'position-try-order position-visibility reading-flow reading-order resize rotate scale',
  'scroll-behavior scroll-initial-target scroll-margin scroll-margin-block',
  'scroll-margin-block-end scroll-margin-block-start scroll-margin-bottom scroll-margin-inline',
  'scroll-margin-inline-end scroll-margin-inline-start scroll-margin-left scroll-margin-right',
  'scroll-margin-top scroll-marker-group scroll-padding scroll-padding-block',
  'scroll-padding-block-end scroll-padding-block-start scroll-padding-bottom',
  'scroll-padding-inline scroll-padding-inline-end scroll-padding-inline-start',
  'scroll-padding-left scroll-padding-right scroll-padding-top scroll-snap-align',
  'scroll-snap-coordinate scroll-snap-destination scroll-snap-points-x scroll-snap-points-y',
  'scroll-snap-stop scroll-snap-type scroll-snap-type-x scroll-snap-type-y scroll-target-group',
  'scroll-timeline scroll-timeline-axis scroll-timeline-name text-wrap-mode timeline-scope',
  'touch-action transform transform-box transform-origin transform-style transition',
  'transition-behavior transition-delay transition-duration transition-property',
  'transition-timing-function translate user-select view-timeline view-timeline-axis',
  'view-timeline-inset view-timeline-name view-transition-class view-transition-name',
  'white-space-collapse will-change zoom',
];

const LIMITED = [
  'bottom color display font font-size inset inset-block inset-block-end inset-block-start',
  'inset-inline inset-inline-end inset-inline-start left margin margin-block margin-block-end',
  'margin-block-start margin-bottom margin-inline margin-inline-end margin-inline-start',
  'margin-left margin-right margin-top opacity position right text-indent text-wrap top',
  'visibility white-space z-index',
];

const DRAWN = [
  'accent-color align-content align-items align-self align-tracks alignment-baseline appearance',
  'aspect-ratio background background-attachment background-blend-mode background-clip',
  'background-color background-image background-origin background-position',
  'background-position-x background-position-y background-repeat background-size baseline-shift',
  'baseline-source behavior border border-block border-block-color border-block-end',
  'border-block-end-color border-block-end-style border-block-end-width border-block-start',
  'border-block-start-color border-block-start-style border-block-start-width',
  'border-block-style border-block-width border-bottom border-bottom-color',
  'border-bottom-left-radius border-bottom-right-radius border-bottom-style border-bottom-width',
  'border-collapse border-color border-end-end-radius border-end-start-radius border-image',
  'border-image-outset border-image-repeat border-image-slice border-image-source',
  'border-image-width border-inline border-inline-color border-inline-end',
  'border-inline-end-color border-inline-end-style border-inline-end-width border-inline-start',
  'border-inline-start-color border-inline-start-style border-inline-start-width',
  'border-inline-style border-inline-width border-left border-left-color border-left-style',
  'border-left-width border-radius border-right border-right-color border-right-style',
  'border-right-width border-spacing border-start-end-radius border-start-start-radius',
  'border-style border-top border-top-color border-top-left-radius border-top-right-radius',
  'border-top-style border-top-width border-width box-align box-decoration-break box-direction',
  'box-flex box-flex-group box-lines box-ordinal-group box-orient box-pack box-shadow',
  'box-sizing break-after break-before break-inside caption-side clear clip-rule',
  'color-interpolation-filters color-scheme column-count column-fill column-gap column-height',
  'column-rule column-rule-color column-rule-style column-rule-width column-span column-width',
  'column-wrap columns content corner-block-end-shape corner-block-start-shape',
  'corner-bottom-left-shape corner-bottom-right-shape corner-bottom-shape corner-end-end-shape',
  'corner-end-start-shape corner-inline-end-shape corner-inline-start-shape corner-left-shape',
  'corner-right-shape corner-shape corner-start-end-shape corner-start-start-shape',
  'corner-top-left-shape corner-top-right-shape corner-top-shape counter-increment',
  'counter-reset counter-set cue cue-after cue-before cx cy d direction dominant-baseline',
  'dynamic-range-limit empty-cells field-sizing fill fill-opacity fill-rule flex flex-basis',
  'flex-direction flex-flow flex-grow flex-shrink flex-wrap float flood-color flood-opacity',
  'font-family font-feature-settings font-kerning font-language-override font-optical-sizing',
  'font-palette font-smooth font-stretch font-style font-synthesis font-synthesis-position',
  'font-synthesis-small-caps font-synthesis-style font-synthesis-weight font-variant',
  'font-variant-alternates font-variant-caps font-variant-east-asian font-variant-emoji',
  'font-variant-ligatures font-variant-numeric font-variant-position font-variation-settings',
  'font-weight font-width gap glyph-orientation-horizontal glyph-orientation-vertical grid',
  'grid-area grid-auto-columns grid-auto-flow grid-auto-rows grid-column grid-column-end',
  'grid-column-gap grid-column-start grid-gap grid-row grid-row-end grid-row-gap grid-row-start',
  'grid-template grid-template-areas grid-template-columns grid-template-rows',
  'hanging-punctuation hyphenate-character hyphenate-limit-chars hyphens image-orientation',
  'image-rendering image-resolution ime-mode initial-letter initial-letter-align inline-size',
  'interest-delay interest-delay-end interest-delay-start interpolate-size isolation',
  'justify-content justify-items justify-self justify-tracks kerning letter-spacing',
  'lighting-color line-break line-clamp line-height line-height-step list-style',
  'list-style-image list-style-position list-style-type margin-trim marker marker-end',
  'marker-mid marker-start masonry-auto-flow math-depth math-shift math-style max-inline-size',
  'max-lines max-width min-block-size min-height min-inline-size min-width mix-blend-mode',
  'object-fit object-position object-view-box order orphans outline outline-color',
  'outline-offset outline-style outline-width overflow-wrap overlay padding padding-block',
  'padding-block-end padding-block-start padding-bottom padding-inline padding-inline-end',
  'padding-inline-start padding-left padding-right padding-top page page-break-after',
  'page-break-before page-break-inside paint-order pause pause-after pause-before place-content',
  'place-items place-self print-color-adjust quotes r rest rest-after rest-before row-gap',
  'ruby-align ruby-merge ruby-overhang ruby-position rx ry scrollbar-color scrollbar-gutter',
  'scrollbar-width shape-image-threshold shape-margin shape-outside shape-rendering speak',
  'speak-as stop-color stop-opacity stroke stroke-color stroke-dasharray stroke-dashoffset',
  'stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width tab-size',
  'table-layout text-align text-align-last text-anchor text-autospace text-box text-box-edge',
  'text-box-trim text-combine-upright text-decoration text-decoration-color',
  'text-decoration-inset text-decoration-line text-decoration-skip text-decoration-skip-ink',
  'text-decoration-style text-decoration-thickness text-emphasis text-emphasis-color',
  'text-emphasis-position text-emphasis-style text-justify text-orientation text-overflow',
  'text-rendering text-shadow text-size-adjust text-spacing-trim text-transform',
  'text-underline-offset text-underline-position text-wrap-style timeline-trigger',
  'timeline-trigger-exit-range timeline-trigger-exit-range-end',
  'timeline-trigger-exit-range-start timeline-trigger-name timeline-trigger-range',
  'timeline-trigger-range-end timeline-trigger-range-start timeline-trigger-source',
  'trigger-scope unicode-bidi vector-effect vertical-align voice-balance voice-duration',
  'voice-family voice-pitch voice-range voice-rate voice-stress voice-volume white-space-trim',
  'widows width word-break word-spacing word-wrap writing-mode x y',
];

function names(lines: readonly string[]): string[] {
  return lines.join(' ').split(' ');
}

/** The treatment of each standard property (575 in css-tree 3.2.1). */
export const PROPERTY_TREATMENTS: Readonly<Record<string, Treatment>> = Object.freeze(
  Object.fromEntries([
    ...names(HELD).map((name) => [name, 'held'] as const),
    ...names(LIMITED).map((name) => [name, 'limited'] as const),
    ...names(DRAWN).map((name) => [name, 'drawn'] as const),
  ]),
);
