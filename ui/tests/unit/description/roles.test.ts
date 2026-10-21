/**
 * Feature 004, User Story 3 (T030) - the role entries of the Maxima Library as a projection of
 * `custom-info` rows (research R3.1, data-model §3): the reader (`parseRoleRow`), the writer
 * (`formatRoleText` - the Maxima FBD Maker's rule, no `.` after a one-letter name), the
 * fold-back of the Description form (unedited rows verbatim and in place, an edited list after
 * the plain rows), the edited state, the missing-last-name marker and the Find / Replace scope,
 * checked against the library's own fixtures copied into `tests/fixtures/books/`.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatRoleText,
  INFO_TYPE_BY_ROLE,
  isRoleRow,
  parseRoleRow,
  ROLE_BY_INFO_TYPE,
  roleEntryEmpty,
  roleEntryToRow,
  ROLES,
  splitRoleRows,
  unchanged,
  type RoleEntry,
} from '@/features/description/roles';
import type { CustomInfo, Description } from '@/model/document';
import {
  cleanDescription,
  formFromDescription,
  requiredIssues,
  rolesEdited,
  setAtPath,
  textFields,
  type DescriptionForm,
} from '@/views/description/model';

interface Row {
  infoType: string;
  text: string;
}

interface Entry {
  role: string;
  lastName: string;
  firstName: string;
  middleName: string;
  row: number;
}

interface Expected {
  source: string;
  rows: Row[];
  entries: Entry[];
  roles: Record<string, string[][]>;
  plainRows: Row[];
  edge: { rows: Row[]; entries: Entry[]; roles: Record<string, string[][]>; plainRows: Row[] };
}

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/books',
);

const EXPECTED = JSON.parse(
  readFileSync(path.join(FIXTURES, 'maxlib-roles.expected.json'), 'utf8'),
) as Expected;

function description(customInfo: CustomInfo[]): Description {
  return {
    titleInfo: {
      genres: [{ code: 'sf' }],
      authors: [{ firstName: 'Автор', lastName: 'Тестовый', homePages: [], emails: [] }],
      bookTitle: 'Проверочная книга',
      coverpage: [],
      lang: 'ru',
      translators: [],
      sequences: [],
    },
    documentInfo: {
      authors: [],
      date: { text: '' },
      srcUrls: [],
      id: '',
      version: '1.0',
      publishers: [],
    },
    customInfo,
    outputs: [],
  };
}

const names = (e: Pick<Entry, 'lastName' | 'firstName' | 'middleName'>) => [
  e.lastName,
  e.firstName,
  e.middleName,
];

describe('roles: the table of the six Maxima Library roles', () => {
  it('lists the roles in the data-model order with their exact info-type labels', () => {
    expect(ROLES).toEqual([
      'illustrator',
      'editor',
      'compiler',
      'designer',
      'commentator',
      'aboutTheAuthor',
    ]);
    expect(ROLES.map((role) => INFO_TYPE_BY_ROLE[role])).toEqual([
      'mlillustrator',
      'mleditor',
      'mlcompiler',
      'mldesigner',
      'mlcommentator',
      'mlabouttheauthor',
    ]);
    for (const role of ROLES) expect(ROLE_BY_INFO_TYPE.get(INFO_TYPE_BY_ROLE[role])).toBe(role);
    // Exact letters: the library's `array_search(..., true)`.
    expect(ROLE_BY_INFO_TYPE.get('MlEditor')).toBeUndefined();
    expect(ROLE_BY_INFO_TYPE.get(' mleditor')).toBeUndefined();
    expect(ROLE_BY_INFO_TYPE.get('mleditorid')).toBeUndefined();
    expect(ROLE_BY_INFO_TYPE.get('constructor')).toBeUndefined();
  });

  it('records where the fixtures come from', () => {
    expect(EXPECTED.source).toContain('check-fbd-roles.sh');
    expect(EXPECTED.rows).toHaveLength(9);
    expect(EXPECTED.edge.rows).toHaveLength(11);
  });
});

describe('parseRoleRow (FR-022, data-model §3.3)', () => {
  it('reads every row of the library fixture as the library does, the record numbers excluded', () => {
    EXPECTED.rows.forEach((row, index) => {
      const entry = EXPECTED.entries.find((e) => e.row === index);
      const parsed = parseRoleRow(row);
      if (entry) {
        expect(parsed).toEqual({
          role: entry.role,
          lastName: entry.lastName,
          firstName: entry.firstName,
          middleName: entry.middleName,
        });
        expect(isRoleRow(row)).toBe(true);
      } else {
        expect(parsed).toBeNull();
        expect(isRoleRow(row)).toBe(false);
      }
    });
    // The grouped view of the same data (`assert_person_in_role`).
    for (const [role, persons] of Object.entries(EXPECTED.roles)) {
      const read = EXPECTED.rows
        .map(parseRoleRow)
        .filter((p): p is NonNullable<typeof p> => p !== null && p.role === role)
        .map(names);
      expect(read).toEqual(persons);
    }
  });

  it('reads the edge fixture: surname only, Ю Ю Ю, two illustrators, the spaces of the file', () => {
    const edge = EXPECTED.edge;
    edge.rows.forEach((row, index) => {
      const entry = edge.entries.find((e) => e.row === index);
      const parsed = parseRoleRow(row);
      if (entry) {
        expect(parsed).toEqual({
          role: entry.role,
          lastName: entry.lastName,
          firstName: entry.firstName,
          middleName: entry.middleName,
        });
      } else {
        expect(parsed).toBeNull();
      }
    });
    for (const [role, persons] of Object.entries(edge.roles)) {
      const read = edge.rows
        .map(parseRoleRow)
        .filter((p): p is NonNullable<typeof p> => p !== null && p.role === role)
        .map(names);
      expect(read).toEqual(persons);
    }
    expect(splitRoleRows(edge.rows).plainRows).toEqual(edge.plainRows);
  });

  it('matches the info-type by exact letters', () => {
    expect(parseRoleRow({ infoType: 'MlEditor', text: 'Регистров Р Р' })).toBeNull();
    expect(parseRoleRow({ infoType: 'mleditor ', text: 'Регистров Р Р' })).toBeNull();
    expect(parseRoleRow({ infoType: 'mleditorid', text: '4712 Редакторов Роман' })).toBeNull();
    expect(parseRoleRow({ infoType: 'mlseriesid', text: '99 Какая-то серия' })).toBeNull();
    expect(parseRoleRow({ infoType: '', text: 'Иванов Иван' })).toBeNull();
  });

  it('trims ASCII whitespace at both ends only and splits on U+0020 alone', () => {
    expect(parseRoleRow({ infoType: 'mleditor', text: '  Пробелов Пётр Петрович ' })).toEqual({
      role: 'editor',
      lastName: 'Пробелов',
      firstName: 'Пётр',
      middleName: 'Петрович',
    });
    expect(parseRoleRow({ infoType: 'mleditor', text: '\n\t Иванов Иван\r\n' })).toEqual({
      role: 'editor',
      lastName: 'Иванов',
      firstName: 'Иван',
      middleName: '',
    });
    // A no-break space is not a separator; a tab inside is kept as a character of the part.
    expect(parseRoleRow({ infoType: 'mleditor', text: 'Иванов\u00a0Иван' })).toEqual({
      role: 'editor',
      lastName: 'Иванов\u00a0Иван',
      firstName: '',
      middleName: '',
    });
    // Consecutive spaces give empty parts, as `preg_split('/ /')` does.
    expect(parseRoleRow({ infoType: 'mldesigner', text: 'Дизайнеров  Данилович' })).toEqual({
      role: 'designer',
      lastName: 'Дизайнеров',
      firstName: '',
      middleName: 'Данилович',
    });
  });

  it('refuses an empty text and more than three parts; the row stays a plain Custom info row', () => {
    expect(parseRoleRow({ infoType: 'mlcommentator', text: '' })).toBeNull();
    expect(parseRoleRow({ infoType: 'mlcommentator', text: '  \n ' })).toBeNull();
    expect(
      parseRoleRow({ infoType: 'mlabouttheauthor', text: 'Первый Второй Третий Четвёртый Пятый' }),
    ).toBeNull();
    expect(parseRoleRow({ infoType: 'mlabouttheauthor', text: 'Первый Второй Третий ' })).toEqual({
      role: 'aboutTheAuthor',
      lastName: 'Первый',
      firstName: 'Второй',
      middleName: 'Третий',
    });
    expect(
      parseRoleRow({ infoType: 'mlabouttheauthor', text: 'Первый Второй  Четвёртый' }),
    ).toBeNull();
  });

  it('turns `_` back into spaces and adds no `.` to a one-letter name', () => {
    expect(parseRoleRow({ infoType: 'mleditor', text: 'Де_Голль Шарль' })).toEqual({
      role: 'editor',
      lastName: 'Де Голль',
      firstName: 'Шарль',
      middleName: '',
    });
    expect(parseRoleRow({ infoType: 'mlcompiler', text: 'Ю Ю Ю' })).toEqual({
      role: 'compiler',
      lastName: 'Ю',
      firstName: 'Ю',
      middleName: 'Ю',
    });
    expect(parseRoleRow({ infoType: 'mlillustrator', text: 'Однофамильцев' })).toEqual({
      role: 'illustrator',
      lastName: 'Однофамильцев',
      firstName: '',
      middleName: '',
    });
  });
});

describe('formatRoleText (FR-021, data-model §3.4 - the FBD Maker rule)', () => {
  const text = (lastName: string, firstName: string, middleName: string) =>
    formatRoleText({ lastName, firstName, middleName });

  it('writes the examples of the data model', () => {
    expect(text('Де Голль', 'Шарль', '')).toBe('Де_Голль Шарль');
    expect(text('', 'А', '')).toBe('А');
    expect(text('Дизайнеров', '', 'Данилович')).toBe('Дизайнеров  Данилович');
    expect(text('Илюстраторов', 'Илья', 'Ильич')).toBe('Илюстраторов Илья Ильич');
    expect(text('Однофамильцев', '', '')).toBe('Однофамильцев');
  });

  it('adds no `.` to a one-letter name in any part (the library reader adds its own)', () => {
    expect(text('Азбукин', 'А', 'Б')).toBe('Азбукин А Б');
    expect(text('Я', 'Ярослав', 'Я')).toBe('Я Ярослав Я');
    expect(text('Ю', 'Ю', 'Ю')).toBe('Ю Ю Ю');
    expect(text('', '', 'А')).toBe('А');
  });

  it('trims each part, replaces spaces inside a part by `_` and trims the whole text', () => {
    expect(text('  Пробелов ', ' Пётр', 'Петрович ')).toBe('Пробелов Пётр Петрович');
    expect(text(' Де  Голль ', 'Шарль', '')).toBe('Де__Голль Шарль');
    expect(text('', 'Шарль', '')).toBe('Шарль');
    expect(text('', '', '')).toBe('');
    expect(text('  ', ' ', '')).toBe('');
    // A hyphen, an apostrophe and a typed underscore are written as they are.
    expect(text("Д'Артаньян-Петров", 'Шарль', '')).toBe("Д'Артаньян-Петров Шарль");
    expect(text('A_B', 'C', '')).toBe('A_B C');
    // Only U+0020 becomes `_`; other white space inside a part stays.
    expect(text('Иванов\u00a0Иван', '', '')).toBe('Иванов\u00a0Иван');
  });

  it('reads back what it wrote', () => {
    for (const entry of [...EXPECTED.entries, ...EXPECTED.edge.entries]) {
      const written = formatRoleText(entry);
      const parsed = parseRoleRow({
        infoType: INFO_TYPE_BY_ROLE[entry.role as never],
        text: written,
      });
      expect(parsed && names(parsed)).toEqual(names(entry));
    }
  });
});

describe('unchanged, roleEntryToRow and splitRoleRows', () => {
  const source = { key: 'r1', infoType: 'mleditor', text: '  Пробелов Пётр Петрович ', lang: 'ru' };
  const entry = (overrides: Partial<RoleEntry> = {}): RoleEntry => ({
    role: 'editor',
    lastName: 'Пробелов',
    firstName: 'Пётр',
    middleName: 'Петрович',
    source,
    ...overrides,
  });

  it('is unchanged while the trimmed names and the role equal the row as read', () => {
    expect(unchanged(entry())).toBe(true);
    expect(unchanged(entry({ lastName: ' Пробелов ' }))).toBe(true);
    expect(unchanged(entry({ middleName: 'Павлович' }))).toBe(false);
    expect(unchanged(entry({ role: 'illustrator' }))).toBe(false);
    expect(unchanged(entry({ source: undefined }))).toBe(false);
    // An underscore the user typed is not the space the file carries.
    expect(
      unchanged(
        entry({
          source: { key: 'r2', infoType: 'mleditor', text: 'Де_Голль Шарль' },
          lastName: 'Де_Голль',
          firstName: 'Шарль',
          middleName: '',
        }),
      ),
    ).toBe(false);
    expect(
      unchanged(
        entry({
          source: { key: 'r2', infoType: 'mleditor', text: 'Де_Голль Шарль' },
          lastName: 'Де Голль',
          firstName: 'Шарль',
          middleName: '',
        }),
      ),
    ).toBe(true);
  });

  it('writes an unchanged entry verbatim from its source and a changed one in the library format, lang kept', () => {
    expect(roleEntryToRow(entry())).toEqual({
      infoType: 'mleditor',
      text: '  Пробелов Пётр Петрович ',
      lang: 'ru',
    });
    expect(roleEntryToRow(entry({ middleName: 'Павлович' }))).toEqual({
      infoType: 'mleditor',
      text: 'Пробелов Пётр Павлович',
      lang: 'ru',
    });
    expect(roleEntryToRow(entry({ role: 'compiler' }))).toEqual({
      infoType: 'mlcompiler',
      text: 'Пробелов Пётр Петрович',
      lang: 'ru',
    });
    const added = roleEntryToRow(
      entry({ source: undefined, lastName: 'Де Голль', firstName: 'Шарль', middleName: '' }),
    );
    expect(added).toEqual({ infoType: 'mleditor', text: 'Де_Голль Шарль' });
    expect('lang' in added).toBe(false);
    expect(
      roleEntryEmpty(entry({ source: undefined, lastName: ' ', firstName: '', middleName: '' })),
    ).toBe(true);
    expect(roleEntryEmpty(entry())).toBe(false);
  });

  it('splits a customInfo list into role rows and plain rows for the import and export', () => {
    const split = splitRoleRows(EXPECTED.rows);
    expect(split.roleRows).toEqual(EXPECTED.entries.map((e) => EXPECTED.rows[e.row]));
    expect(split.plainRows).toEqual(EXPECTED.plainRows);
    const edge = splitRoleRows(EXPECTED.edge.rows);
    expect(edge.roleRows).toEqual(EXPECTED.edge.entries.map((e) => EXPECTED.edge.rows[e.row]));
    expect(edge.plainRows).toEqual(EXPECTED.edge.plainRows);
    expect(splitRoleRows([])).toEqual({ roleRows: [], plainRows: [] });
  });
});

describe('the Description form: load, fold-back and the edited state (data-model §3.2, §3.5)', () => {
  it('keeps every row in order and tags the role rows at load; the roles carry their source', () => {
    const form = formFromDescription(description(EXPECTED.rows));
    expect(form.customInfo.map((row) => ({ infoType: row.infoType, text: row.text }))).toEqual(
      EXPECTED.rows,
    );
    expect(form.customInfo.map((row) => row.roleRow)).toEqual([
      'r1',
      'r2',
      'r3',
      'r4',
      'r5',
      'r6',
      undefined,
      undefined,
      undefined,
    ]);
    expect(form.roles.map((e) => [e.role, ...names(e), e.source?.key])).toEqual(
      EXPECTED.entries.map((e, k) => [e.role, ...names(e), `r${k + 1}`]),
    );
    expect(form.roles[0]?.source).toEqual({
      key: 'r1',
      infoType: 'mlillustrator',
      text: 'Илюстраторов Илья Ильич',
    });
    // The edge fixture: the plain rows keep their places between the role rows.
    const edge = formFromDescription(description(EXPECTED.edge.rows));
    expect(edge.customInfo.filter((row) => !row.roleRow).map((r) => r.text)).toEqual(
      EXPECTED.edge.plainRows.map((r) => r.text),
    );
    expect(edge.customInfo.map((r) => r.roleRow)).toEqual([
      'r1',
      'r2',
      'r3',
      undefined,
      undefined,
      'r4',
      'r5',
      'r6',
      'r7',
      'r8',
      undefined,
    ]);
    expect(edge.roles.map(names)).toEqual(EXPECTED.edge.entries.map(names));
    // A description without rows gives an empty list.
    expect(formFromDescription(description([])).roles).toEqual([]);
    expect(formFromDescription(description([])).customInfo).toEqual([]);
  });

  it('folds an unedited list back verbatim and in place; plain rows are trimmed as today', () => {
    const rows: CustomInfo[] = [
      { infoType: 'mleditor', text: '  Пробелов Пётр Петрович ', lang: 'ru' },
      { infoType: ' note ', text: ' hello ' },
      { infoType: 'mlillustrator', text: 'Первов Пётр Петрович' },
    ];
    const form = formFromDescription(description(rows));
    expect(rolesEdited(form)).toBe(false);
    const clean = cleanDescription(form);
    expect(clean.customInfo).toEqual([
      { infoType: 'mleditor', text: '  Пробелов Пётр Петрович ', lang: 'ru' },
      { infoType: 'note', text: 'hello' },
      { infoType: 'mlillustrator', text: 'Первов Пётр Петрович' },
    ]);
    // Nothing of the form's marker reaches the model.
    for (const row of clean.customInfo) expect('roleRow' in row).toBe(false);
    // An unrelated edit does not touch the rows.
    const edited = setAtPath(form, 'titleInfo.bookTitle', 'Другая');
    expect(cleanDescription(edited).customInfo).toEqual(clean.customInfo);
    // Both fixtures round-trip row for row.
    expect(cleanDescription(formFromDescription(description(EXPECTED.rows))).customInfo).toEqual(
      EXPECTED.rows,
    );
    expect(
      cleanDescription(formFromDescription(description(EXPECTED.edge.rows))).customInfo,
    ).toEqual(EXPECTED.edge.rows);
  });

  it('writes an edited list after the plain rows in list order, unchanged entries still verbatim', () => {
    const form = formFromDescription(description(EXPECTED.edge.rows));
    const edited = setAtPath(form, 'roles.7.middleName', 'Павлович');
    expect(rolesEdited(edited)).toBe(true);
    const clean = cleanDescription(edited);
    expect(clean.customInfo).toEqual([
      ...EXPECTED.edge.plainRows,
      ...EXPECTED.edge.entries.map((e) =>
        e.row === 9
          ? { infoType: 'mleditor', text: 'Пробелов Пётр Павлович' }
          : EXPECTED.edge.rows[e.row],
      ),
    ]);
    // `Де_Голль Шарль` and `Дизайнеров  Данилович` are still the file's characters.
    expect(clean.customInfo).toContainEqual({ infoType: 'mleditor', text: 'Де_Голль Шарль' });
    expect(clean.customInfo).toContainEqual({
      infoType: 'mldesigner',
      text: 'Дизайнеров  Данилович',
    });
  });

  it('adds a new entry after the rows in the library format and drops an all-empty one', () => {
    const form = formFromDescription(description(EXPECTED.rows));
    const added: RoleEntry[] = [
      ...form.roles,
      { role: 'editor', lastName: 'Де Голль', firstName: 'Шарль', middleName: '' },
      { role: 'compiler', lastName: '', firstName: 'А', middleName: '' },
      { role: 'designer', lastName: ' ', firstName: '', middleName: '' },
    ];
    const next: DescriptionForm = { ...form, roles: added };
    expect(rolesEdited(next)).toBe(true);
    expect(cleanDescription(next).customInfo).toEqual([
      ...EXPECTED.plainRows,
      ...EXPECTED.entries.map((e) => EXPECTED.rows[e.row]),
      { infoType: 'mleditor', text: 'Де_Голль Шарль' },
      { infoType: 'mlcompiler', text: 'А' },
    ]);
    // Removed: not written; the others keep their relative order.
    const removed: DescriptionForm = { ...form, roles: form.roles.filter((_, k) => k !== 2) };
    expect(rolesEdited(removed)).toBe(true);
    expect(cleanDescription(removed).customInfo).toEqual([
      ...EXPECTED.plainRows,
      ...EXPECTED.entries.filter((e) => e.role !== 'compiler').map((e) => EXPECTED.rows[e.row]),
    ]);
  });

  it('keeps lang on an edited entry and counts an edit undone by value as no edit', () => {
    const rows: CustomInfo[] = [
      { infoType: 'mlseriesid', text: '99 Какая-то серия' },
      { infoType: 'mleditor', text: 'Редакторов Роман Романович', lang: 'ru' },
    ];
    const form = formFromDescription(description(rows));
    const edited = setAtPath(form, 'roles.0.firstName', 'Ромен');
    expect(rolesEdited(edited)).toBe(true);
    expect(cleanDescription(edited).customInfo).toEqual([
      { infoType: 'mlseriesid', text: '99 Какая-то серия' },
      { infoType: 'mleditor', text: 'Редакторов Ромен Романович', lang: 'ru' },
    ]);
    const back = setAtPath(edited, 'roles.0.firstName', 'Роман');
    expect(rolesEdited(back)).toBe(false);
    expect(cleanDescription(back).customInfo).toEqual(rows);
    // Typed with surrounding spaces, the value still equals the one read.
    const spaced = setAtPath(edited, 'roles.0.firstName', ' Роман ');
    expect(rolesEdited(spaced)).toBe(false);
    // Added and removed again: unedited.
    const extra: RoleEntry = { role: 'editor', lastName: 'X', firstName: '', middleName: '' };
    const added: DescriptionForm = { ...form, roles: [...form.roles, extra] };
    expect(rolesEdited(added)).toBe(true);
    const addedAndRemoved: DescriptionForm = { ...added, roles: added.roles.slice(0, 1) };
    expect(rolesEdited(addedAndRemoved)).toBe(false);
    // A plain description (no form state) is accepted and folds as before.
    expect(cleanDescription(description(rows)).customInfo).toEqual(rows);
  });

  it('flags an entry without a last name while a first or middle name is given (incompleteRoles)', () => {
    const form = formFromDescription(description([]));
    const roles: RoleEntry[] = [
      { role: 'editor', lastName: '', firstName: 'Шарль', middleName: '' },
      { role: 'editor', lastName: '  ', firstName: '', middleName: 'Иванович' },
      { role: 'editor', lastName: 'Однофамильцев', firstName: '', middleName: '' },
      { role: 'editor', lastName: '', firstName: '', middleName: '' },
      { role: 'editor', lastName: 'Де Голль', firstName: 'Шарль', middleName: '' },
    ];
    const issues = requiredIssues({ ...form, roles });
    expect([...issues.incompleteRoles].sort()).toEqual(['roles.0', 'roles.1']);
    expect(requiredIssues(description([])).incompleteRoles.size).toBe(0);
    // Written as the format allows: the name lands in the last-name position.
    expect(cleanDescription({ ...form, roles }).customInfo).toEqual([
      { infoType: 'mleditor', text: 'Шарль' },
      { infoType: 'mleditor', text: 'Иванович' },
      { infoType: 'mleditor', text: 'Однофамильцев' },
      { infoType: 'mleditor', text: 'Де_Голль Шарль' },
    ]);
  });

  it('puts the three name fields of every entry into the Find / Replace scope and skips the tagged rows', () => {
    const form = formFromDescription(description(EXPECTED.rows));
    const keys = textFields(form).map((f) => f.key);
    for (let k = 0; k < 6; k += 1) {
      expect(keys).toContain(`roles.${k}.lastName`);
      expect(keys).toContain(`roles.${k}.firstName`);
      expect(keys).toContain(`roles.${k}.middleName`);
      expect(keys).not.toContain(`customInfo.${k}.text`);
      expect(keys).not.toContain(`customInfo.${k}.infoType`);
    }
    // The plain rows keep their real indices.
    expect(keys).toContain('customInfo.6.text');
    expect(keys).toContain('customInfo.8.infoType');
    // After Translators, before Sequences - the order of the Title info group.
    const roleIndex = keys.indexOf('roles.0.lastName');
    expect(roleIndex).toBeGreaterThan(keys.indexOf('titleInfo.bookTitle'));
    expect(roleIndex).toBeLessThan(keys.indexOf('documentInfo.id'));
    expect(textFields(form).find((f) => f.key === 'roles.4.firstName')?.value).toBe('Кузьма');
    expect(keys.indexOf('roles.0.lastName')).toBeLessThan(keys.indexOf('roles.0.firstName'));
    expect(keys.indexOf('roles.0.firstName')).toBeLessThan(keys.indexOf('roles.0.middleName'));
  });
});
