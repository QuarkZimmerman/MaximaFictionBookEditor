/**
 * Feature 012 (US2; D17, D23, D28; contracts/epub-import.md §1, §5): the package document of an EPUB
 * of any version up to 3.3 - EPUB 2.0/2.0.1 (and packages without a version, read as OEBPS 1.2), EPUB
 * 3.0-3.3 and EPUB 3.1 - read into one shape: the metadata in both forms (DC elements with OPF 2's
 * `opf:` attributes or EPUB 3's `refines`, OPF 2 `meta` such as Calibre's series and the cover), the
 * manifest, the spine and the guide.
 */

const DC = 'http://purl.org/dc/elements/1.1/';
const OPF = 'http://www.idpf.org/2007/opf';

export interface PackagePerson {
  name: string;
  fileAs?: string;
  /** A MARC relator code ('aut', 'trl', 'ill', ...), when the package gives one. */
  role?: string;
}

export interface ManifestItem {
  id: string;
  /** The full path inside the container. */
  path: string;
  mediaType: string;
  properties: string[];
  fallback?: string;
}

export interface PackageMetadata {
  titles: string[];
  creators: PackagePerson[];
  contributors: PackagePerson[];
  languages: string[];
  subjects: string[];
  description?: string;
  date?: string;
  publisher?: string;
  identifiers: string[];
  rights?: string;
  series: { name: string; number?: number }[];
  /** The editor's own description (D7, research DP-9). */
  mfbeDescription?: string;
  /** D27: fixed-layout pages (`rendition:layout` `pre-paginated`), whose positions are not kept. */
  fixedLayout: boolean;
  /** What the package holds that has no FB2 field (D28: listed). */
  unmapped: string[];
}

export interface EpubPackage {
  version: string;
  metadata: PackageMetadata;
  manifest: Map<string, ManifestItem>;
  spine: { item: ManifestItem; linear: boolean }[];
  guide: { type: string; path: string }[];
  nav?: ManifestItem;
  ncx?: ManifestItem;
  coverImage?: ManifestItem;
}

/** The folder of a path inside the container, with its separator. */
export function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/** A reference (URL-encoded, relative to `from`) as a path inside the container; '' outside it. */
export function resolvePath(from: string, href: string): string {
  let decoded = href.split('#')[0]!.split('?')[0]!;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // a broken escape is taken as written
  }
  if (decoded === '' || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) return '';
  const parts = (decoded.startsWith('/') ? decoded.slice(1) : folderOf(from) + decoded).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (out.length === 0) return '';
      out.pop();
    } else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

function textOf(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function children(parent: Element | null | undefined, local: string): Element[] {
  if (!parent) return [];
  return Array.from(parent.children).filter((child) => child.localName === local);
}

/** Reads the package document at `path`. Throws when it is not XML. */
export function readPackage(xml: string, path: string): EpubPackage {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) {
    throw new Error('the package document is not well-formed XML');
  }
  const root = doc.documentElement;
  const version = root.getAttribute('version') ?? '';
  const metadataElement =
    children(root, 'metadata')[0] ??
    // OEBPS 1.2 nests the DC elements in dc-metadata.
    root.getElementsByTagName('metadata')[0];
  const all = metadataElement ? Array.from(metadataElement.getElementsByTagName('*')) : [];
  const dc = (local: string): Element[] =>
    all.filter(
      (element) =>
        element.localName === local && (element.namespaceURI === DC || element.prefix === 'dc'),
    );
  const metas = all.filter((element) => element.localName === 'meta');
  const refines = new Map<string, Map<string, string>>();
  for (const meta of metas) {
    const target = meta.getAttribute('refines');
    const property = meta.getAttribute('property');
    if (!target?.startsWith('#') || !property) continue;
    const id = target.slice(1);
    if (!refines.has(id)) refines.set(id, new Map());
    const map = refines.get(id)!;
    if (!map.has(property)) map.set(property, textOf(meta));
  }
  const refined = (element: Element, property: string): string | undefined => {
    const id = element.getAttribute('id');
    return id ? refines.get(id)?.get(property) : undefined;
  };
  const opfAttr = (element: Element, name: string): string | undefined =>
    element.getAttributeNS(OPF, name) ??
    element.getAttribute(`opf:${name}`) ??
    element.getAttribute(name) ??
    undefined;
  const person = (element: Element): PackagePerson => ({
    name: textOf(element),
    fileAs: refined(element, 'file-as') ?? opfAttr(element, 'file-as') ?? undefined,
    role:
      (refined(element, 'role') ?? opfAttr(element, 'role') ?? undefined)?.trim().toLowerCase() ||
      undefined,
  });
  const oldMeta = (name: string): string | undefined =>
    metas.find((meta) => meta.getAttribute('name') === name)?.getAttribute('content') ?? undefined;

  const titles = dc('title')
    .map((title) => ({ text: textOf(title), type: refined(title, 'title-type') }))
    .filter((title) => title.text);
  const mainTitle = titles.find((title) => !title.type || title.type === 'main') ?? titles[0];
  const series: PackageMetadata['series'] = [];
  for (const meta of metas) {
    if (meta.getAttribute('property') !== 'belongs-to-collection') continue;
    const id = meta.getAttribute('id');
    const type = id ? refines.get(id)?.get('collection-type') : undefined;
    if (type && type !== 'series') continue;
    const position = id ? Number(refines.get(id)?.get('group-position')) : NaN;
    series.push({
      name: textOf(meta),
      number: Number.isFinite(position) && position > 0 ? position : undefined,
    });
  }
  const calibreSeries = oldMeta('calibre:series');
  if (calibreSeries && !series.some((one) => one.name === calibreSeries)) {
    const index = Number(oldMeta('calibre:series_index'));
    series.push({
      name: calibreSeries,
      number: Number.isFinite(index) && index > 0 ? index : undefined,
    });
  }
  const unmapped: string[] = [];
  for (const title of titles) if (title !== mainTitle) unmapped.push(`title: ${title.text}`);
  for (const meta of metas) {
    const name = meta.getAttribute('name') ?? meta.getAttribute('property') ?? '';
    if (/^calibre:(rating|timestamp|title_sort|author_link_map|user_metadata)/.test(name))
      unmapped.push(name);
  }
  const metadata: PackageMetadata = {
    titles: mainTitle ? [mainTitle.text] : [],
    creators: dc('creator')
      .map(person)
      .filter((one) => one.name),
    contributors: dc('contributor')
      .map(person)
      .filter((one) => one.name),
    languages: dc('language').map(textOf).filter(Boolean),
    subjects: dc('subject').map(textOf).filter(Boolean),
    description: dc('description')
      .map((element) => element.textContent ?? '')
      .find((text) => text.trim()),
    date: dc('date').map(textOf).find(Boolean),
    publisher: dc('publisher').map(textOf).find(Boolean),
    identifiers: dc('identifier').map(textOf).filter(Boolean),
    rights: dc('rights').map(textOf).find(Boolean),
    series,
    fixedLayout: metas.some(
      (meta) =>
        meta.getAttribute('property') === 'rendition:layout' && textOf(meta) === 'pre-paginated',
    ),
    mfbeDescription:
      metas.find((meta) => meta.getAttribute('property') === 'mfbe:fb2-description')?.textContent ??
      undefined,
    unmapped,
  };

  const packageFolder = path;
  const manifest = new Map<string, ManifestItem>();
  for (const element of children(children(root, 'manifest')[0], 'item')) {
    const id = element.getAttribute('id') ?? '';
    const itemPath = resolvePath(packageFolder, element.getAttribute('href') ?? '');
    if (!id || !itemPath) continue;
    manifest.set(id, {
      id,
      path: itemPath,
      mediaType: (element.getAttribute('media-type') ?? '').toLowerCase(),
      properties: (element.getAttribute('properties') ?? '').split(/\s+/).filter(Boolean),
      fallback: element.getAttribute('fallback') ?? undefined,
    });
  }
  const spineElement = children(root, 'spine')[0];
  const spine: EpubPackage['spine'] = [];
  for (const element of children(spineElement, 'itemref')) {
    const item = manifest.get(element.getAttribute('idref') ?? '');
    if (item) spine.push({ item, linear: element.getAttribute('linear') !== 'no' });
  }
  const guide = children(children(root, 'guide')[0], 'reference')
    .map((element) => ({
      type: (element.getAttribute('type') ?? '').toLowerCase(),
      path: resolvePath(packageFolder, element.getAttribute('href') ?? ''),
    }))
    .filter((reference) => reference.path);
  const items = [...manifest.values()];
  const nav = items.find((item) => item.properties.includes('nav'));
  const ncx =
    manifest.get(spineElement?.getAttribute('toc') ?? '') ??
    items.find((item) => item.mediaType === 'application/x-dtbncx+xml');
  const coverId = oldMeta('cover');
  const coverImage =
    items.find((item) => item.properties.includes('cover-image')) ??
    (coverId ? manifest.get(coverId) : undefined);
  return {
    version,
    metadata,
    manifest,
    spine,
    guide,
    nav,
    ncx,
    coverImage: coverImage && coverImage.mediaType.startsWith('image/') ? coverImage : undefined,
  };
}

export interface NavEntry {
  label: string;
  path: string;
  fragment: string;
  depth: number;
}

/** The table of contents: EPUB 3's navigation document, else EPUB 2's NCX (flattened, in order). */
export function readNavigation(xml: string, path: string, ncx: boolean): NavEntry[] {
  const doc = new DOMParser().parseFromString(
    xml,
    ncx ? 'application/xml' : 'application/xhtml+xml',
  );
  if (doc.getElementsByTagName('parsererror').length > 0) return [];
  const entries: NavEntry[] = [];
  const add = (label: string, href: string, depth: number): void => {
    const target = resolvePath(path, href);
    if (!label || !target) return;
    entries.push({
      label,
      path: target,
      fragment: href.includes('#') ? href.slice(href.indexOf('#') + 1) : '',
      depth,
    });
  };
  if (ncx) {
    const walk = (parent: Element, depth: number): void => {
      for (const point of children(parent, 'navPoint')) {
        const label = textOf(point.getElementsByTagName('text')[0] ?? point);
        add(label, point.getElementsByTagName('content')[0]?.getAttribute('src') ?? '', depth);
        walk(point, depth + 1);
      }
    };
    const map = doc.getElementsByTagName('navMap')[0];
    if (map) walk(map, 1);
    return entries;
  }
  const toc = Array.from(doc.getElementsByTagName('nav')).find((nav) =>
    (
      nav.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ??
      nav.getAttribute('epub:type') ??
      ''
    )
      .split(/\s+/)
      .includes('toc'),
  );
  const walk = (list: Element | undefined, depth: number): void => {
    for (const item of children(list, 'li')) {
      const anchor = children(item, 'a')[0] ?? children(item, 'span')[0];
      if (anchor) add(textOf(anchor), anchor.getAttribute('href') ?? '', depth);
      walk(children(item, 'ol')[0], depth + 1);
    }
  };
  walk(toc ? children(toc, 'ol')[0] : undefined, 1);
  return entries;
}
