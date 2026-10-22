/**
 * Address helpers of the AI assistant (feature 005 data-model §0; rpc-api Definitions "Host" and
 * "Local address"): the one textual rule the UI and the core apply - `localhost`, 127.0.0.0/8 and
 * `::1` are local, everything else is hosted -, the host as written without user information,
 * the plain-http warning, the trailing slash and the agreement key; and the agreement helpers of
 * data-model §2.3 (the notice is due for a hosted target without an agreement for its key and
 * current host).
 */

import {
  agreementKey,
  hostNameOf,
  hostOf,
  isHostedAddress,
  isLocalAddress,
  isPlainHttp,
  needsUnencryptedWarning,
  stripTrailingSlash,
} from '@/ai/address';
import {
  findAgreement,
  hasAgreement,
  isNoticeDue,
  withAgreement,
  withoutAgreement,
} from '@/ai/agreements';
import type { AiAgreement } from '@/rpc/types';

describe('isLocalAddress', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://LOCALHOST/v1',
    'https://LocalHost:8443',
    'http://127.0.0.1:8080/v1',
    'http://127.1.2.3/v1',
    'http://127.255.255.255:1/',
    'http://[::1]:11434/v1',
    'http://[::1]/v1',
    'http://user:secret@localhost:11434/v1',
  ])('%s is local', (address) => {
    expect(isLocalAddress(address)).toBe(true);
    expect(isHostedAddress(address)).toBe(false);
  });

  it.each([
    'https://api.openai.com/v1',
    'http://my-pc.lan:8080/v1',
    'http://192.0.2.10:11434/v1',
    'http://10.0.0.5/v1',
    'http://0.0.0.0:11434/v1',
    'http://[::]:11434/v1',
    'http://[::ffff:127.0.0.1]/v1',
    'http://ollama.localhost:11434/v1',
    'http://localhost.example.com/v1',
    'http://127.0.0.256/v1',
    'http://1270.0.0.1/v1',
    'http://127.0.0/v1',
    'http://128.0.0.1/v1',
    'not an address',
    '',
  ])('%s is hosted', (address) => {
    expect(isLocalAddress(address)).toBe(false);
    expect(isHostedAddress(address)).toBe(true);
  });
});

describe('hostOf / hostNameOf', () => {
  it('answers the authority as written, without user information', () => {
    expect(hostOf('https://api.openai.com/v1')).toBe('api.openai.com');
    expect(hostOf('http://My-PC.lan:8080/v1/')).toBe('My-PC.lan:8080');
    expect(hostOf('http://[::1]:11434/v1')).toBe('[::1]:11434');
    expect(hostOf('http://user:secret@localhost:11434/v1')).toBe('localhost:11434');
    expect(hostOf('http://host?x=1')).toBe('host');
    expect(hostOf('http://host#frag')).toBe('host');
    expect(hostOf('  http://host/  ')).toBe('host');
    expect(hostOf('localhost:11434')).toBe(''); // no scheme: no authority
    expect(hostOf('')).toBe('');
  });

  it('reduces the host to its name: brackets and port removed, ASCII lower-cased', () => {
    expect(hostNameOf('http://My-PC.lan:8080/v1')).toBe('my-pc.lan');
    expect(hostNameOf('http://[::1]:11434/v1')).toBe('::1');
    expect(hostNameOf('http://[2001:DB8::1]/v1')).toBe('2001:db8::1');
    expect(hostNameOf('http://LOCALHOST')).toBe('localhost');
    expect(hostNameOf('http://127.0.0.1:')).toBe('127.0.0.1');
    expect(hostNameOf('http://Пример.рф/v1')).toBe('пример.рф');
  });
});

describe('isPlainHttp / needsUnencryptedWarning', () => {
  it('warns for plain http that is not local', () => {
    expect(isPlainHttp('http://my-pc.lan/v1')).toBe(true);
    expect(isPlainHttp('HTTP://my-pc.lan/v1')).toBe(true);
    expect(isPlainHttp('https://my-pc.lan/v1')).toBe(false);
    expect(isPlainHttp('ftp://my-pc.lan/v1')).toBe(false);
    expect(needsUnencryptedWarning('http://my-pc.lan/v1')).toBe(true);
    expect(needsUnencryptedWarning('http://192.0.2.10:11434/v1')).toBe(true);
    expect(needsUnencryptedWarning('http://localhost:11434/v1')).toBe(false);
    expect(needsUnencryptedWarning('http://127.0.0.1:11434/v1')).toBe(false);
    expect(needsUnencryptedWarning('http://[::1]:11434/v1')).toBe(false);
    expect(needsUnencryptedWarning('https://api.openai.com/v1')).toBe(false);
  });
});

describe('stripTrailingSlash / agreementKey', () => {
  it('removes trailing slashes only and keys agreements by id or stored address', () => {
    expect(stripTrailingSlash('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1');
    expect(stripTrailingSlash('https://api.openai.com/v1///')).toBe('https://api.openai.com/v1');
    expect(stripTrailingSlash('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
    expect(agreementKey({ kind: 'free', id: 'ovhcloud' })).toBe('ovhcloud');
    expect(agreementKey({ kind: 'custom', address: 'http://My-PC.lan:8080/v1/' })).toBe(
      'custom:http://My-PC.lan:8080/v1/', // as stored, not normalised
    );
  });
});

describe('agreements (data-model §2.3)', () => {
  const agreements: AiAgreement[] = [
    {
      service: 'ovhcloud',
      host: 'oai.endpoints.kepler.ai.cloud.ovh.net',
      at: '2026-10-22T10:00:00Z',
    },
    {
      service: 'custom:https://api.openai.com/v1',
      host: 'api.openai.com',
      at: '2026-10-22T11:00:00Z',
    },
  ];

  it('is due for a hosted target without an agreement for its key and current host', () => {
    expect(
      isNoticeDue(
        agreements,
        { kind: 'free', id: 'pollinations' },
        'https://text.pollinations.ai/openai',
      ),
    ).toBe(true);
    expect(
      isNoticeDue(
        agreements,
        { kind: 'free', id: 'ovhcloud' },
        'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
      ),
    ).toBe(false);
    // A user list entry redirecting the bundled id to another host asks again (review B4).
    expect(
      isNoticeDue(agreements, { kind: 'free', id: 'ovhcloud' }, 'https://proxy.example.net/v1'),
    ).toBe(true);
    // The custom target by its stored address and host.
    const custom = { kind: 'custom', address: 'https://api.openai.com/v1' } as const;
    expect(isNoticeDue(agreements, custom, 'https://api.openai.com/v1')).toBe(false);
    expect(isNoticeDue(agreements, custom, 'https://api.openai.com:8443/v1')).toBe(true); // port is part of the host
    // A local address never asks, agreement or not.
    expect(
      isNoticeDue(
        [],
        { kind: 'custom', address: 'http://localhost:11434/v1' },
        'http://localhost:11434/v1',
      ),
    ).toBe(false);
    expect(isNoticeDue([], { kind: 'free', id: 'standin' }, 'http://127.0.0.1:4242')).toBe(false);
    // The host comparison is exact: `hasAgreement` matches key and host together.
    expect(hasAgreement(agreements, 'ovhcloud', 'oai.endpoints.kepler.ai.cloud.ovh.net')).toBe(
      true,
    );
    expect(hasAgreement(agreements, 'ovhcloud', 'other.host')).toBe(false);
    expect(hasAgreement(agreements, 'kilo', 'oai.endpoints.kepler.ai.cloud.ovh.net')).toBe(false);
    expect(findAgreement(agreements, 'ovhcloud')?.at).toBe('2026-10-22T10:00:00Z');
    expect(findAgreement(agreements, 'kilo')).toBeUndefined();
  });

  it('appends, replaces the entry of the same service in place and withdraws', () => {
    const added = withAgreement(agreements, 'kilo', 'ai-gateway.kilo.ai', '2026-10-23T00:00:00Z');
    expect(added).toHaveLength(3);
    expect(added[2]).toEqual({
      service: 'kilo',
      host: 'ai-gateway.kilo.ai',
      at: '2026-10-23T00:00:00Z',
    });
    expect(agreements).toHaveLength(2); // the input is untouched

    const replaced = withAgreement(
      agreements,
      'ovhcloud',
      'proxy.example.net',
      '2026-10-24T00:00:00Z',
    );
    expect(replaced).toHaveLength(2);
    expect(replaced[0]).toEqual({
      service: 'ovhcloud',
      host: 'proxy.example.net',
      at: '2026-10-24T00:00:00Z',
    });
    expect(replaced[1]).toBe(agreements[1]);

    const withdrawn = withoutAgreement(agreements, 'ovhcloud');
    expect(withdrawn).toEqual([agreements[1]]);
    expect(withoutAgreement(agreements, 'nobody')).toEqual(agreements);

    // A fresh `at` when none is given: ISO 8601 UTC.
    const now = withAgreement([], 'llm7', 'api.llm7.io');
    expect(now[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });
});
