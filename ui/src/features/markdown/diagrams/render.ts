/**
 * Feature 011 (D49, DP-24): draws a Mermaid diagram as the picture file the book gets. Loaded by the
 * Markdown import only when the file holds a diagram, so Mermaid is a lazy chunk; nothing is fetched.
 *
 * The drawing is rasterised on white (FB2 readers show JPEG and PNG, not SVG), at most twice its own
 * size and within MAX_WIDTH x MAX_HEIGHT, and kept as the smallest of Chromium's PNG, a JPEG and - at
 * 256 colours or fewer - an indexed PNG. The source goes into the file (files.ts).
 */
import mermaid from 'mermaid';

import { SOURCE_KEYWORD } from './files';
import { MAX_HEIGHT, MAX_WIDTH, rasterise, sized, type DrawnDiagram } from './raster';

export type { DrawnDiagram };

let initialised = false;

function initialise(): void {
  if (initialised) return;
  mermaid.initialize({
    startOnLoad: false,
    // Text and links are sanitised, clicks and scripts of a diagram do nothing.
    securityLevel: 'strict',
    theme: 'default',
    // Mermaid's own layout: its optional ELK layout is not shipped (EPL-2.0, D49).
    layout: 'dagre',
    // SVG text instead of HTML labels: a foreignObject would make the canvas unreadable.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    deterministicIds: true,
    fontFamily: 'sans-serif',
  });
  initialised = true;
}

/** Draws `source`; rejects with Mermaid's reason when it cannot be drawn. */
export async function drawDiagram(source: string, index: number): Promise<DrawnDiagram> {
  initialise();
  const { svg } = await mermaid.render(`mfbe-diagram-${index}`, source);
  const drawing = sized(svg, (width, height) =>
    Math.min(2, MAX_WIDTH / width, MAX_HEIGHT / height),
  );
  return rasterise(drawing.text, drawing.width, drawing.height, source, SOURCE_KEYWORD);
}
