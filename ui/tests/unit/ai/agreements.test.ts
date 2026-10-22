/**
 * First-use agreements (feature 005 T035; FR-008, FR-021; data-model §2.3; review B4): the
 * notice is due for a hosted address without an agreement for the service **and** its current
 * host - a redirected host asks again -, never for a local one; *Yes* replaces the agreement
 * of the same service instead of appending; a withdrawal removes it; `saveAgreements` writes
 * the whole array at once through `settings.set` and keeps the store in step.
 */

import {
  agreementDue,
  agreementKey,
  agreementsOf,
  findAgreement,
  hasAgreement,
  isNoticeDue,
  saveAgreements,
  settingsWithAgreement,
  settingsWithoutAgreement,
  withAgreement,
  withoutAgreement,
} from '@/ai/agreements';
import { actions, createAppStore } from '@/model/store';
import type { AiAgreement, Settings } from '@/rpc/types';

import { fakeRpc, rpcError } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

const AT = '2026-10-22T10:00:00.000Z';

function withAgreements(agreements: AiAgreement[]): Settings {
  const settings = defaultSettings();
  settings.ai.agreements = agreements;
  return settings;
}

describe('agreementKey and the lookup helpers', () => {
  it('keys a free entry by id and the custom target by its address as stored', () => {
    expect(agreementKey({ kind: 'free', id: 'ovhcloud' })).toBe('ovhcloud');
    expect(agreementKey({ kind: 'custom', address: 'https://api.example/v1/' })).toBe(
      'custom:https://api.example/v1/',
    );
  });

  it('finds an agreement by key whatever its host, and by key and host exactly', () => {
    const agreements = [{ service: 'ovhcloud', host: 'a.example', at: AT }];
    expect(findAgreement(agreements, 'ovhcloud')?.host).toBe('a.example');
    expect(findAgreement(agreements, 'kilo')).toBeUndefined();
    expect(hasAgreement(agreements, 'ovhcloud', 'a.example')).toBe(true);
    expect(hasAgreement(agreements, 'ovhcloud', 'A.example')).toBe(false);
    expect(hasAgreement(agreements, 'ovhcloud', 'a.example:443')).toBe(false);
  });

  it('reads the agreements of a snapshot, tolerating none and an older core', () => {
    expect(agreementsOf(null)).toEqual([]);
    expect(agreementsOf({ ai: undefined } as unknown as Settings)).toEqual([]);
    expect(agreementsOf(withAgreements([{ service: 's', host: 'h', at: AT }]))).toHaveLength(1);
  });
});

describe('isNoticeDue / agreementDue', () => {
  const agreed = [{ service: 'ovhcloud', host: 'oai.endpoints.kepler.ai.cloud.ovh.net', at: AT }];

  it('is due for a hosted address without an agreement and not with one for the same host', () => {
    const address = 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1';
    expect(isNoticeDue([], { kind: 'free', id: 'ovhcloud' }, address)).toBe(true);
    expect(isNoticeDue(agreed, { kind: 'free', id: 'ovhcloud' }, address)).toBe(false);
    // Another service at the same host: its own agreement is needed.
    expect(isNoticeDue(agreed, { kind: 'free', id: 'other' }, address)).toBe(true);
  });

  it('is due again when a user list entry redirects the id to another host (review B4)', () => {
    expect(
      isNoticeDue(agreed, { kind: 'free', id: 'ovhcloud' }, 'https://proxy.example.net/v1'),
    ).toBe(true);
    // ... and when only the port differs: the host is compared as written.
    expect(
      isNoticeDue(
        agreed,
        { kind: 'free', id: 'ovhcloud' },
        'https://oai.endpoints.kepler.ai.cloud.ovh.net:8443/v1',
      ),
    ).toBe(true);
  });

  it('is never due for a local address, agreement or not', () => {
    for (const address of [
      'http://127.0.0.1:8787/v1',
      'http://localhost:11434/v1',
      'http://[::1]:8080/v1',
      'https://127.5.6.7/v1',
    ]) {
      expect(isNoticeDue([], { kind: 'free', id: 'standin' }, address), address).toBe(false);
      expect(isNoticeDue([], { kind: 'custom', address }, address), address).toBe(false);
    }
    // `.localhost` names, 0.0.0.0 and LAN addresses are hosted.
    for (const address of ['http://ai.localhost/v1', 'http://0.0.0.0:1/v1', 'http://10.0.0.5/v1']) {
      expect(isNoticeDue([], { kind: 'custom', address }, address), address).toBe(true);
    }
  });

  it('agreementDue reads the snapshot and the custom key carries the draft address', () => {
    const settings = withAgreements([
      { service: 'custom:http://ai.standin.test:8787/v1', host: 'ai.standin.test:8787', at: AT },
    ]);
    const address = 'http://ai.standin.test:8787/v1';
    expect(agreementDue({ kind: 'custom', address }, settings)).toBe(false);
    expect(agreementDue({ kind: 'custom', address: `${address}/` }, settings)).toBe(true);
    expect(agreementDue({ kind: 'custom', address }, null)).toBe(true);
    expect(agreementDue({ kind: 'free', id: 'standin', address }, settings)).toBe(true);
  });
});

describe('withAgreement / withoutAgreement', () => {
  it('appends a new agreement with the time given', () => {
    expect(withAgreement([], 'ovhcloud', 'a.example', AT)).toEqual([
      { service: 'ovhcloud', host: 'a.example', at: AT },
    ]);
    const now = withAgreement([], 'ovhcloud', 'a.example');
    expect(Date.parse(now[0]!.at)).not.toBeNaN();
  });

  it('replaces the agreement of the same service in place instead of appending', () => {
    const before = [
      { service: 'ovhcloud', host: 'a.example', at: AT },
      { service: 'llm7', host: 'api.llm7.io', at: AT },
    ];
    const after = withAgreement(before, 'ovhcloud', 'b.example', '2026-10-23T00:00:00.000Z');
    expect(after).toEqual([
      { service: 'ovhcloud', host: 'b.example', at: '2026-10-23T00:00:00.000Z' },
      { service: 'llm7', host: 'api.llm7.io', at: AT },
    ]);
    expect(before[0]!.host).toBe('a.example'); // the input is not mutated
  });

  it('withdraws by key and leaves the rest', () => {
    const agreements = [
      { service: 'ovhcloud', host: 'a.example', at: AT },
      { service: 'custom:https://api.example/v1', host: 'api.example', at: AT },
    ];
    expect(withoutAgreement(agreements, 'ovhcloud')).toEqual([agreements[1]]);
    expect(withoutAgreement(agreements, 'missing')).toEqual(agreements);
  });

  it('the snapshot forms derive the key and the host from the subject', () => {
    const settings = withAgreements([{ service: 'llm7', host: 'api.llm7.io', at: AT }]);
    const added = settingsWithAgreement(
      settings,
      { kind: 'free', id: 'ovhcloud', address: 'https://user:pw@a.example:8443/v1' },
      AT,
    );
    expect(added).toEqual([
      { service: 'llm7', host: 'api.llm7.io', at: AT },
      { service: 'ovhcloud', host: 'a.example:8443', at: AT },
    ]);
    expect(settingsWithoutAgreement(settings, 'llm7')).toEqual([]);
    expect(settingsWithoutAgreement(null, 'llm7')).toEqual([]);
  });
});

describe('saveAgreements', () => {
  const agreements = [{ service: 'ovhcloud', host: 'a.example', at: AT }];

  it('writes the whole array at once with settings.set and updates the store', async () => {
    const store = createAppStore();
    actions.setSettings(store, defaultSettings());
    const rpc = fakeRpc({
      'settings.set': (params: unknown) => ({
        settings: withAgreements(
          (params as { patch: { ai: { agreements: AiAgreement[] } } }).patch.ai.agreements,
        ),
        restartRequired: false,
      }),
    });
    await expect(saveAgreements(store, rpc.client, agreements)).resolves.toBe(true);
    expect(rpc.calls).toEqual([
      { method: 'settings.set', params: { patch: { ai: { agreements } } } },
    ]);
    expect(store.getState().settings?.ai.agreements).toEqual(agreements);
  });

  it('puts the store back when the core refuses, and does nothing without a client', async () => {
    const store = createAppStore();
    actions.setSettings(store, defaultSettings());
    const rpc = fakeRpc({ 'settings.set': rpcError(1040, 'settings.invalid') });
    await expect(saveAgreements(store, rpc.client, agreements)).resolves.toBe(false);
    expect(store.getState().settings?.ai.agreements).toEqual([]);
    await expect(saveAgreements(store, null, agreements)).resolves.toBe(false);
  });
});
