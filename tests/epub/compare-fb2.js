/*
 * Feature 012 (T063; D34; SC-013): a book against the same book exported to EPUB and imported again,
 * both as the editor saves them. Resolves to the differences outside D34's list, in words: [] when the
 * round trip gives the book back.
 *
 * Compared: the description, the stylesheets, and every body line by line - the text, the structure
 * (the chain of bodies, sections, titles, epigraphs, cites, poems, tables), the formatting, the named
 * styles, the links (an internal link by the text of its target), the notes, the table cells with
 * their attributes, the pictures by their bytes with their titles; then the pictures and the ids
 * themselves. D34's exceptions need no rule: the title page and the cover page never were text of
 * the FB2 book, an id the export renamed is compared by what it names, and pages D5 divided come
 * back joined.
 *
 * Runs in the browser (DOMParser): tests/e2e/us7-epub-round-trip.spec.ts evaluates this file's text in
 * the page. The file holds one function expression and nothing else.
 */
(async function compareFb2(originalText, againText) {
  const FB = 'http://www.gribuser.ru/xml/fictionbook/2.0';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'empty-line', 'td', 'th']);
  const ATTRIBUTES = ['name', 'style', 'align', 'valign', 'colspan', 'rowspan', 'value', 'number',
    'info-type', 'xml:lang', 'lang', 'match'];
  const differences = [];
  const parse = (text) => new DOMParser().parseFromString(text, 'application/xml');
  const original = parse(originalText);
  const again = parse(againText);
  for (const [doc, name] of [[original, 'the original'], [again, 'the book imported again']]) {
    if (doc.getElementsByTagName('parsererror').length > 0) differences.push(`${name} is not well-formed`);
  }
  if (differences.length > 0) return differences;

  // Pictures by their bytes: each distinct content gets a label, in the original's order.
  const labels = new Map();
  const binariesOf = (doc) =>
    new Map([...doc.getElementsByTagNameNS(FB, 'binary')].map((element) => [
      element.getAttribute('id'),
      (element.textContent || '').replace(/\s+/g, ''),
    ]));
  const originalBinaries = binariesOf(original);
  const againBinaries = binariesOf(again);
  for (const data of originalBinaries.values()) {
    if (!labels.has(data)) labels.set(data, `picture ${labels.size + 1}`);
  }

  const words = (value) => (value || '').replace(/\s+/g, ' ');
  const hrefOf = (element) => element.getAttributeNS(XLINK, 'href') || element.getAttribute('l:href') || '';

  /** The book as lines: its description, its stylesheets, its bodies. */
  function linesOf(doc, binaries) {
    const byId = new Map();
    for (const element of doc.getElementsByTagName('*')) {
      const id = element.getAttribute('id');
      if (id && element.localName !== 'binary') byId.set(id, element);
    }
    const target = (href) => {
      if (!href.startsWith('#')) return href;
      const element = byId.get(href.slice(1));
      return element ? `-> "${words(element.textContent).trim().slice(0, 40)}"` : `-> nothing (${href})`;
    };
    const picture = (href) => {
      const data = binaries.get(href.replace(/^#/, ''));
      if (data === undefined) return `no picture (${href})`;
      return labels.get(data) || 'a picture the original does not have';
    };
    const attributes = (element) =>
      ATTRIBUTES.filter((name) => element.getAttribute(name))
        .map((name) => ` ${name}="${element.getAttribute(name)}"`)
        .join('');
    const inline = (node) => {
      if (node.nodeType === 3 || node.nodeType === 4) return words(node.nodeValue);
      if (node.nodeType !== 1) return '';
      const name = node.localName;
      const inner = [...node.childNodes].map(inline).join('');
      if (name === 'a') {
        const kind = node.getAttribute('type') ? ` ${node.getAttribute('type')}` : '';
        return `[a${kind} ${target(hrefOf(node))}]${inner}[/a]`;
      }
      if (name === 'image') {
        const alt = node.getAttribute('alt') ? ` alt="${node.getAttribute('alt')}"` : '';
        return `[image ${picture(hrefOf(node))}${alt}]`;
      }
      return `[${name}${attributes(node)}]${inner}[/${name}]`;
    };
    const lines = { description: [], stylesheets: [], bodies: [] };
    const walk = (element, path, out) => {
      for (const child of element.children) {
        const name = child.localName;
        const here = `${path}/${name}${attributes(child)}`;
        if (name === 'image') {
          const title = child.getAttribute('title') ? ` title="${child.getAttribute('title')}"` : '';
          const alt = child.getAttribute('alt') ? ` alt="${child.getAttribute('alt')}"` : '';
          out.push(`${here}: ${picture(hrefOf(child))}${title}${alt}`);
        } else if (BLOCKS.has(name) || child.children.length === 0) {
          out.push(`${here}: ${[...child.childNodes].map(inline).join('').trim()}`);
        } else {
          walk(child, here, out);
        }
      }
    };
    const root = doc.documentElement;
    for (const child of root.children) {
      if (child.localName === 'description') walk(child, 'description', lines.description);
      else if (child.localName === 'stylesheet') {
        lines.stylesheets.push(`stylesheet ${child.getAttribute('type')}: ${words(child.textContent).trim()}`);
      } else if (child.localName === 'body') {
        walk(child, `body${attributes(child)}`, lines.bodies);
      }
    }
    return lines;
  }

  // A patience diff: lines unique on both sides anchor the alignment (their longest increasing run),
  // the stretches between anchors are diffed again, and what stays unmatched forms the hunks.
  const hunks = (a, b) => {
    const out = [];
    const diff = (aLo, aHi, bLo, bHi) => {
      while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
        aLo++;
        bLo++;
      }
      while (aHi > aLo && bHi > bLo && a[aHi - 1] === b[bHi - 1]) {
        aHi--;
        bHi--;
      }
      if (aLo === aHi && bLo === bHi) return;
      const count = (lines, lo, hi) => {
        const seen = new Map();
        for (let i = lo; i < hi; i++) seen.set(lines[i], seen.has(lines[i]) ? -1 : i);
        return seen;
      };
      const inA = count(a, aLo, aHi);
      const inB = count(b, bLo, bHi);
      const pairs = [];
      for (const [line, i] of inA) {
        const j = inB.get(line);
        if (i >= 0 && j !== undefined && j >= 0) pairs.push([i, j]);
      }
      pairs.sort((x, y) => x[0] - y[0]);
      // The longest run of pairs increasing on both sides (patience sorting).
      const tails = [];
      const back = new Array(pairs.length);
      for (let p = 0; p < pairs.length; p++) {
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (pairs[tails[mid]][1] < pairs[p][1]) lo = mid + 1;
          else hi = mid;
        }
        back[p] = lo > 0 ? tails[lo - 1] : -1;
        tails[lo] = p;
      }
      const anchors = [];
      for (let p = tails.length > 0 ? tails[tails.length - 1] : -1; p >= 0; p = back[p]) anchors.unshift(pairs[p]);
      if (anchors.length === 0) {
        out.push([aLo, aHi, bLo, bHi]);
        return;
      }
      let i = aLo;
      let j = bLo;
      for (const [ai, bj] of anchors) {
        diff(i, ai, j, bj);
        i = ai + 1;
        j = bj + 1;
      }
      diff(i, aHi, j, bHi);
    };
    diff(0, a.length, 0, b.length);
    return out;
  };
  const compare = (part, a, b) => {
    const found = hunks(a, b);
    for (const [aLo, aHi, bLo, bHi] of found.slice(0, 30)) {
      differences.push(
        `${part}: line ${aLo + 1} of the original (${aHi - aLo} line(s)) against line ${bLo + 1} ` +
          `of the book imported again (${bHi - bLo})`,
      );
      if (aHi - aLo === 1 && bHi - bLo === 1) {
        // One line against one: shown around its first difference, which may lie far into it.
        const x = a[aLo];
        const y = b[bLo];
        let at = 0;
        while (at < x.length && at < y.length && x[at] === y[at]) at++;
        const from = Math.max(0, at - 80);
        const cut = (line) => `${from > 0 ? '…' : ''}${line.slice(from, at + 120)}`;
        differences.push(`  - ${cut(x)}`, `  + ${cut(y)}`);
        continue;
      }
      for (let k = 0; k < Math.min(3, aHi - aLo); k++) differences.push(`  - ${a[aLo + k].slice(0, 240)}`);
      for (let k = 0; k < Math.min(3, bHi - bLo); k++) differences.push(`  + ${b[bLo + k].slice(0, 240)}`);
    }
    if (found.length > 30) differences.push(`${part}: ${found.length - 30} more difference(s)`);
  };
  const a = linesOf(original, originalBinaries);
  const b = linesOf(again, againBinaries);
  compare('description', a.description, b.description);
  compare('stylesheets', a.stylesheets, b.stylesheets);
  compare('bodies', a.bodies, b.bodies);

  // Every picture comes back byte for byte, and no other comes.
  const againContents = new Set(againBinaries.values());
  for (const [data, label] of labels) {
    if (!againContents.has(data)) differences.push(`${label} did not come back byte for byte`);
  }
  for (const data of againContents) {
    if (!labels.has(data)) differences.push('a picture the original does not have came in');
  }
  // Ids may be renamed (D34), not lost.
  const ids = (doc) => [...doc.getElementsByTagName('*')].filter(
    (element) => element.getAttribute('id') && element.localName !== 'binary').length;
  if (ids(again) < ids(original)) {
    differences.push(`ids: ${ids(original)} in the original, ${ids(again)} in the book imported again`);
  }
  return differences;
})
