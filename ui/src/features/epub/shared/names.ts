/**
 * Feature 012 (D13; contracts/epub-export.md, research DP-6): names of the files inside an EPUB.
 * EPUB 3.3 §6.1.5 allows most of Unicode, but the export writes plain ASCII names - letters, digits,
 * "-", "_" and "." - made from the book's ids, distinct without regard to letter case, so that every
 * reading system and every ZIP tool handles them. The core checks them again (epub::valid_name).
 */

/** A safe stem from any text: other characters become "_", runs collapse, never empty or dotted at the end. */
export function safeStem(text: string): string {
  const stem = text
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '');
  return stem.length > 0 ? stem.slice(0, 120) : 'file';
}

/** Hands out names that differ from every earlier one without regard to letter case. */
export class NameAllocator {
  private readonly used = new Set<string>();

  /** `folder/stem.ext`, with "-2", "-3", ... added to the stem when the name is taken. */
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

  /** Marks a fixed name as taken (the package, the navigation, the stylesheet, ...). */
  reserve(name: string): void {
    this.used.add(name.toLowerCase());
  }
}
