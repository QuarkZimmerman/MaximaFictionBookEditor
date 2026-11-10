/**
 * Feature 012 (D6, D28; spec Behavioural reference §7): the MARC relator codes EPUB gives a person's
 * role with (EPUB 3.3, the `role` property, scheme `marc:relators`; the codes checked against the
 * Library of Congress's MARC Code List for Relators).
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
