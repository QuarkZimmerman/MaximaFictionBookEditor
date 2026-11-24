/**
 * Feature 016 (contracts/page-model.md): what the reader process writes and the interface reads - the
 * document (metadata, the editor's record, bookmarks, the structure of a tagged PDF) and each page (words,
 * fonts, links, pictures).
 */

/** A marked-content run of a tagged PDF's structure, with its text and how it is drawn. */
export interface StructLeaf {
  page: number;
  mcid: number;
  text: string;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  /** The mean size of its characters, in points. */
  size?: number;
  /** Its highest character's top, in points from the page's top. */
  top?: number;
  /** Where it begins and ends on its line (a figure's picture too), in points. */
  left?: number;
  right?: number;
  /** Its first character's left and top, and its last character's right and top (D32: the first line's
   * indent and the last line's length, which `left` and `right` hide over several lines). */
  startLeft?: number;
  startTop?: number;
  endRight?: number;
  endTop?: number;
}

/** An object of the structure (a link annotation), with the link's target. */
export interface StructObjr {
  objr: true;
  page: number;
  uri?: string;
  dest?: string;
  destPage?: number;
}

export interface StructElement {
  type: string;
  lang?: string;
  alt?: string;
  actualText?: string;
  attributes?: Record<string, unknown>;
  kids: StructNode[];
}

export type StructNode = StructElement | StructLeaf | StructObjr;

export const isElement = (node: StructNode): node is StructElement => 'type' in node;
export const isLeaf = (node: StructNode): node is StructLeaf => 'mcid' in node;
export const isObjr = (node: StructNode): node is StructObjr => 'objr' in node;

export interface OutlineNode {
  title: string;
  page?: number;
  y?: number;
  dest?: string;
  uri?: string;
  kids: OutlineNode[];
}

export interface PdfDocumentModel {
  v: number;
  pages: number;
  version?: string;
  encrypted?: boolean;
  copyAllowed?: boolean;
  metadata: { info?: Record<string, string>; xmp?: string; lang?: string };
  /** The editor's record of its own PDFs (014 R10): the description and the hints, as written. */
  record?: { version: number; description: string; hints: string };
  outline: OutlineNode[];
  forms: { page: number; box: number[]; value: string }[];
  dropped?: { comments?: number; attachments?: number; media?: number; scripts?: number };
  /** The first page's largest picture: the cover an editor's own PDF gives back (D23), known before the read. */
  cover?: { w: number; h: number; jpeg: boolean };
  structure?: StructElement[];
  orphans?: StructLeaf[];
}

export interface PdfWord {
  t: string;
  box: [number, number, number, number];
  f: string;
  s: number;
  c: string;
  base: number;
  /** Feature 020: detected FB2 language code for this word's OCR block. */
  lang?: string;
  /** Feature 020: OCR recognition confidence (0..100). */
  conf?: number;
}

export interface PdfFont {
  id: string;
  name: string;
  bold: boolean;
  italic: boolean;
  mono: boolean;
}

export interface PdfLink {
  box: [number, number, number, number];
  uri?: string;
  page?: number;
  y?: number;
  dest?: string;
}

export interface PdfPicture {
  id: string;
  box: [number, number, number, number];
  w: number;
  h: number;
  jpeg: boolean;
  /** Feature 020: cropped non-text inline illustration extracted from a scanned page. */
  ocrCrop?: boolean;
  /** Feature 020: full-page fallback image retained when OCR yielded no usable text on this page. */
  ocrFallback?: boolean;
}

/** Feature 020 (data-model.md §3.3): OCR text extracted from an embedded raster image on a searchable page. */
export interface PdfOcrImageBlock {
  pictureId: string;
  box: [number, number, number, number];
  lang: string;
  meanConf: number;
  paragraphs: { text: string; lang?: string; words: PdfWord[] }[];
}

export interface PdfPageModel {
  n: number;
  width: number;
  height: number;
  rotation: number;
  kind: string;
  fonts: PdfFont[];
  words: PdfWord[];
  links: PdfLink[];
  pictures: PdfPicture[];
  /** Areas of lines and shapes the reader draws as pictures on request (D16, DP-7). */
  drawings?: { id: string; box: [number, number, number, number] }[];
  /** Form fields in labelled rows: each label (the text before it) and value (D16). */
  forms?: { box: number[]; label: string; value: string; labelBox: number[] }[];
  /** Feature 020: full-page OCR ran on this page. */
  ocrUsed?: boolean;
  /** Feature 020: primary detected FB2 language code for this OCR'd page. */
  ocrLang?: string;
  /** Feature 020: distinct FB2 language codes detected across blocks on this page. */
  ocrLanguages?: string[];
  /** Feature 020: clockwise rotation correction applied before OCR. */
  ocrRotation?: 0 | 90 | 180 | 270;
  /** Feature 020: mean OCR word confidence (0..100). */
  ocrMeanConf?: number;
  /** Feature 020: best-effort low-confidence OCR output flag. */
  ocrLowConfidence?: boolean;
  /** Feature 020: embedded text-bearing raster image OCR blocks on a searchable page. */
  ocrImages?: PdfOcrImageBlock[];
}

/** The editor's hints (014 contracts/pdf-file.md `mfbe:fb2Hints`, version 1). */
export interface HintsV1 {
  v: number;
  blocks: number;
  /** Blocks that draw nothing, so no part stands for them (feature 016). */
  blank?: number[];
  generated: {
    cover: number | null;
    titlePage: number;
    annotationPage: number | null;
    historyPage: number | null;
    words?: string[];
    /** Feature 016 (D19): the text's size in points. */
    textPt?: number;
  };
  /** `notes`: the notes body's part printed after the text (notes nothing refers to, feature 016). */
  bodies: { name: string; page: number; notes?: boolean }[];
  sections: [number, number][];
  kinds: [number, number, string][];
  styles: (number | string)[][];
  marks: [number, number, number, string][];
  /** Feature 016 (D6): [block, offset] of the spaces after a hyphen at a line's end, which the PDF does not show. */
  spaces?: [number, number][];
  /** Feature 016 (D6): [block, offset] of the line breaks with no space in the text (before a note's mark). */
  joins?: [number, number][];
  /** Feature 016 (D6): [block, offset, text] of the letters written with combining marks, which the PDF composes. */
  clusters?: [number, number, string][];
  /** Feature 016 (D6): [block, offset, side] of a mark's own space at a line break: 1 its last character, 0 its first. */
  inner?: [number, number, number][];
  /** Feature 016 (D6): [block, offset, address] of the web addresses the engine writes in their URL form. */
  hrefs?: [number, number, string][];
  /** Feature 016 (D6): [block, depth] where a container begins anew under the same names (two epigraphs in a row). */
  fresh?: [number, number][];
  /** Feature 016 (D6): the blocks whose text goes on onto a next page, once per page break. */
  continued?: number[];
  /** Feature 016 (D19): the pages (from 1) whose foot begins with the rest of a note cut on the page before. */
  carried?: number[];
  /** Feature 016 (D19): of those, the pages whose rest begins with a whole paragraph of its note. */
  carriedApart?: number[];
  langs: [number, number, number, string][];
  ids: [number, string][];
  tables: [number, number, string][];
  pictures: {
    page: number;
    box: number[];
    binaryId: string;
    contentType: string;
    inline: boolean;
  }[];
  stylesheets: { type: string; text: string }[];
  anchors: Record<string, string>;
}
