/**
 * Neutral shared Maxima FBD Maker role codec used by both EPUB and MOBI (feature 018 T013).
 * One `custom-info` entry per person, labelled by `info-type`, text "Surname First Middle".
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

/** The import: the roles that have a label; book and cover designers count as designers. */
export const LABEL_BY_ROLE: Readonly<Record<string, FbdMakerLabel>> = {
  [MARC.illustrator]: 'mlillustrator',
  [MARC.editor]: 'mleditor',
  [MARC.compiler]: 'mlcompiler',
  [MARC.designer]: 'mldesigner',
  [MARC.bookDesigner]: 'mldesigner',
  [MARC.coverDesigner]: 'mldesigner',
  [MARC.commentator]: 'mlcommentator',
};

/** The export: the labels written back as contributors; the person the book is about has no role. */
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
const initial = (text: string): string => ([...text].length === 1 ? `${text}.` : text);

export function writeFbdMakerName(name: PersonName): string {
  return [part(name.last), initial(part(name.first)), initial(part(name.middle))].join(' ').trim();
}

export function readFbdMakerName(text: string): PersonName {
  const [last = '', first = '', middle = ''] = text.trim().split(' ');
  const back = (value: string): string => value.replace(/_/g, ' ');
  return { last: back(last), first: back(first), middle: back(middle) };
}
