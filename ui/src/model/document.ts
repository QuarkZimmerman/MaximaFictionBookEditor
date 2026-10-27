// Copied verbatim from specs/001-maxima-fb2-editor/contracts/document-model.d.ts (contract
// version 1). Keep identical to the contract apart from this header; update the contract first.
/* eslint-disable @typescript-eslint/no-empty-object-type */

/**
 * Maxima Fiction Book Editor — Document JSON model, version 1.
 *
 * This is the canonical shape of a book as exchanged between the C++ core and
 * the TypeScript UI over JSON-RPC (see rpc-api.md). The body tree is
 * deliberately ProseMirror-compatible (`{type, attrs, content, text, marks}`)
 * so the UI can load it with `Node.fromJSON` after mapping, while remaining a
 * neutral format the core can produce and consume without ProseMirror.
 *
 * Rules:
 *  - Every structural node carries `attrs.nodeId` (session-stable, core-issued).
 *  - Binary payloads never appear here (see BinaryMeta).
 *  - Unknown XML is preserved as `raw-xml` nodes and round-trips verbatim.
 *  - All strings are Unicode; whitespace inside text is significant.
 *  - `TitleInfo.annotation` and `DocumentInfo.history` distinguish "absent"
 *    from "present and empty" (feature 004, FR-010/FR-015 there): `undefined`
 *    = the file has no such element; a node with `content: []` (with or
 *    without `id` / `lang`) = the element is present and empty, read as such
 *    and written back as `<annotation/>` / `<history/>` until one of its two
 *    editors (the Description field, the Body view's block) changes it; an
 *    element the user emptied becomes `undefined` and is not written. No
 *    shape changed. The Body view's annotation and history blocks and the
 *    Description view's "Other persons" list are UI projections of this model
 *    (`description.customInfo` rows for the roles), never members of it — see
 *    specs/004-third-feedback-batch/contracts/document-model.md.
 *  - Feature 006 (table editing) adds optional members and documented rules
 *    only, so a model of release 0.0.5 stays valid and the version stays 1:
 *    the cell's `lang`, the marks' `lang` and the link's `xlinkType`, `marks`
 *    on inline images and inline raw XML, several formatting marks of one type
 *    on one node, the documented `unknownAttrs` and the span values' rule —
 *    each marked "feature 006" below; the reader's and writer's rules and the
 *    rationale are in specs/006-table-editing/contracts/document-model.md.
 *    Section 4 of specs/006-table-editing/contracts/document-model.md defines
 *    the table grid (normative).
 */

export const DOCUMENT_MODEL_VERSION = 1;

/* ------------------------------------------------------------------------ */
/* Document                                                                 */
/* ------------------------------------------------------------------------ */

export interface Document {
  modelVersion: 1;
  docId: string;
  path?: string;
  fileKind: 'fb2' | 'fbd' | 'xml';
  sourceEncoding: string; // e.g. "utf-8", "windows-1251"
  /**
   * '2.1'    = the input validated against the bundled FB2 2.1 schema as-is;
   * 'legacy' = well-formed FictionBook XML that did not validate (typical 2.0-era
   *            files with older element order/omissions) — loaded, normalised on save;
   * 'unknown' = could not be determined (e.g. Source-only mode).
   * FB2 2.0 and 2.1 share one namespace, so the version is not readable from the file.
   */
  schemaHint: '2.1' | 'legacy' | 'unknown';
  stylesheets: Stylesheet[];
  description: Description;
  bodies: BodyNode[];
  binaries: BinaryMeta[];
  extras: RawXmlNode[]; // unknown top-level elements
}

export interface Stylesheet {
  type: string; // e.g. "text/css"
  content: string;
}

/* ------------------------------------------------------------------------ */
/* Description (form-shaped, not a tree)                                    */
/* ------------------------------------------------------------------------ */

export interface Description {
  titleInfo: TitleInfo;
  srcTitleInfo?: TitleInfo;
  documentInfo: DocumentInfo;
  publishInfo?: PublishInfo;
  customInfo: CustomInfo[];
  outputs: RawXmlNode[]; // <output> sharing instructions, verbatim
}

export interface TitleInfo {
  genres: GenreRef[]; // >= 1 for validity
  authors: Person[]; // >= 1 for validity
  bookTitle: string;
  annotation?: AnnotationNode;
  keywords?: string;
  date?: DateValue;
  coverpage: ImageRef[];
  lang: string; // ISO 639-1; required
  srcLang?: string;
  translators: Person[];
  sequences: Sequence[];
}

export interface DocumentInfo {
  authors: Person[]; // >= 1 for validity
  programUsed?: string;
  date: DateValue;
  srcUrls: string[];
  srcOcr?: string;
  id: string; // required; UUID v4 for new documents
  version: string; // required; e.g. "1.0"
  history?: AnnotationNode;
  publishers: Person[];
}

export interface PublishInfo {
  bookName?: string;
  publisher?: string;
  city?: string;
  year?: string;
  isbn?: string;
  sequences: Sequence[];
}

export interface CustomInfo {
  infoType: string;
  text: string;
  lang?: string;
}

export interface Person {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  nickname?: string;
  homePages: string[];
  emails: string[];
  id?: string;
}

export interface Sequence {
  name: string;
  number?: number;
  lang?: string;
  children: Sequence[];
}

export interface DateValue {
  text: string;
  value?: string; // ISO date YYYY-MM-DD
  lang?: string;
}

export interface GenreRef {
  code: string;
  match?: number; // 1..100; omitted == 100
}

export interface ImageRef {
  href: string; // "#binaryId" or external URL
  alt?: string;
  title?: string;
  id?: string;
}

/* ------------------------------------------------------------------------ */
/* Body tree (ProseMirror-compatible)                                       */
/* ------------------------------------------------------------------------ */

export interface BaseNode<T extends string, A extends object = {}> {
  type: T;
  attrs: A & {
    nodeId: string;
    /**
     * The element's attributes that have no member of their own (feature 006 documents it,
     * contracts/document-model.md §1.3): on every node the reader builds from an element (the
     * structural and block nodes of the bodies, the annotations and the history, and
     * `inline-image`; marks have none); absent when empty. Keys: the local name of an attribute
     * without a namespace, `{namespaceURI}localName` otherwise; values: the text, verbatim.
     * Written after the known attributes; a name a known attribute already wrote is skipped -
     * the known value wins.
     */
    unknownAttrs?: Record<string, string>;
  };
}

export type StructAttrs = { id?: string; lang?: string };

export interface BodyNode extends BaseNode<'body', StructAttrs & { name?: string }> {
  content: Array<ImageNode | TitleNode | EpigraphNode | SectionNode>;
  // order: image?, title?, epigraph*, section+
}

export interface SectionNode extends BaseNode<'section', StructAttrs> {
  content: Array<TitleNode | EpigraphNode | ImageNode | AnnotationNode | SectionNode | BlockNode>;
  // order: title?, epigraph*, image?, annotation?, then (section+ | block+)
}

export interface TitleNode extends BaseNode<'title', { lang?: string }> {
  content: Array<ParagraphNode | EmptyLineNode>;
}

export interface EpigraphNode extends BaseNode<'epigraph', { id?: string }> {
  content: Array<ParagraphNode | PoemNode | CiteNode | EmptyLineNode | TextAuthorNode>;
}

export interface AnnotationNode extends BaseNode<'annotation', StructAttrs> {
  content: Array<ParagraphNode | PoemNode | CiteNode | SubtitleNode | TableNode | EmptyLineNode>;
}

export type BlockNode =
  | ParagraphNode
  | SubtitleNode
  | PoemNode
  | CiteNode
  | EmptyLineNode
  | TableNode
  | ImageNode
  | RawXmlNode;

export type ParagraphAttrs = StructAttrs & { style?: string };

export interface ParagraphNode extends BaseNode<'p', ParagraphAttrs> {
  content: InlineNode[];
}
export interface SubtitleNode extends BaseNode<'subtitle', ParagraphAttrs> {
  content: InlineNode[];
}
export interface TextAuthorNode extends BaseNode<'text-author', ParagraphAttrs> {
  content: InlineNode[];
}
export interface VerseNode extends BaseNode<'v', ParagraphAttrs> {
  content: InlineNode[];
}
export interface EmptyLineNode extends BaseNode<'empty-line'> {}

export interface PoemNode extends BaseNode<'poem', StructAttrs> {
  content: Array<TitleNode | EpigraphNode | StanzaNode | SubtitleNode | TextAuthorNode | DateNode>;
  // order: title?, epigraph*, (stanza|subtitle)+, text-author*, date?
}

export interface StanzaNode extends BaseNode<'stanza', { lang?: string }> {
  content: Array<TitleNode | SubtitleNode | VerseNode>; // title?, subtitle?, v+
}

export interface DateNode extends BaseNode<'date', { value?: string; lang?: string }> {
  content: TextNode[];
}

export interface CiteNode extends BaseNode<'cite', StructAttrs> {
  content: Array<
    ParagraphNode | SubtitleNode | EmptyLineNode | PoemNode | TableNode | TextAuthorNode
  >;
}

export interface TableNode extends BaseNode<'table', { id?: string; style?: string }> {
  content: RowNode[];
}

export interface RowNode extends BaseNode<'tr', { align?: Align }> {
  content: CellNode[];
}

export interface CellNode extends BaseNode<
  'td' | 'th',
  {
    id?: string;
    style?: string;
    /**
     * The integer value as read; written in canonical decimal; other text, and a value below 1
     * not in canonical form, in `unknownAttrs` (feature 006, contracts/document-model.md §1.2).
     */
    colspan?: number;
    /** As `colspan`. */
    rowspan?: number;
    align?: Align;
    valign?: VAlign;
    /** xml:lang, read and written verbatim (feature 006, FR-020). */
    lang?: string;
  }
> {
  content: InlineNode[];
}

export type Align = 'left' | 'right' | 'center';
export type VAlign = 'top' | 'middle' | 'bottom';

export interface ImageNode extends BaseNode<
  'image',
  {
    href: string;
    alt?: string;
    title?: string;
    id?: string;
  }
> {}

/** Unknown element preserved verbatim; `inline` tells where it may appear. */
export interface RawXmlNode extends BaseNode<'raw-xml', { xml: string; inline: boolean }> {
  /**
   * The marks open around it: inline only; feature 006, FR-067 (contracts/document-model.md
   * §2.6). Outer first; a formatting type may repeat with different attributes, a link may not
   * (feature 006, FR-069). Absent when empty; a block raw-xml node has none.
   */
  marks?: Mark[];
}

/* ------------------------------------------------------------------------ */
/* Inline content                                                            */
/* ------------------------------------------------------------------------ */

export type InlineNode = TextNode | InlineImageNode | RawXmlNode;

export interface TextNode {
  type: 'text';
  text: string;
  /**
   * Outer first; a formatting type may repeat with different attributes, a link may not
   * (feature 006, FR-069; contracts/document-model.md §2.1, §2.2). Absent when empty.
   */
  marks?: Mark[];
}

export interface InlineImageNode extends BaseNode<'inline-image', { href: string; alt?: string }> {
  /**
   * The marks open around the picture: inline only; feature 006, FR-067 (as `TextNode.marks`;
   * contracts/document-model.md §2.6). Absent when empty.
   */
  marks?: Mark[];
}

/**
 * An inline formatting element or a link (contracts/document-model.md §2.1, feature 006): the
 * schema's attributes, kept verbatim - `lang` is the element's `xml:lang` (any value, `""`
 * included), `xlinkType` a link's `xlink:type`; `attrs` is present only with a member. Every
 * other attribute of a mark is dropped when a book is read.
 */
export type Mark =
  | { type: 'strong'; attrs?: { lang?: string } }
  | { type: 'emphasis'; attrs?: { lang?: string } }
  | { type: 'strikethrough'; attrs?: { lang?: string } }
  | { type: 'sub'; attrs?: { lang?: string } }
  | { type: 'sup'; attrs?: { lang?: string } }
  | { type: 'code'; attrs?: { lang?: string } }
  | { type: 'style'; attrs: { name: string; lang?: string } }
  | { type: 'link'; attrs: { href: string; type?: 'note' | string; xlinkType?: string } };

/* ------------------------------------------------------------------------ */
/* Binaries (metadata only — bytes stay in the core)                        */
/* ------------------------------------------------------------------------ */

export interface BinaryMeta {
  id: string;
  contentType: string; // as loaded
  size: number; // decoded bytes
  /** The stored image's pixel size as the core probes it; absent when unknown. */
  width?: number;
  /** The stored image's pixel size as the core probes it; absent when unknown. */
  height?: number;
  /**
   * Whether the core decodes the image; false after a failed conversion (contracts/document-
   * model.md §6). The editor's preview of a decodable binary is `preview?w=800`'s size (feature
   * 006, the reserved box of pictures in cells).
   */
  decodable: boolean;
  willConvert: boolean; // true => re-encoded to JPEG/PNG on save
  referenceCount: number;
}

/* ------------------------------------------------------------------------ */
/* Validation                                                               */
/* ------------------------------------------------------------------------ */

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string; // stable message code, localised by UI
  params: Record<string, string | number>;
  line?: number;
  column?: number;
  nodeId?: string;
  path?: string; // e.g. "body[1]/section[3]/p[12]"
}

export interface ValidationReport {
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  durationMs: number;
}
