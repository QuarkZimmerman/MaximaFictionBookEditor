/**
 * Feature 011 (D49, FR-075a, SC-021) - Mermaid diagrams of an imported Markdown file become pictures,
 * drawn offline by the bundled Mermaid: a flowchart, a sequence diagram and a class diagram give three
 * pictures, each under 150 KB (their sizes are recorded); a block Mermaid cannot draw stays code and
 * is listed in the import's summary; exported again, the three come back as ```mermaid blocks.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/core';

interface Binary {
  id: string;
  contentType: string;
  size: number;
}

declare const window: {
  __mfbeTest?: {
    scripts?: { toXml(): Promise<string>; document(): { binaries: Binary[] } | null };
  };
};

const FLOW =
  'graph TD\n  A[Start] --> B{Is it ready?}\n  B -->|Yes| C[Publish]\n  B -->|No| D[Edit]\n  D --> B';
const SEQUENCE =
  'sequenceDiagram\n  participant Author\n  participant Editor\n  Author->>Editor: Sends the manuscript\n  Editor-->>Author: Returns notes\n  Author->>Editor: Sends the final text';
const CLASSES =
  'classDiagram\n  class Book {\n    +String title\n    +open()\n  }\n  class Chapter\n  Book "1" --> "*" Chapter : holds';
const BROKEN = 'notADiagram of anything';

const MARKDOWN = `# Diagrams

The workflow:

\`\`\`mermaid
${FLOW}
\`\`\`

Who talks to whom:

\`\`\`mermaid
${SEQUENCE}
\`\`\`

\`\`\`mermaid
${CLASSES}
\`\`\`

\`\`\`mermaid
${BROKEN}
\`\`\`
`;

const xml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
const binaries = (page: Page) =>
  page.evaluate(() => window.__mfbeTest!.scripts!.document()?.binaries ?? []);

test.describe('US7 (feature 011) - Mermaid diagrams on import', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-diagrams-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('three diagrams become small pictures, a broken one stays code, the export gives them back', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    const source = path.join(dir, 'diagrams.md');
    writeFileSync(source, MARKDOWN, 'utf8');
    await core.openApp(page);
    await core.enqueueDialog('dialog.openFile', { paths: [source] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await page.getByTestId('menu-file-import-importMarkdown').click();
    // The broken block is listed in the summary.
    const summary = page.getByTestId('dialog-markdown-summary');
    await expect(summary).toBeVisible({ timeout: 60_000 });
    await expect(summary).toContainText('Diagram kept as code');
    await expect(summary).toContainText('notADiagram');
    await page.keyboard.press('Enter');

    // Three pictures where the blocks stood, each under 150 KB; the broken block is code.
    await expect
      .poll(async () => (await binaries(page)).filter((b) => b.id.startsWith('mermaid-')).length)
      .toBe(3);
    const pictures = (await binaries(page)).filter((b) => b.id.startsWith('mermaid-'));
    for (const picture of pictures) {
      test.info().annotations.push({
        type: 'diagram',
        description: `${picture.id}: ${picture.contentType}, ${picture.size} bytes`,
      });
      console.log(`diagram ${picture.id}: ${picture.contentType}, ${picture.size} bytes`);
      expect(['image/png', 'image/jpeg']).toContain(picture.contentType);
      expect(picture.size).toBeLessThan(150 * 1024);
    }
    const book = await xml(page);
    for (const id of ['mermaid-1', 'mermaid-2', 'mermaid-3']) {
      expect(book).toContain(`<image l:href="#${id}" alt="Diagram"/>`);
    }
    expect(book).toContain('<code>notADiagram of anything</code>');
    // The source travels inside the picture, never as its caption.
    expect(book).not.toContain('title="graph TD');

    // Exported again, the three diagrams are Mermaid blocks, not pictures.
    const target = path.join(dir, 'again.md');
    await core.enqueueDialog('dialog.saveFile', { path: target });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-export').hover();
    await page.getByTestId('menu-file-export-exportMarkdown').click();
    // The book has pictures: the export asks whether to include them (the test dialog has no
    // checkbox); the diagrams are written as Mermaid either way.
    const question = page.getByTestId('dialog-markdown-pictures');
    await expect(question).toBeVisible({ timeout: 15_000 });
    await question.getByTestId('dialog-markdown-pictures-button-yes').click();
    await expect(page.getByTestId('status-message')).toContainText(`Exported to ${target}:`, {
      timeout: 30_000,
    });
    const exported = readFileSync(target, 'utf8');
    for (const diagram of [FLOW, SEQUENCE, CLASSES]) {
      expect(exported).toContain(`\`\`\`mermaid\n${diagram}\n\`\`\``);
    }
    expect(exported).not.toContain('data:image');
  });
});
