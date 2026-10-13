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
  attrs: A & { nodeId: string };
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
    colspan?: number;
    rowspan?: number;
    align?: Align;
    valign?: VAlign;
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
export interface RawXmlNode extends BaseNode<'raw-xml', { xml: string; inline: boolean }> {}

/* ------------------------------------------------------------------------ */
/* Inline content                                                            */
/* ------------------------------------------------------------------------ */

export type InlineNode = TextNode | InlineImageNode | RawXmlNode;

export interface TextNode {
  type: 'text';
  text: string;
  marks?: Mark[];
}

export interface InlineImageNode extends BaseNode<'inline-image', { href: string; alt?: string }> {}

export type Mark =
  | { type: 'strong' }
  | { type: 'emphasis' }
  | { type: 'strikethrough' }
  | { type: 'sub' }
  | { type: 'sup' }
  | { type: 'code' }
  | { type: 'style'; attrs: { name: string } }
  | { type: 'link'; attrs: { href: string; type?: 'note' | string } };

/* ------------------------------------------------------------------------ */
/* Binaries (metadata only — bytes stay in the core)                        */
/* ------------------------------------------------------------------------ */

export interface BinaryMeta {
  id: string;
  contentType: string; // as loaded
  size: number; // decoded bytes
  width?: number;
  height?: number;
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
