/**
 * Neutral shared MARC relator constants used by both EPUB and MOBI export/import (feature 018 T013).
 */
export const MARC = {
  author: 'aut',
  translator: 'trl',
  illustrator: 'ill',
  editor: 'edt',
  compiler: 'com',
  designer: 'dsr',
  bookDesigner: 'bkd',
  coverDesigner: 'cov',
  commentator: 'cmm',
  bookProducer: 'bkp',
} as const;

export type MarcRole = (typeof MARC)[keyof typeof MARC];
