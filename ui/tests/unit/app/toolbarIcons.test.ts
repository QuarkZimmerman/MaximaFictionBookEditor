/**
 * The icons of the Commands toolbar's buttons (feature 006, T044; FR-041; resource-formats.md
 * §19, Tests; C27): every button the toolbar offers - the original layout and the 25 offered
 * table buttons - has its 24 px icon, and each table button also its 16 px one, as 8-bit RGBA
 * PNG files of that size; the project's own pair holds the chunks IHDR, IDAT and IEND only.
 * (Six original buttons - `style.strong` to `style.code` - have no 16 px original, so the
 * 16 px half applies to the new family.)
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAppServices } from '@/app/services';
import { COMMANDS_TOOLBAR_OFFERED } from '@/app/toolbarDefinitions';
import { availableButtons } from '@/app/toolbarLayouts';
import { createAppStore } from '@/model/store';

const ICONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public/icons');

interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  chunks: string[];
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The IHDR fields and the chunk sequence of a PNG file. */
function readPng(file: string): PngInfo {
  const bytes = readFileSync(file);
  expect([...bytes.subarray(0, 8)], `${file}: PNG signature`).toEqual(SIGNATURE);
  const chunks: string[] = [];
  let info: Omit<PngInfo, 'chunks'> | null = null;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (type === 'IHDR') {
      info = {
        width: bytes.readUInt32BE(offset + 8),
        height: bytes.readUInt32BE(offset + 12),
        bitDepth: bytes[offset + 16]!,
        colourType: bytes[offset + 17]!,
      };
    }
    chunks.push(type);
    offset += 12 + length;
  }
  expect(info, `${file}: IHDR`).not.toBeNull();
  return { ...info!, chunks };
}

/** The icon of a command in the application's registry (the features' live commands included). */
function iconOf(commandId: string): string {
  services ??= createAppServices({ store: createAppStore(), platform: 'linux' });
  const icon = services.commands.get(commandId)?.icon;
  expect(icon, `${commandId}: the registry's icon`).toBeTruthy();
  return icon!;
}

let services: ReturnType<typeof createAppServices> | undefined;

describe('toolbar icons (feature 006)', () => {
  it("every button of availableButtons('commands') has its 24 px icon: 24 x 24, 8-bit RGBA", () => {
    const buttons = availableButtons('commands');
    expect(buttons).toHaveLength(57);
    for (const id of buttons) {
      const icon = iconOf(id);
      const file = path.join(ICONS, 'toolbar24', `${icon}.png`);
      expect(existsSync(file), file).toBe(true);
      const png = readPng(file);
      expect({ ...png, chunks: undefined }, id).toEqual({
        width: 24,
        height: 24,
        bitDepth: 8,
        colourType: 6,
        chunks: undefined,
      });
    }
  });

  it('each of the 25 table buttons also has its 16 px icon: 16 x 16, 8-bit RGBA; both sizes hold IHDR, IDAT and IEND only', () => {
    expect(COMMANDS_TOOLBAR_OFFERED).toHaveLength(25);
    for (const id of COMMANDS_TOOLBAR_OFFERED) {
      const icon = iconOf(id);
      expect(icon, id).toMatch(/^table-[a-z-]+$/);
      for (const size of [16, 24]) {
        const file = path.join(ICONS, `toolbar${size}`, `${icon}.png`);
        expect(existsSync(file), file).toBe(true);
        expect(readPng(file), `${id} ${size} px`).toEqual({
          width: size,
          height: size,
          bitDepth: 8,
          colourType: 6,
          chunks: ['IHDR', 'IDAT', 'IEND'],
        });
      }
    }
    // The live Table... command and its stub take the project's pair (C27); the original's
    // 16 px picture stays as a copied original.
    expect(iconOf('insert.table')).toBe('table-insert');
    expect(existsSync(path.join(ICONS, 'toolbar16', 'id_insert_table.png'))).toBe(true);
    expect(existsSync(path.join(ICONS, 'toolbar24', 'id_insert_table.png'))).toBe(false);
  });
});
