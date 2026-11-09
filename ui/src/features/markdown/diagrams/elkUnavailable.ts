/**
 * Feature 011 (D49, DP-24): stands in for `elkjs/lib/elk.bundled.js` (EPL-2.0, which GPL-3.0 code
 * cannot ship), which Mermaid imports only for its optional ELK layout. A diagram that asks for that
 * layout fails to draw and stays a code block, listed in the import's summary.
 */
export default class ElkUnavailable {
  constructor() {
    throw new Error('the ELK layout is not part of this editor');
  }
}
