/**
 * Feature 012 (D6, D28; spec Behavioural reference §7): the people the FB2 description has no place
 * for, kept in its custom information as the Maxima site and the Maxima FBD Maker keep them - one
 * `custom-info` entry per person, labelled by `info-type`, its text "Surname First Middle". The one
 * statement of the format is the site's contract
 * (`/srv/maxima/specs/010-fbd-additional-data/contracts/description-entries.md`, read only); the
 * site's `FictionBook.php` (`ADDITIONAL_ROLE_LABELS`, `setPerson`) follows it.
 */
import { MARC } from './roles';

export const FBD_MAKER_LABELS = [
  'mlillustrator',
  'mleditor',
  'mlcompiler',
  'mldesigner',
  'mlcommentator',
  'mlabouttheauthor',
] as const;

export type FbdMakerLabel = (typeof FBD_MAKER_LABELS)[number];

/** The import (D28): the roles that have a label; book and cover designers count as designers. */
export const LABEL_BY_ROLE: Readonly<Record<string, FbdMakerLabel>> = {
  [MARC.illustrator]: 'mlillustrator',
  [MARC.editor]: 'mleditor',
  [MARC.compiler]: 'mlcompiler',
  [MARC.designer]: 'mldesigner',
  [MARC.bookDesigner]: 'mldesigner',
  [MARC.coverDesigner]: 'mldesigner',
  [MARC.commentator]: 'mlcommentator',
};

/** The export (D6): the labels written back as contributors; the person the book is about has no role. */
export const ROLE_BY_LABEL: Readonly<Partial<Record<FbdMakerLabel, string>>> = {
  mlillustrator: MARC.illustrator,
  mleditor: MARC.editor,
  mlcompiler: MARC.compiler,
  mldesigner: MARC.designer,
  mlcommentator: MARC.commentator,
};

export interface PersonName {
  last: string;
  first: string;
  middle: string;
}

const part = (text: string): string => text.trim().replace(/ /g, '_');
// The site gives a one-letter first or middle name a full stop (`Ю` -> `Ю.`); [...text] counts
// characters, not UTF-16 units.
const initial = (text: string): string => ([...text].length === 1 ? `${text}.` : text);

/**
 * Writing: a space inside a part becomes "_", a one-letter first or middle name gains a full stop,
 * the three parts are joined by single spaces and the ends trimmed - an empty first name leaves two
 * spaces inside, as the site writes it, so the parts stay countable.
 */
export function writeFbdMakerName(name: PersonName): string {
  return [part(name.last), initial(part(name.first)), initial(part(name.middle))].join(' ').trim();
}

/** Reading: split on single spaces, take three parts (drop the rest), "_" back into spaces. */
export function readFbdMakerName(text: string): PersonName {
  const [last = '', first = '', middle = ''] = text.trim().split(' ');
  const back = (value: string): string => value.replace(/_/g, ' ');
  return { last: back(last), first: back(first), middle: back(middle) };
}
