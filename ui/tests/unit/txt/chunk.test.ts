// @vitest-environment node
/**
 * Feature 017 (D15, D38, DP-1): the TXT export and import are the lazy chunks `txt-export` and
 * `txt-import`, and the shared word joining is `text-shared`. The folder rules of vite.config.ts; the
 * built output is checked by the journey of User Story 8 (us8-txt-lazy).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isTextSharedModule, isTxtExportModule, isTxtImportModule } from '../../../vite.config';

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TXT = path.join(UI_ROOT, 'src', 'features', 'txt');

describe('the txt chunk rules', () => {
  it('capture the export and import folders, and nothing else', () => {
    expect(isTxtExportModule(path.join(TXT, 'export', 'layout.ts'))).toBe(true);
    expect(isTxtImportModule(path.join(TXT, 'export', 'layout.ts'))).toBe(false);
    expect(isTxtImportModule(path.join(TXT, 'import', 'layout.ts'))).toBe(true);
    expect(isTxtExportModule(path.join(TXT, 'import', 'layout.ts'))).toBe(false);
    for (const file of [
      'exportCommand.ts',
      'importCommand.ts',
      'encodings.ts',
      'TxtExportOptions.tsx',
    ]) {
      expect(isTxtExportModule(path.join(TXT, file)), file).toBe(false);
      expect(isTxtImportModule(path.join(TXT, file)), file).toBe(false);
    }
    expect(isTextSharedModule(path.join(UI_ROOT, 'src', 'features', 'text', 'joinWords.ts'))).toBe(
      true,
    );
    expect(isTextSharedModule(path.join(TXT, 'import', 'layout.ts'))).toBe(false);
  });
});
