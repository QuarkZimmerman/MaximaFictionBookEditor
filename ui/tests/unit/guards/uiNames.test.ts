/**
 * Guard G7 (feature 010, research §2.4): the inventory of every command's label, tooltip and
 * description in the three interface languages, kept as a file snapshot. A change to any of them
 * shows in review as a diff of `tests/inventory/ui-names.json`; each such change must trace to a
 * requirement of the feature that makes it (the ledger `test-changes.md`), so an unintended label
 * change cannot pass unnoticed.
 */

import { createInstance, type TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  commandDescription,
  commandLabelRaw,
  commandTooltip,
  createCommandRegistry,
} from '@/app/commands';
import { createAppServices } from '@/app/services';
import { resources } from '@/i18n';
import { createAppStore } from '@/model/store';

const LANGUAGES = ['en', 'ru', 'uk'] as const;

async function translatorFor(lng: string): Promise<TFunction> {
  const instance = createInstance();
  await instance.init({
    lng,
    fallbackLng: 'en',
    resources,
    interpolation: { escapeValue: false },
  });
  return instance.t;
}

describe('guard G7: the names of every command', () => {
  it('match the committed inventory', async () => {
    const commands = createCommandRegistry();
    createAppServices({ store: createAppStore(), commands, rpc: null });
    const ids = commands
      .all()
      .map((command) => command.id)
      .sort();
    const inventory: Record<string, Record<string, Record<string, string>>> = {};
    for (const lng of LANGUAGES) {
      const t = await translatorFor(lng);
      const names: Record<string, Record<string, string>> = {};
      for (const id of ids) {
        const command = commands.get(id);
        if (!command) continue;
        names[id] = {
          label: commandLabelRaw(command, t),
          tooltip: commandTooltip(command, t),
          description: commandDescription(command, t),
        };
      }
      inventory[lng] = names;
    }
    await expect(`${JSON.stringify(inventory, null, 2)}\n`).toMatchFileSnapshot(
      '../../../../tests/inventory/ui-names.json',
    );
  });
});
