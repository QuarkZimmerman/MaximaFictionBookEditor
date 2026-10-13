/**
 * T151 security review - the script sandbox exposes exactly the contract allow-list.
 *
 * The declaration file `docs/scripting/mfbe.d.ts` (a copy of contracts/script-api.d.ts, the
 * complete allow-list of Constitution V) is parsed with the TypeScript compiler API and
 * compared, member by member, with what a script can actually reach:
 *  - the `mfbe` object built by the worker bootstrap (`createMfbe`),
 *  - the globals the bootstrap defines next to it (`mfbe` and the legacy façade functions),
 *  - the host's method table (`API_METHODS`, the only names the host answers),
 *  - the list of globals scrubbed before user code runs (script-manifest.md §3).
 * Widening any of these without the contract is a test failure, not a silent capability gain.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  BLOCKED_GLOBALS,
  BLOCKED_MEMBERS,
  createBridge,
  createMfbe,
  scrubGlobals,
  type PortLike,
} from '@/scripting/sandbox';
import { API_METHODS } from '@/scripting/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_FILE = path.resolve(HERE, '../../../../docs/scripting/mfbe.d.ts');
const WORKER_FILE = path.resolve(HERE, '../../../src/scripting/sandbox.worker.ts');
const API_IMPL_FILE = path.resolve(HERE, '../../../src/scripting/api-impl.ts');

/**
 * script-manifest.md §3 rule 1: globals removed before user code executes, and the ones that
 * explicitly remain. `MessageChannel` is listed with "(except the host's own port)": the port is
 * held in a closure, the constructor itself is removed.
 */
const CONTRACT_BLOCKED = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'indexedDB',
  'caches',
  'navigator',
  'BroadcastChannel',
  'MessageChannel',
  'OffscreenCanvas',
];
const CONTRACT_BLOCKED_MEMBERS: [string, string][] = [['Performance', 'memory']];
const CONTRACT_KEPT = ['setTimeout', 'clearTimeout', 'queueMicrotask', 'console'];

interface ContractSurface {
  /** `const <name>: <Type>` declarations of the namespace, in source order. */
  consts: { name: string; type: string }[];
  /** `function <name>(...)` declarations of the namespace. */
  functions: string[];
  /** interface name -> member names (methods and properties). */
  interfaces: Map<string, { methods: string[]; properties: string[] }>;
}

/** Reads the `declare namespace mfbe { ... }` block of the declaration file. */
function parseContract(file: string): ContractSurface {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const surface: ContractSurface = { consts: [], functions: [], interfaces: new Map() };
  let namespaceFound = false;

  const visitNamespaceMember = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node)) {
      const methods: string[] = [];
      const properties: string[] = [];
      for (const member of node.members) {
        if (!member.name) continue;
        const name = member.name.getText(source);
        if (ts.isMethodSignature(member)) methods.push(name);
        else if (ts.isPropertySignature(member)) {
          // A property typed as a function (`readonly symbols: () => Promise<...>`) is callable
          // for a script and therefore an API method, not a value.
          if (member.type && ts.isFunctionTypeNode(member.type)) methods.push(name);
          else properties.push(name);
        }
      }
      surface.interfaces.set(node.name.text, { methods, properties });
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        const type = declaration.type ? declaration.type.getText(source) : '';
        surface.consts.push({ name: declaration.name.getText(source), type });
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      surface.functions.push(node.name.text);
    }
  };

  ts.forEachChild(source, (node) => {
    if (ts.isModuleDeclaration(node) && node.name.getText(source) === 'mfbe' && node.body) {
      namespaceFound = true;
      if (ts.isModuleBlock(node.body)) node.body.statements.forEach(visitNamespaceMember);
    }
  });
  if (!namespaceFound) throw new Error(`${file}: "declare namespace mfbe" not found`);
  return surface;
}

class SilentPort implements PortLike {
  postMessage() {}
  addEventListener() {}
  start() {}
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe('script sandbox surface = contract allow-list (docs/scripting/mfbe.d.ts)', () => {
  const contract = parseContract(CONTRACT_FILE);
  const mfbe = createMfbe(createBridge(new SilentPort())) as unknown as Record<string, unknown>;

  it('parses the contract into the expected shape', () => {
    expect(contract.consts.map((c) => c.name)).toEqual([
      'doc',
      'selection',
      'ui',
      'edit',
      'env',
      'version',
    ]);
    expect(contract.functions).toEqual(['MsgBox', 'InputBox', 'BeginUndoUnit', 'EndUndoUnit']);
    for (const name of ['Doc', 'Selection', 'UI', 'Edit', 'Env', 'Context']) {
      expect(contract.interfaces.has(name), name).toBe(true);
    }
  });

  it('the root object has exactly the contract consts and façade functions', () => {
    const expected = sorted([...contract.consts.map((c) => c.name), ...contract.functions]);
    expect(sorted(Object.keys(mfbe))).toEqual(expected);
    expect(Object.isFrozen(mfbe)).toBe(true);
    expect(mfbe.version).toBe(1);
    for (const name of contract.functions) {
      expect(typeof mfbe[name], name).toBe('function');
    }
  });

  it('every namespace object has exactly the members of its interface', () => {
    for (const { name, type } of contract.consts) {
      if (name === 'version') continue;
      const spec = contract.interfaces.get(type);
      expect(spec, `interface ${type} for mfbe.${name}`).toBeDefined();
      const object = mfbe[name] as Record<string, unknown>;
      expect(Object.isFrozen(object), `mfbe.${name} frozen`).toBe(true);
      expect(sorted(Object.keys(object)), `mfbe.${name}`).toEqual(
        sorted([...spec!.methods, ...spec!.properties]),
      );
      for (const method of spec!.methods) {
        expect(typeof object[method], `mfbe.${name}.${method}`).toBe('function');
      }
      for (const property of spec!.properties) {
        expect(typeof object[property], `mfbe.${name}.${property}`).not.toBe('function');
      }
    }
  });

  it('the host answers exactly the contract methods (API_METHODS) and nothing else', () => {
    const expected: string[] = [];
    for (const { name, type } of contract.consts) {
      const spec = contract.interfaces.get(type);
      if (!spec) continue;
      for (const method of spec.methods) expected.push(`${name}.${method}`);
    }
    expect(sorted(API_METHODS)).toEqual(sorted(expected));
    expect(new Set(API_METHODS).size).toBe(API_METHODS.length);

    // The host-side dispatch table lists the same names (api-impl.ts), so a method cannot be
    // reachable through one layer and missing in the other.
    const impl = readFileSync(API_IMPL_FILE, 'utf8');
    const tableStart = impl.indexOf('const table');
    expect(tableStart).toBeGreaterThan(0);
    const table = impl.slice(tableStart, impl.indexOf('};', tableStart));
    const keys = [...table.matchAll(/'((?:doc|selection|ui|edit|env)\.[A-Za-z]+)'\s*:/g)].map(
      (m) => m[1]!,
    );
    expect(sorted(keys)).toEqual(sorted(expected));
    expect(impl).toContain('unknown API method');
  });

  it('the bootstrap exposes only mfbe and the façade functions as globals', () => {
    const worker = readFileSync(WORKER_FILE, 'utf8');
    const exposed = [...worker.matchAll(/expose\('([A-Za-z_$][\w$]*)'/g)].map((m) => m[1]!);
    expect(sorted(exposed)).toEqual(sorted(['mfbe', ...contract.functions]));
    // Non-writable, non-configurable definitions: a script cannot swap them for its own.
    expect(worker).toMatch(/writable:\s*false/);
    expect(worker).toMatch(/configurable:\s*false/);
    // The scrub runs before the entry module is imported and the port never leaves the closure.
    const dynamicImport = worker.indexOf('await import(');
    expect(dynamicImport).toBeGreaterThan(0);
    expect(worker.indexOf('scrubGlobals(self)')).toBeLessThan(dynamicImport);
    expect(worker).not.toMatch(/expose\('port'/);
  });

  it('the scrub list covers script-manifest.md §3 and keeps what the contract keeps', () => {
    for (const name of CONTRACT_BLOCKED) expect(BLOCKED_GLOBALS, name).toContain(name);
    for (const [owner, member] of CONTRACT_BLOCKED_MEMBERS) {
      expect(
        BLOCKED_MEMBERS.some(([o, m]) => o === owner && m === member),
        `${owner}.${member}`,
      ).toBe(true);
    }
    // The worker's own messaging surface is removed too (the bridge holds the private port).
    for (const name of ['postMessage', 'onmessage', 'close']) {
      expect(BLOCKED_GLOBALS, name).toContain(name);
    }
    for (const name of CONTRACT_KEPT) expect(BLOCKED_GLOBALS, name).not.toContain(name);
    // Standard built-ins the contract promises (String, RegExp, JSON, Promise, ...) stay.
    for (const name of ['JSON', 'Promise', 'RegExp', 'Math', 'Intl', 'Date', 'Map', 'Array']) {
      expect(BLOCKED_GLOBALS, name).not.toContain(name);
    }
  });

  it('scrubGlobals removes every blocked name from a realistic worker scope', () => {
    // A stand-in for DedicatedWorkerGlobalScope: dangerous members on the prototype chain
    // (as in Chromium) and as own properties, the kept members as own properties.
    const workerProto: Record<string, unknown> = {};
    for (const name of BLOCKED_GLOBALS.slice(0, Math.ceil(BLOCKED_GLOBALS.length / 2))) {
      Object.defineProperty(workerProto, name, { value: () => name, configurable: true });
    }
    const scope = Object.create(workerProto) as Record<string, unknown>;
    for (const name of BLOCKED_GLOBALS.slice(Math.ceil(BLOCKED_GLOBALS.length / 2))) {
      scope[name] = () => name;
    }
    function Performance() {}
    Object.defineProperty(Performance.prototype, 'memory', { get: () => ({}), configurable: true });
    scope.Performance = Performance;
    scope.performance = new (Performance as unknown as new () => object)();
    for (const name of CONTRACT_KEPT) scope[name] = {};

    expect(scrubGlobals(scope)).toEqual([]);
    for (const name of BLOCKED_GLOBALS) {
      expect(scope[name], name).toBeUndefined();
      expect(name in workerProto, `${name} on the prototype`).toBe(false);
      const descriptor = Object.getOwnPropertyDescriptor(scope, name);
      expect(descriptor?.writable, `${name} pinned`).toBe(false);
      expect(descriptor?.configurable, `${name} pinned`).toBe(false);
    }
    expect((scope.performance as { memory?: unknown }).memory).toBeUndefined();
    for (const name of CONTRACT_KEPT) expect(scope[name], name).toBeDefined();
  });
});
