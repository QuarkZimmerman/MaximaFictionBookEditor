/**
 * Neutral shared ASCII file-name and XML NCName allocators used by EPUB and MOBI (feature 018 T013).
 */

export function safeStem(text: string): string {
  const stem = text
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '');
  return stem.length > 0 ? stem.slice(0, 120) : 'file';
}

export class NameAllocator {
  private readonly used = new Set<string>();

  allocate(folder: string, text: string, extension: string): string {
    const stem = safeStem(text);
    const ext = extension.replace(/^\./, '').toLowerCase();
    for (let n = 1; ; n++) {
      const name = `${folder}${stem}${n === 1 ? '' : `-${n}`}${ext ? `.${ext}` : ''}`;
      const key = name.toLowerCase();
      if (!this.used.has(key)) {
        this.used.add(key);
        return name;
      }
    }
  }

  reserve(name: string): void {
    this.used.add(name.toLowerCase());
  }
}

const NAME_START = /[A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF]/;
const NAME_REST = /[A-Za-z0-9_.\-\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF]/;

export function xmlName(value: string): string {
  let out = '';
  for (const ch of value) out += NAME_REST.test(ch) ? ch : '_';
  if (out.length === 0) return 'id';
  return NAME_START.test(out[0]!) ? out : `id_${out}`;
}

export class XmlNameAllocator {
  private readonly used = new Set<string>();

  allocate(wanted: string): string {
    const base = xmlName(wanted);
    let name = base;
    for (let n = 2; this.used.has(name); n++) name = `${base}_${n}`;
    this.used.add(name);
    return name;
  }
}
