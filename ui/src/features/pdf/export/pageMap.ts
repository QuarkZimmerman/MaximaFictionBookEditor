/**
 * Feature 014 (data-model PageMap, contracts/pdf-file.md): what the paginator tells the core about
 * the pages it made: their count, the bookmarks (D17), the picture boxes the core fills (R4), each
 * page's text for the core's own check (DP-18), and the book's language (D22).
 * Coordinates are points from the page's top left.
 */

export interface PageMapBookmark {
  title: string;
  page: number;
  y: number;
  children: PageMapBookmark[];
}

export interface PageMapPicture {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  binaryId: string;
  alt: string;
}

export interface PageMap {
  pages: number;
  bookmarks: PageMapBookmark[];
  pictures: PageMapPicture[];
  /** The cover's binary id when page 1 is the cover page. */
  cover: string | null;
  /** The text each page shows, in order (page numbers excluded). */
  text: string[];
  /** The book's language, '' when unknown (D22). */
  language: string;
  /** The language of the words the export adds (D11: en, ru or uk). */
  addedWords: string;
}

/** CSS pixels (96 per inch) to points (72 per inch). */
export const PX_TO_PT = 72 / 96;
