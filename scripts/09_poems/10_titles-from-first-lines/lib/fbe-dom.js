// The page of FictionBook Editor 2.7.9 that the scripts of "Структура разделов" and "Стихи"
// converted from it walk and rewrite, emulated over the editor's document model (byte-identical
// copies in the packages that use it: 08/structure-cleanup, 09/unformat-all-poems,
// 09/unformat-poems-shallow, 09/subtitles-from-first-lines, 09/mark-poems-between-titles,
// 09/find-unmarked-poems).
//
// FictionBook Editor showed a book as HTML (files/fb2.xsl): `fbw_body` held a <DIV class=annotation>
// for the title-info annotation and a <DIV class=history> for the document-info history (both
// always there, an empty <P> when the book had none), then one <DIV class=body fbname=…> per body.
// Every structural element was a <DIV class=section|title|epigraph|annotation|cite|poem|stanza|
// table|tr>; a picture a <DIV onresizestart="return false" class=image contentEditable=false
// href="#id">; every text block a <P> - class subtitle, text-author (a <date> too), td or th; a
// paragraph and a verse had none; an empty line was an empty <P>. The originals walked those
// elements (parentNode, nextSibling, className, children...), moved them (insertAdjacentElement,
// removeNode), read and wrote the innerHTML of the <P> (in the inline notation of
// lib/legacy-html.js, inline pictures as <SPAN … class=image …><IMG src="fbw-internal:#id"></SPAN>)
// and, some of them, rewrote whole bodies through the innerHTML of a <DIV>, whose text IE wrote with
// a CRLF before every block tag and an empty <P> as <P>&nbsp;</P>.
//
// FbePage builds that tree from mfbe.doc.get(); FbeNode gives each element the members the
// originals used; page.bodyModels() and page.descriptionModel() turn the tree back into the
// model as FictionBook Editor saved it (main.js and FBDoc.cpp): a <P> holding nothing or only white
// space became an <empty-line/> - in a stanza a verse holding a space -, the other <P> a p (a v in
// a stanza), subtitle, text-author, td or th; an annotation or a history holding only empty lines
// was not written. Elements built from the book keep their node ids and the attributes the page
// did not show (xml:lang, a paragraph's style, a cell's spans and alignment...).
import { decodeEntities, parseInline, serializeInline } from './legacy-html.js';

const DIV_TYPES = new Set(['body', 'section', 'title', 'epigraph', 'annotation', 'cite', 'poem', 'stanza', 'table', 'tr']);
const P_CLASS = { p: '', v: '', subtitle: 'subtitle', 'text-author': 'text-author', date: 'text-author', td: 'td', th: 'th', 'empty-line': '' };
const PARAGRAPH_ATTRS = ['id', 'lang', 'style', 'unknownAttrs'];

/* ------------------------------------------------------------------------ */
/* Inline pictures in the page's notation                                   */
/* ------------------------------------------------------------------------ */

const IMG_RE = /<IMG href="([^"]*)"((?: alt="[^"]*")?)>/g;
const PAGE_IMG_RE = /<SPAN onresizestart="return false" class=image contentEditable=false href="([^"]*)"><IMG src="fbw-internal:[^"]*"><\/SPAN>/g;

/** lib/legacy-html.js notation -> the page's (inline pictures as FictionBook Editor wrote them). */
function toPage(html, alts) {
  return html.replace(IMG_RE, (all, href, alt) => {
    alts.push(alt);
    return `<SPAN onresizestart="return false" class=image contentEditable=false href="${href}"><IMG src="fbw-internal:${href}"></SPAN>`;
  });
}

/** The page's notation -> lib/legacy-html.js (the n-th picture gets the n-th alt text). */
function fromPage(html, alts) {
  let n = 0;
  return html.replace(PAGE_IMG_RE, (all, href) => `<IMG href="${href}"${alts[n++] ?? ''}>`);
}

/** An attribute as IE wrote it in innerHTML: bare when it needs no quotes. */
function attr(name, value) {
  const text = String(value);
  return /^[A-Za-z0-9_\-.:#]+$/.test(text) ? ` ${name}=${text}` : ` ${name}="${text.replace(/"/g, '&quot;')}"`;
}

/* ------------------------------------------------------------------------ */
/* Elements                                                                 */
/* ------------------------------------------------------------------------ */

export class FbeNode {
  constructor(page, nodeName, className = '') {
    this.page = page;
    this.nodeName = nodeName;
    this.className = className;
    this.childNodes = [];
    this.parentNode = null;
    /** The model node the element was built from (without its content), or null. */
    this.model = null;
    /** Attributes: id, fbname, and those of a picture (href, alt, title). */
    this.attrs = {};
    /** <P>: the inline content in the page's notation. */
    this.html = '';
    this.extras = [];
    this.alts = [];
    this.style = { removeAttribute() {}, set display(value) {}, get display() { return ''; } };
  }

  get tagName() {
    return this.nodeName;
  }

  get nodeType() {
    return 1;
  }

  get children() {
    return this.childNodes;
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get previousSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] : null;
  }

  get id() {
    return this.attrs.id ?? '';
  }

  getAttribute(name) {
    if (name === 'className' || name === 'class') return this.className || null;
    const value = this.attrs[name];
    return value === undefined ? null : value;
  }

  setAttribute(name, value) {
    if (name === 'className' || name === 'class') this.className = String(value);
    else this.attrs[name] = String(value);
  }

  removeAttribute(name) {
    if (name === 'className' || name === 'class') this.className = '';
    else delete this.attrs[name];
  }

  /** Detaches the element; without `deep` its children take its place. Returns the element. */
  removeNode(deep) {
    const parent = this.parentNode;
    if (!parent) return this;
    const siblings = parent.childNodes;
    const index = siblings.indexOf(this);
    if (deep) siblings.splice(index, 1);
    else {
      const children = this.childNodes;
      this.childNodes = [];
      for (const child of children) child.parentNode = parent;
      siblings.splice(index, 1, ...children);
    }
    this.parentNode = null;
    return this;
  }

  /** insertAdjacentElement("beforeBegin" | "afterBegin" | "beforeEnd" | "afterEnd", element). */
  insertAdjacentElement(where, element) {
    if (element.parentNode) element.removeNode(true);
    const place = String(where).toLowerCase();
    if (place === 'afterbegin' || place === 'beforeend') {
      element.parentNode = this;
      if (place === 'afterbegin') this.childNodes.unshift(element);
      else this.childNodes.push(element);
      return element;
    }
    const parent = this.parentNode;
    if (!parent) throw new Error('insertAdjacentElement: the element is not in the page');
    const index = parent.childNodes.indexOf(this);
    element.parentNode = parent;
    parent.childNodes.splice(place === 'beforebegin' ? index : index + 1, 0, element);
    return element;
  }

  /** cloneNode(false): the element with its class and attributes, without children. */
  cloneNode(deep) {
    const copy = new FbeNode(this.page, this.nodeName, this.className);
    copy.attrs = { ...this.attrs };
    copy.cloneOf = this;
    if (deep) {
      copy.html = this.html;
      copy.extras = this.extras;
      copy.alts = this.alts;
      for (const child of this.childNodes) {
        const c = child.cloneNode(true);
        c.parentNode = copy;
        copy.childNodes.push(c);
      }
    }
    return copy;
  }

  contains(other) {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  /** The descendants of a tag ("DIV", "P"), in document order (a static list). */
  getElementsByTagName(name) {
    const tag = String(name).toUpperCase();
    const out = [];
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (tag === '*' || child.nodeName === tag) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  get isImage() {
    return this.nodeName === 'DIV' && this.className === 'image';
  }

  get innerHTML() {
    if (this.nodeName === 'P') return this.html;
    if (this.isImage) return `<IMG src="fbw-internal:${this.attrs.href ?? ''}">`;
    if (this.raw) return `<SPAN class=unknown_element>${this.raw.attrs?.xml ?? ''}</SPAN>`;
    return this.childNodes.map((child) => `\r\n${child.outerHTML}`).join('');
  }

  set innerHTML(value) {
    if (this.nodeName === 'P') {
      // IE wrote a non-breaking space back as an entity.
      this.html = String(value).replace(/ /g, '&nbsp;');
      return;
    }
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    for (const child of parseBlocks(this.page, String(value))) {
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }

  get outerHTML() {
    if (this.nodeName === 'P') {
      let tag = '<P';
      if (this.className) tag += attr('class', this.className);
      if (this.attrs.id) tag += attr('id', this.attrs.id);
      return `${tag}>${this.html === '' ? '&nbsp;' : this.html}</P>`;
    }
    if (this.isImage) {
      let tag = `<DIV onresizestart="return false" class=image contentEditable=false href="${this.attrs.href ?? ''}"`;
      if (this.attrs.title) tag += attr('title', this.attrs.title);
      if (this.attrs.id) tag += attr('id', this.attrs.id);
      return `${tag}>${this.innerHTML}</DIV>`;
    }
    let tag = '<DIV';
    if (this.attrs.id === 'fbw_body') tag += ' id=fbw_body';
    else {
      if (this.className) tag += attr('class', this.className);
      if (this.className === 'body') tag += attr('fbname', this.attrs.fbname ?? '');
      if (this.attrs.id) tag += attr('id', this.attrs.id);
    }
    return `${tag}>${this.innerHTML}</DIV>`;
  }

  /** The text of the element (tags removed, entities decoded; pictures add nothing). */
  get innerText() {
    if (this.nodeName === 'P') return decodeEntities(this.html.replace(/<[^>]*>/g, ''));
    return this.getElementsByTagName('P')
      .map((p) => p.innerText)
      .join('\r\n');
  }
}

/* ------------------------------------------------------------------------ */
/* The page's HTML text back to elements (the innerHTML of a DIV)           */
/* ------------------------------------------------------------------------ */

function parseAttributes(text) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(text))) {
    const value = m[3] ?? m[4] ?? m[5];
    attrs[m[1].toLowerCase()] = value === undefined ? '' : decodeEntities(value);
  }
  return attrs;
}

/**
 * Elements from the HTML text the originals wrote into a DIV, built the way IE's parser did for
 * that text: a <DIV> or <P> closes the open <P>, a </DIV> closes the innermost open <DIV> (and the
 * <P> in it), what stands inside a <P> is its inline content as written.
 */
export function parseBlocks(page, html) {
  const top = [];
  const stack = [];
  let para = null;
  const add = (node) => {
    const parent = stack[stack.length - 1];
    if (parent) {
      node.parentNode = parent;
      parent.childNodes.push(node);
    } else top.push(node);
  };
  const closePara = () => {
    para = null;
  };
  const re = /<(\/?)(DIV|P)\b([^>]*)>|<[^>]*>|[^<]+/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[2]) {
      const closing = m[1] === '/';
      const tag = m[2].toUpperCase();
      if (tag === 'P') {
        if (closing) closePara();
        else {
          const attrs = parseAttributes(m[3]);
          para = new FbeNode(page, 'P', attrs.class ?? '');
          if (attrs.id) para.attrs.id = attrs.id;
          add(para);
        }
        continue;
      }
      closePara();
      if (closing) {
        stack.pop();
        continue;
      }
      const attrs = parseAttributes(m[3]);
      const div = new FbeNode(page, 'DIV', attrs.class ?? '');
      if (attrs.id) div.attrs.id = attrs.id;
      if (div.className === 'body' && attrs.fbname) div.attrs.fbname = attrs.fbname;
      if (div.className === 'image') {
        div.attrs.href = attrs.href ?? '';
        if (attrs.title) div.attrs.title = attrs.title;
      }
      add(div);
      if (div.className === 'image') {
        // The picture's <IMG> and its closing tag belong to it.
        const end = html.indexOf('</DIV>', re.lastIndex);
        re.lastIndex = end < 0 ? html.length : end + '</DIV>'.length;
        continue;
      }
      stack.push(div);
      continue;
    }
    const text = m[0];
    if (para) para.html += text.replace(/ /g, '&nbsp;');
    else if (/[^\s]/.test(text.replace(/&nbsp;/g, ''))) {
      // Text outside a paragraph: IE gave it a paragraph of its own.
      para = new FbeNode(page, 'P', '');
      para.html = text;
      add(para);
    }
  }
  return top;
}

/* ------------------------------------------------------------------------ */
/* The page                                                                 */
/* ------------------------------------------------------------------------ */

export class FbePage {
  constructor(snapshot) {
    this.snapshot = snapshot;
    this.fbwBody = new FbeNode(this, 'DIV', '');
    this.fbwBody.attrs.id = 'fbw_body';
    const description = snapshot.description ?? {};
    /** The document-info version; a script that raises it sets this. */
    this.version = description.documentInfo?.version ?? '';
    this.annotation = this.region('annotation', description.titleInfo?.annotation ?? null);
    this.history = this.region('history', description.documentInfo?.history ?? null);
    this.originalBodies = [];
    for (const body of snapshot.bodies ?? []) {
      const el = this.build(body);
      el.attrs.fbname = body.attrs?.name ?? '';
      this.fbwBody.insertAdjacentElement('beforeEnd', el);
      this.originalBodies.push(el);
    }
  }

  /** The DIV of the book annotation or the history: an empty <P> when the book has none. */
  region(className, node) {
    const div = node ? this.build(node) : new FbeNode(this, 'DIV', className);
    div.className = className;
    if (!div.childNodes.length) div.insertAdjacentElement('beforeEnd', new FbeNode(this, 'P', ''));
    this.fbwBody.insertAdjacentElement('beforeEnd', div);
    div.initialHTML = div.outerHTML;
    return div;
  }

  /** document.createElement("P" | "DIV"). */
  createElement(name) {
    return new FbeNode(this, String(name).toUpperCase(), '');
  }

  build(node) {
    const { content, ...model } = node;
    if (node.type === 'image') {
      const el = new FbeNode(this, 'DIV', 'image');
      el.model = model;
      el.attrs.href = node.attrs?.href ?? '';
      if (node.attrs?.title) el.attrs.title = node.attrs.title;
      if (node.attrs?.id) el.attrs.id = node.attrs.id;
      return el;
    }
    if (node.type === 'raw-xml') {
      const el = new FbeNode(this, 'DIV', 'unknown_element');
      el.model = model;
      el.raw = node;
      return el;
    }
    if (node.type in P_CLASS) {
      const el = new FbeNode(this, 'P', P_CLASS[node.type]);
      el.model = model;
      el.source = node;
      if (node.attrs?.id) el.attrs.id = node.attrs.id;
      el.html = node.type === 'empty-line' ? '' : toPage(serializeInline(content ?? [], el.extras), el.alts);
      el.initial = { html: el.html, className: el.className, id: el.attrs.id };
      return el;
    }
    const el = new FbeNode(this, 'DIV', DIV_TYPES.has(node.type) ? node.type : node.type);
    el.model = model;
    if (node.attrs?.id) el.attrs.id = node.attrs.id;
    for (const child of content ?? []) el.insertAdjacentElement('beforeEnd', this.build(child));
    return el;
  }

  /** The body DIVs on the page now, in order. */
  bodies() {
    return this.fbwBody.childNodes.filter((el) => el.className === 'body');
  }

  /* ---------------------------------------------------------------- to the model */

  /** A <P> as FictionBook Editor saved it, in a parent of type `parentType`. */
  paragraphModel(el, parentType, keepIds) {
    const cls = el.className;
    const model = el.model ?? el.cloneOf?.model ?? null;
    const nodeId = keepIds && el.model ? el.model.attrs?.nodeId : undefined;
    const source = el.source;
    if (source && el.initial && el.html === el.initial.html && cls === el.initial.className && el.attrs.id === el.initial.id) {
      // A block the script did not touch is written back as it was read; only a verse that left
      // its stanza becomes a paragraph, and a paragraph in a stanza a verse, as the page saved them.
      let node = keepIds ? source : stripIds(source);
      if (node.type === 'v' && parentType !== 'stanza') node = { ...node, type: 'p' };
      else if (node.type === 'p' && parentType === 'stanza') node = { ...node, type: 'v' };
      else if (node.type === 'date' && parentType !== 'poem') node = { ...node, type: 'text-author', attrs: { ...(keepIds && nodeId ? { nodeId } : {}) } };
      else if (node.type === 'empty-line' && parentType === 'stanza') node = { type: 'v', attrs: {}, content: [{ type: 'text', text: ' ' }] };
      else if (node.type === 'subtitle' && parentType === 'epigraph') node = { ...node, type: 'p' };
      return node;
    }
    const content = parseInline(fromPage(el.html, el.alts), el.extras);
    const attrsFor = (names) => {
      const attrs = {};
      for (const name of names) if (model?.attrs?.[name] !== undefined) attrs[name] = model.attrs[name];
      if (el.attrs.id) attrs.id = el.attrs.id;
      else delete attrs.id;
      if (nodeId) attrs.nodeId = nodeId;
      return attrs;
    };
    if (cls === 'td' || cls === 'th') {
      const attrs = model && (model.type === 'td' || model.type === 'th') ? { ...model.attrs } : {};
      delete attrs.nodeId;
      if (el.attrs.id) attrs.id = el.attrs.id;
      else delete attrs.id;
      if (nodeId) attrs.nodeId = nodeId;
      return { type: cls, attrs, content };
    }
    const blank = content.every((item) => item.type === 'text' && /^[\s ]*$/.test(item.text ?? '')) && content.length <= 1;
    if (blank) {
      if (parentType === 'stanza') return { type: 'v', attrs: attrsFor(PARAGRAPH_ATTRS), content: [{ type: 'text', text: ' ' }] };
      const attrs = {};
      if (nodeId && model?.type === 'empty-line') attrs.nodeId = nodeId;
      return { type: 'empty-line', attrs };
    }
    // An epigraph holds no subtitle in FB2 (one that came there from a dissolved stanza).
    if (cls === 'subtitle') return { type: parentType === 'epigraph' ? 'p' : 'subtitle', attrs: attrsFor(PARAGRAPH_ATTRS), content };
    if (cls === 'text-author') {
      if (model?.type === 'date' && parentType === 'poem') {
        const attrs = {};
        for (const name of ['value', 'lang', 'unknownAttrs']) if (model.attrs?.[name] !== undefined) attrs[name] = model.attrs[name];
        if (nodeId) attrs.nodeId = nodeId;
        return { type: 'date', attrs, content: content.map((item) => (item.type === 'text' ? { type: 'text', text: item.text } : item)).filter((item) => item.type === 'text') };
      }
      return { type: 'text-author', attrs: attrsFor(PARAGRAPH_ATTRS), content };
    }
    return { type: parentType === 'stanza' ? 'v' : 'p', attrs: attrsFor(PARAGRAPH_ATTRS), content };
  }

  /** A DIV and its subtree in the model (null for what FictionBook Editor did not save). */
  nodeModel(el, parentType, keepIds) {
    if (el.nodeName === 'P') return this.paragraphModel(el, parentType, keepIds);
    const model = el.model ?? el.cloneOf?.model ?? null;
    if (el.raw) return keepIds ? el.raw : stripIds(el.raw);
    if (el.isImage) {
      const attrs = model?.type === 'image' ? { ...model.attrs } : {};
      delete attrs.nodeId;
      attrs.href = el.attrs.href ?? '';
      if (el.attrs.title) attrs.title = el.attrs.title;
      else delete attrs.title;
      if (el.attrs.id) attrs.id = el.attrs.id;
      else delete attrs.id;
      if (el.attrs.alt) attrs.alt = el.attrs.alt;
      if (keepIds && el.model) attrs.nodeId = el.model.attrs?.nodeId;
      return { type: 'image', attrs };
    }
    const type = el.className;
    if (!DIV_TYPES.has(type) && type !== 'history') return null;
    const attrs = model && model.type === (type === 'history' ? 'annotation' : type) ? { ...model.attrs } : {};
    delete attrs.nodeId;
    if (el.attrs.id) attrs.id = el.attrs.id;
    else delete attrs.id;
    if (type === 'body') {
      if (el.attrs.fbname) attrs.name = el.attrs.fbname;
      else delete attrs.name;
    }
    if (keepIds && el.model) attrs.nodeId = el.model.attrs?.nodeId;
    const content = [];
    for (const child of el.childNodes) {
      const node = this.nodeModel(child, type, keepIds);
      if (node) content.push(node);
    }
    return { type: type === 'history' ? 'annotation' : type, attrs, content };
  }

  /**
   * The bodies on the page as model nodes. With `keepIds` the elements built from the book keep
   * their node ids (a body rebuilt in place); without, every node gets a new one.
   */
  bodyModels(keepIds = true) {
    return this.bodies().map((el) => this.nodeModel(el, 'doc', keepIds));
  }

  /**
   * The description with the annotation and the history as on the page: one that holds only
   * empty lines is left out, as FictionBook Editor saved it (main.js, IsEmpty).
   */
  descriptionModel() {
    const description = JSON.parse(JSON.stringify(this.snapshot.description));
    const read = (div, original) => {
      if (div && div.parentNode && div.outerHTML === div.initialHTML) return original;
      if (!div || !div.parentNode) return undefined;
      const node = this.nodeModel(div, 'doc', true);
      node.type = 'annotation';
      if (!(node.content ?? []).some((child) => child.type !== 'empty-line')) return undefined;
      if (original?.attrs) node.attrs = { ...original.attrs, ...node.attrs };
      return node;
    };
    const annotation = read(this.annotation, description.titleInfo?.annotation);
    const history = read(this.history, description.documentInfo?.history);
    if (annotation) description.titleInfo.annotation = annotation;
    else delete description.titleInfo.annotation;
    if (history) description.documentInfo.history = history;
    else delete description.documentInfo.history;
    if (description.documentInfo) description.documentInfo.version = this.version;
    return description;
  }
}

/** A copy of a node without node ids. */
export function stripIds(node) {
  if (!node || typeof node !== 'object' || node.type === 'text') return node;
  const { nodeId, ...attrs } = node.attrs ?? {};
  const copy = { ...node, attrs };
  if (node.content) copy.content = node.content.map(stripIds);
  return copy;
}

/** Two model nodes or lists alike, node ids aside. */
export function sameModel(a, b) {
  return JSON.stringify(stripIds({ type: 'x', content: a })) === JSON.stringify(stripIds({ type: 'x', content: b }));
}

/**
 * Writes the page back: the bodies that changed (doc.replaceNode, doc.removeNode for the ones
 * that are gone - the first body takes the place of the book's main body, which cannot be
 * removed) and the description when its annotation or history changed (doc.setDescription).
 * Returns whether anything was written.
 */
export async function commitPage(page) {
  const snapshot = page.snapshot;
  const original = snapshot.bodies ?? [];
  const current = page.bodies();
  const sameBodies = current.length === page.originalBodies.length && current.every((el, i) => el === page.originalBodies[i]);
  const models = page.bodyModels(sameBodies);
  let written = false;
  if (sameBodies) {
    for (let i = 0; i < models.length; i += 1) {
      if (sameModel([models[i]], [original[i]])) continue;
      await mfbe.doc.replaceNode(original[i].attrs.nodeId, models[i]);
      written = true;
    }
  } else {
    // Bodies were merged or removed: the bodies that are left take the places of the first ones.
    for (let i = original.length - 1; i >= models.length; i -= 1) {
      if (i === 0) continue;
      await mfbe.doc.removeNode(original[i].attrs.nodeId);
    }
    for (let i = 0; i < models.length; i += 1) {
      await mfbe.doc.replaceNode(original[i].attrs.nodeId, { ...models[i], attrs: { ...models[i].attrs, nodeId: original[i].attrs.nodeId } });
    }
    written = true;
  }
  const description = page.descriptionModel();
  const before = snapshot.description;
  if (!sameModel([description.titleInfo?.annotation ?? null], [before.titleInfo?.annotation ?? null]) ||
      !sameModel([description.documentInfo?.history ?? null], [before.documentInfo?.history ?? null]) ||
      description.documentInfo?.version !== before.documentInfo?.version) {
    await mfbe.doc.setDescription(description);
    written = true;
  }
  return written;
}

/* ------------------------------------------------------------------------ */
/* Rewrites through innerHTML                                               */
/* ------------------------------------------------------------------------ */

const paragraphKey = (p) => `${p.className}\u0001${p.attrs.id ?? ''}\u0001${p.html}`;
const imageKey = (div) => `${div.attrs.href ?? ''}\u0001${div.attrs.title ?? ''}\u0001${div.attrs.id ?? ''}`;

/**
 * The elements under `root` before a script rewrites it through innerHTML (see restoreOrigins).
 */
export function snapshotOrigins(root) {
  return {
    paragraphs: root.getElementsByTagName('P').map((el) => ({ el, key: paragraphKey(el) })),
    images: root.getElementsByTagName('DIV').filter((el) => el.isImage).map((el) => ({ el, key: imageKey(el) })),
  };
}

/**
 * After a rewrite of `root` through innerHTML, which builds new elements from the page's text:
 * each paragraph and picture left as it was - the same class, id and inner HTML, in the same order
 * - gets back the model it was built from (what the page did not show: a date, xml:lang, a style,
 * a cell's spans, a picture's alt text), and so does each container whose first such paragraph
 * sits in a container of its class at the same depth as before (each model once).
 */
export function restoreOrigins(before, root) {
  const WINDOW = 200;
  const match = (list, items, keyOf, apply) => {
    let j = 0;
    for (const item of items) {
      const key = keyOf(item);
      for (let k = j; k < Math.min(list.length, j + WINDOW); k++) {
        if (list[k].key !== key) continue;
        apply(item, list[k].el);
        j = k + 1;
        break;
      }
    }
  };
  match(before.paragraphs, root.getElementsByTagName('P'), paragraphKey, (p, old) => {
    p.model = old.model;
    p.source = old.source;
    p.initial = old.initial;
    p.extras = old.extras;
    p.alts = old.alts;
    p.origin = old;
  });
  match(before.images, root.getElementsByTagName('DIV').filter((el) => el.isImage), imageKey, (div, old) => {
    div.model = old.model;
  });
  const taken = new Set();
  for (const div of root.getElementsByTagName('DIV')) {
    if (div.model || div.isImage) continue;
    const first = div.getElementsByTagName('P').find((p) => p.origin);
    if (!first) continue;
    let depth = 0;
    for (let a = first.parentNode; a && a !== div; a = a.parentNode) depth += 1;
    let old = first.origin.parentNode;
    for (let d = 0; d < depth && old; d += 1) old = old.parentNode;
    if (old && old.className === div.className && old.model && !taken.has(old)) {
      div.model = old.model;
      taken.add(old);
    }
  }
}
