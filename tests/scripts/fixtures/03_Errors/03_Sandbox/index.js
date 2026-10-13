// Reports every blocked capability that is still reachable (must be none).
export default async function run() {
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Worker',
    'SharedWorker', 'indexedDB', 'caches', 'navigator', 'BroadcastChannel', 'MessageChannel',
    'OffscreenCanvas', 'postMessage', 'window', 'document'];
  const reachable = [];
  for (const name of names) {
    let value;
    try { value = globalThis[name]; } catch { value = undefined; }
    if (value !== undefined) reachable.push(name);
  }
  try {
    if (typeof Object.getPrototypeOf(globalThis).fetch === 'function') reachable.push('proto.fetch');
  } catch { /* ignore */ }
  try {
    if (typeof performance !== 'undefined' && performance.memory) reachable.push('performance.memory');
  } catch { /* ignore */ }
  const [section] = await mfbe.doc.getElementsByTagName('section');
  await mfbe.doc.insertNode('append', section, {
    type: 'p', attrs: {}, content: [{ type: 'text', text: 'reachable: ' + (reachable.join(',') || 'none') }],
  });
}
