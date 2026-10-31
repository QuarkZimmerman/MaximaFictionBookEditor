// The part of FictionBook Editor's HTML page that the "Текст-корректор" and "Кириллица-латиница"
// scripts of FictionBook Editor 2.7.9 read and write, rebuilt over the editor's document model
// (byte-identical copies in the packages that use it).
//
// The page's fbw_body held a div for the title-info annotation, one for the document-info history
// (both always there, with an empty <p> when the book had none) and one per body; every text block
// was a <P> (class subtitle, text-author - a <date> too -, td or th; a verse or a paragraph had no
// class, an empty line was an empty <P>). The scripts walked those <P>, read and wrote their
// innerHTML and innerText, looked at the class of the parent, wrapped words in <LABEL> to show and
// replace them, and appended lines to the history. FbePage gives them those members: innerHTML is
// the block in the HTML notation of lib/legacy-html.js (the IE notation the scripts' expressions
// were written for), and what they wrote is parsed back and written to the book by commit().
import { decodeEntities, parseInline, serializeInline, TEXT_BLOCK_TYPES } from './legacy-html.js';

// The page's <div> of each structural node, by FB2 element (the class of the div).
const DIV_TYPES = new Set(['body', 'section', 'title', 'epigraph', 'annotation', 'cite', 'poem', 'stanza', 'table', 'tr', 'image']);
// The <P> class of each text block.
const P_CLASS = { p: '', v: '', subtitle: 'subtitle', 'text-author': 'text-author', date: 'text-author', td: 'td', th: 'th', 'empty-line': '' };
// Where an empty <P> was saved as <empty-line/>: the containers that take one.
const EMPTY_LINE_PARENTS = new Set(['section', 'title', 'epigraph', 'annotation', 'cite', 'history']);

const style = Object.freeze({ removeAttribute() {} });

// An inline picture on the page: <SPAN class=image contentEditable=false href="#id"><IMG
// src="fbw-internal:#id"></SPAN>, a span holding the image (lib/legacy-html.js writes <IMG href=...>).
const IMG_RE = /<IMG href="([^"]*)"((?: alt="[^"]*")?)>/g;
const PAGE_IMG_RE = /<SPAN class=image contentEditable=false href="([^"]*)"><IMG src="fbw-internal:[^"]*"><\/SPAN>/g;

/** The block's notation with the page's form of inline pictures; `alts` keeps their alt text. */
function toPage(html, alts) {
  return html.replace(IMG_RE, (all, href, alt) => {
    alts.push(alt);
    return `<SPAN class=image contentEditable=false href="${href}"><IMG src="fbw-internal:${href}"></SPAN>`;
  });
}

/** Back to the notation of lib/legacy-html.js (the n-th picture gets the n-th alt text). */
function fromPage(html, alts) {
  let n = 0;
  return html.replace(PAGE_IMG_RE, (all, href) => `<IMG href="${href}"${alts[n++] ?? ''}>`);
}

/** A <LABEL> the scripts put around a word to show and replace it. */
class Label {
  constructor(para, index, html) {
    this.para = para;
    this.index = index;
    this.html = html;
    this.removed = false;
    this.style = { removeAttribute() {} };
  }

  get innerHTML() {
    return this.html;
  }

  set innerHTML(value) {
    this.html = String(value);
  }

  /** removeNode(false): the label goes, its content stays. */
  removeNode() {
    this.removed = true;
  }
}

/** A <P> of the page. */
export class Para {
  constructor(page, node, parent, region) {
    this.page = page;
    this.node = node;
    this.region = region;
    this.nodeName = 'P';
    this.parentNode = { className: parent };
    this.style = style;
    this.extras = [];
    this.alts = [];
    this.original = node ? toPage(serializeInline(node.content ?? [], this.extras), this.alts) : '';
    this.html = this.original;
    this.labels = null;
    this.labelText = null;
  }

  get className() {
    return this.node ? P_CLASS[this.node.type] ?? '' : '';
  }

  get innerHTML() {
    if (!this.labels) return this.html;
    let html = this.labelText[0];
    this.labels.forEach((label, i) => {
      html += (label.removed ? label.html : `<LABEL>${label.html}</LABEL>`) + this.labelText[i + 1];
    });
    return html;
  }

  set innerHTML(value) {
    this.html = String(value);
    this.labels = null;
  }

  get innerText() {
    return decodeEntities(this.innerHTML.replace(/<[^>]*>/g, ''));
  }

  /** The <LABEL> elements of the block (the only tag the scripts asked for). */
  getElementsByTagName(name) {
    if (String(name).toUpperCase() !== 'LABEL') return [];
    if (!this.labels) {
      const parts = this.html.split(/<LABEL>([\s\S]*?)<\/LABEL>/);
      this.labelText = parts.filter((_, i) => i % 2 === 0);
      this.labels = parts.filter((_, i) => i % 2 === 1).map((html, i) => new Label(this, i, html));
    }
    return this.labels.filter((label) => !label.removed);
  }

  get changed() {
    return this.innerHTML !== this.original;
  }
}

/** An <EM> or <STRONG> element of a <P>, with its text and the elements inside it. */
class InlineElement {
  constructor(tag) {
    this.tag = tag;
    this.text = '';
    this.children = [];
  }

  get innerText() {
    return this.text;
  }

  getElementsByTagName(name) {
    const tag = String(name).toUpperCase();
    const out = [];
    const visit = (el) => {
      for (const child of el.children) {
        if (child.tag === tag) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
}

/** The <EM> and <STRONG> elements of a <P>'s HTML, in document order (a closing tag ends the
 *  innermost open element of its kind). */
function inlineElements(html) {
  const all = [];
  const open = [];
  const re = /<(\/?)(EM|STRONG)\b[^>]*>|<[^>]*>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[2]) {
      const tag = m[2].toUpperCase();
      if (!m[1]) {
        const el = new InlineElement(tag);
        if (open.length) open[open.length - 1].children.push(el);
        open.push(el);
        all.push(el);
      } else {
        for (let k = open.length - 1; k >= 0; k -= 1) {
          if (open[k].tag === tag) {
            open.splice(k, 1);
            break;
          }
        }
      }
    } else if (m[3]) {
      const text = decodeEntities(m[3]);
      for (const el of open) el.text += text;
    }
  }
  return all;
}

/** A <div> of fbw_body: the annotation, the history or a body. */
class Region {
  constructor(page, className, node, fbname) {
    this.page = page;
    this.className = className;
    this.node = node;
    this.fbname = fbname;
    this.paras = [];
    this.appended = [];
    this.style = style;
  }

  getAttribute(name) {
    return name === 'fbname' ? this.fbname : null;
  }

  get nextSibling() {
    const regions = this.page.regions;
    return regions[regions.indexOf(this) + 1] ?? null;
  }

  getElementsByTagName(name) {
    return String(name).toUpperCase() === 'P' ? [...this.paras, ...this.appended] : [];
  }

  get innerText() {
    return this.getElementsByTagName('P')
      .map((p) => p.innerText)
      .join('\r\n');
  }

  get innerHTML() {
    return this.getElementsByTagName('P')
      .map((p) => `<P>${p.innerHTML}</P>`)
      .join('');
  }

  /** The last child of the div: its last <P>, or a block that is not one (a cite, a poem...). */
  get lastChild() {
    if (this.appended.length) return this.appended[this.appended.length - 1];
    const children = this.node?.content ?? [];
    const last = children[children.length - 1];
    if (!last) return this.paras[this.paras.length - 1] ?? null;
    const para = this.paras.find((p) => p.node === last);
    return para ?? { innerHTML: '<DIV></DIV>', style };
  }

  /** insertAdjacentElement("beforeEnd", <P>): a new line at the end of the div. */
  insertAdjacentElement(where, element) {
    element.region = this;
    this.appended.push(element);
    return element;
  }
}

export class FbePage {
  constructor(snapshot) {
    this.snapshot = snapshot;
    this.regions = [];
    this.paras = [];
    const description = snapshot.description;
    // The annotation and the history are always on the page; an absent one shows an empty <P>.
    this.annotation = this.region('annotation', description?.titleInfo?.annotation ?? null, '');
    this.history = this.region('history', description?.documentInfo?.history ?? null, '');
    for (const body of snapshot.bodies ?? []) this.region('body', body, body.attrs?.name ?? '');
  }

  region(className, node, fbname) {
    const region = new Region(this, className, node, fbname);
    this.regions.push(region);
    if (!node || !(node.content ?? []).length) {
      // The page showed an empty <P> for an absent or empty annotation or history.
      region.paras.push(new Para(this, null, className, region));
    } else {
      const visit = (n, parent) => {
        if (!n || n.type === 'text') return;
        if (TEXT_BLOCK_TYPES.includes(n.type) || n.type === 'empty-line') {
          const para = new Para(this, n, parent, region);
          region.paras.push(para);
          this.paras.push(para);
          return;
        }
        const cls = n === node ? className : DIV_TYPES.has(n.type) ? n.type : '';
        for (const child of n.content ?? []) visit(child, cls);
      };
      visit(node, className);
    }
    return region;
  }

  /** fbw_body: its children are the annotation, the history and the bodies. */
  get fbwBody() {
    return {
      children: this.regions,
      firstChild: this.regions[0] ?? null,
      style: { display: '' },
      // fbwBody.getElementsByTagName("EM" | "STRONG"): the formatting elements of the whole page.
      getElementsByTagName: (name) => {
        const tag = String(name).toUpperCase();
        return this.allParagraphs(true).flatMap((p) => inlineElements(p.innerHTML).filter((el) => el.tag === tag));
      },
    };
  }

  /** All <P> of fbw_body in document order (the history's when `withHistory`). */
  allParagraphs(withHistory) {
    return this.regions.filter((r) => withHistory || r.className !== 'history').flatMap((r) => r.getElementsByTagName('P'));
  }

  /** document.createElement("P"). */
  createParagraph() {
    return new Para(this, null, 'history', null);
  }

  /** The plain-text offset of a label in its block, for selecting it. */
  labelRange(label) {
    const para = label.para;
    const plain = (html) => decodeEntities(html.replace(/<IMG\b[^>]*>/gi, '￼').replace(/<[^>]*>/g, ''));
    let offset = plain(para.labelText[0]);
    for (let i = 0; i < label.index; i += 1) {
      offset += plain(para.labels[i].html) + plain(para.labelText[i + 1]);
    }
    return { nodeId: para.node?.attrs?.nodeId, from: offset, to: offset + plain(label.html).length, inBody: para.region?.className === 'body' };
  }

  /** The new content of a <P>; an emptied <P> was saved as <empty-line/> where one may stand. */
  static contentNode(para, parentType) {
    const content = parseInline(fromPage(para.innerHTML, para.alts), para.extras);
    const node = para.node;
    const type = node ? node.type : 'p';
    const blank = content.every((item) => item.type === 'text' && /^[\s ]*$/.test(item.text ?? ''));
    if ((type === 'p' || type === 'subtitle' || type === 'text-author' || type === 'empty-line') && blank && EMPTY_LINE_PARENTS.has(parentType)) {
      return { type: 'empty-line', attrs: {} };
    }
    const attrs = node ? { ...node.attrs } : {};
    return { type: type === 'empty-line' ? 'p' : type, attrs, content };
  }

  /**
   * Writes the changed <P> back: the bodies' with doc.replaceNode, the annotation's and the
   * history's (and the lines appended to the history) with doc.setDescription. `version` is the
   * document-info version when the script changed it. Returns the number of blocks written.
   */
  async commit(ctx, version) {
    let written = 0;
    const description = this.snapshot.description;
    let descriptionChanged = version !== undefined && version !== description?.documentInfo?.version;
    for (const region of this.regions) {
      const changed = region.paras.filter((p) => p.node && p.changed);
      if (region.className === 'body') {
        for (const para of changed) {
          const node = FbePage.contentNode(para, para.parentNode.className);
          await mfbe.doc.replaceNode({ nodeId: para.node.attrs.nodeId, type: para.node.type }, node);
          written += 1;
          if (written % 50 === 0) await mfbe.ui.progress(written, undefined, ctx.script.name);
          if (ctx.cancelled) return written;
        }
        continue;
      }
      // The description's annotation or history: edit the JSON in place.
      const extra = [...region.paras.filter((p) => !p.node && p.changed), ...region.appended.filter((p) => p.innerHTML !== '')];
      if (!changed.length && !extra.length) continue;
      descriptionChanged = true;
      for (const para of changed) {
        const node = FbePage.contentNode(para, para.parentNode.className);
        for (const key of Object.keys(para.node)) delete para.node[key];
        Object.assign(para.node, node);
        written += 1;
      }
      let target = region.node;
      if (!target) {
        target = { type: 'annotation', attrs: {}, content: [] };
        if (region.className === 'annotation') description.titleInfo.annotation = target;
        else description.documentInfo.history = target;
      }
      for (const para of extra) {
        target.content = [...(target.content ?? []), FbePage.contentNode(para, region.className)];
        written += 1;
      }
    }
    if (version !== undefined && description?.documentInfo) description.documentInfo.version = version;
    if (descriptionChanged) await mfbe.doc.setDescription(description);
    return written;
  }
}
