/**
 * Unit tests for FB2 `<custom-info>` Maxima Library identity codec, subsequence binding,
 * document-order insertion, subtree deletion, and atomic single-step Undo/Redo
 * (feature 021, T033, FR-025..FR-028, data-model.md §4, contracts/lookup-v2.md §5).
 */

import {
  bindRowIdentity,
  collectSubtreeRowPaths,
  deriveMaximaBindings,
  formatIdentityText,
  formatPersonDisplayName,
  identityInfoTypeForRole,
  MAXIMA_IDENTITY_INFO_TYPES,
  MAXIMA_LIBRARY_CUSTOM_INFO_TYPES,
  MAXIMA_SERIES_IDENTITY_INFO_TYPE,
  parseIdentityRow,
  roleToMaximaPersonRole,
  unbindRowIdentities,
} from '@/features/description/maximaIdentities';
import { ROLES } from '@/features/description/roles';
import type { Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';
import type { MaximaPersonRole } from '@/rpc/types';
import { DescriptionController } from '@/views/description/binding';
import { formFromDescription, setAtPath } from '@/views/description/model';

import { fakeDocument } from './features/testUtils';

function makeForm(overrides?: Partial<Document['description']>) {
  const base = fakeDocument();
  return formFromDescription({ ...base.description, ...overrides });
}

describe('maximaIdentities codec and bindings (T033)', () => {
  it('registers all 9 ml*id identity markers and all 15 Maxima Library custom-info types', () => {
    expect(MAXIMA_IDENTITY_INFO_TYPES.size).toBe(9);
    expect(MAXIMA_LIBRARY_CUSTOM_INFO_TYPES.size).toBe(15);

    const personRoles: MaximaPersonRole[] = [
      'author',
      'translator',
      'illustrator',
      'editor',
      'compiler',
      'designer',
      'commentator',
      'abouttheauthor',
    ];
    for (const role of personRoles) {
      const marker = identityInfoTypeForRole(role);
      expect(MAXIMA_IDENTITY_INFO_TYPES.has(marker)).toBe(true);
      expect(MAXIMA_LIBRARY_CUSTOM_INFO_TYPES.has(marker)).toBe(true);
    }
    expect(MAXIMA_IDENTITY_INFO_TYPES.has(MAXIMA_SERIES_IDENTITY_INFO_TYPE)).toBe(true);
    expect(roleToMaximaPersonRole('aboutTheAuthor')).toBe('abouttheauthor');
    for (const role of ROLES) {
      expect(
        MAXIMA_IDENTITY_INFO_TYPES.has(identityInfoTypeForRole(roleToMaximaPersonRole(role))),
      ).toBe(true);
    }
  });

  it('formats and parses <id> <displayName> including multi-word parts and empty middle names', () => {
    const full = formatPersonDisplayName({
      lastName: 'де ла Крус',
      firstName: 'Хуан Карлос',
      middleName: '',
    });
    expect(full).toBe('де ла Крус Хуан Карлос');
    expect(formatIdentityText(1042, full)).toBe('1042 де ла Крус Хуан Карлос');

    const parsed = parseIdentityRow({
      infoType: 'mlauthorid',
      text: '1042 де ла Крус Хуан Карлос',
    });
    expect(parsed).toEqual({
      infoType: 'mlauthorid',
      libraryId: 1042,
      displayName: 'де ла Крус Хуан Карлос',
    });

    // Rejects invalid IDs, empty display names, role rows, and non-identity info-types.
    expect(parseIdentityRow({ infoType: 'mlauthorid', text: '0 Толстой' })).toBeNull();
    expect(parseIdentityRow({ infoType: 'mlauthorid', text: '123   ' })).toBeNull();
    expect(parseIdentityRow({ infoType: 'other', text: '123 Толстой' })).toBeNull();
    expect(
      parseIdentityRow({ infoType: 'mlauthorid', text: '123 Толстой', roleRow: 'r0' }),
    ).toBeNull();
  });

  it('pairs duplicate names in document order and preserves unmatched ml*id rows verbatim', () => {
    const form = makeForm({
      titleInfo: {
        ...fakeDocument().description.titleInfo,
        authors: [
          { lastName: 'Иванов', firstName: 'Иван', middleName: '', homePages: [], emails: [] },
          { lastName: 'Иванов', firstName: 'Иван', middleName: '', homePages: [], emails: [] },
        ],
      },
      customInfo: [
        { infoType: 'unrelated', text: 'keep me' },
        { infoType: 'mlauthorid', text: '101 Иванов Иван' },
        { infoType: 'mlauthorid', text: '999 Несуществующий Автор' },
        { infoType: 'mlauthorid', text: '202 Иванов Иван' },
      ],
    });

    const bindings = deriveMaximaBindings(form);
    expect(bindings.byRowPath.get('titleInfo.authors.0')).toEqual({
      libraryId: 101,
      customInfoIndex: 1,
    });
    expect(bindings.byRowPath.get('titleInfo.authors.1')).toEqual({
      libraryId: 202,
      customInfoIndex: 3,
    });
    expect(bindings.pairedCustomInfoIndices.has(2)).toBe(false);

    // Unbinding author 0 removes ONLY index 1; unmatched index 2 and author 1 stay intact.
    const afterUnbind = unbindRowIdentities(form, ['titleInfo.authors.0'], bindings);
    expect(afterUnbind.customInfo.map((c) => `${c.infoType}:${c.text}`)).toEqual([
      'unrelated:keep me',
      'mlauthorid:999 Несуществующий Автор',
      'mlauthorid:202 Иванов Иван',
    ]);
  });

  it('inserts ml*id entries in document order across all 8 roles and nested author series', () => {
    let form = makeForm({
      titleInfo: {
        ...fakeDocument().description.titleInfo,
        authors: [
          {
            lastName: 'Толстой',
            firstName: 'Лев',
            middleName: 'Николаевич',
            homePages: [],
            emails: [],
          },
          {
            lastName: 'Достоевский',
            firstName: 'Фёдор',
            middleName: 'Михайлович',
            homePages: [],
            emails: [],
          },
        ],
        translators: [
          { lastName: 'Лозинский', firstName: 'Михаил', middleName: '', homePages: [], emails: [] },
        ],
        sequences: [
          {
            name: 'Мир Полдня',
            number: 1,
            children: [{ name: 'Полдень, XXII век', number: 2, children: [] }],
          },
        ],
      },
      customInfo: [
        { infoType: 'mlillustrator', text: 'Билибин_Иван_Яковлевич' },
        { infoType: 'mlabouttheauthor', text: 'Критик_Иван_' },
      ],
    });

    // Bind author 1 first, then author 0 -> author 0 inserts BEFORE author 1 in document order.
    form = bindRowIdentity(
      form,
      'titleInfo.authors.1',
      'mlauthorid',
      102,
      'Достоевский Фёдор Михайлович',
    );
    form = bindRowIdentity(
      form,
      'titleInfo.authors.0',
      'mlauthorid',
      101,
      'Толстой Лев Николаевич',
    );
    form = bindRowIdentity(
      form,
      'titleInfo.translators.0',
      'mltranslatorid',
      201,
      'Лозинский Михаил',
    );
    form = bindRowIdentity(form, 'roles.0', 'mlillustratorid', 301, 'Билибин Иван Яковлевич');
    form = bindRowIdentity(form, 'roles.1', 'mlabouttheauthorid', 306, 'Критик Иван');
    form = bindRowIdentity(
      form,
      'titleInfo.sequences.0.children.0',
      'mlseriesid',
      302,
      'Полдень, XXII век',
    );
    form = bindRowIdentity(form, 'titleInfo.sequences.0', 'mlseriesid', 301, 'Мир Полдня');

    const bindings = deriveMaximaBindings(form);
    expect(bindings.byRowPath.get('titleInfo.authors.0')?.libraryId).toBe(101);
    expect(bindings.byRowPath.get('titleInfo.authors.1')?.libraryId).toBe(102);
    expect(bindings.byRowPath.get('titleInfo.translators.0')?.libraryId).toBe(201);
    expect(bindings.byRowPath.get('roles.0')?.libraryId).toBe(301);
    expect(bindings.byRowPath.get('roles.1')?.libraryId).toBe(306);
    expect(bindings.byRowPath.get('titleInfo.sequences.0')?.libraryId).toBe(301);
    expect(bindings.byRowPath.get('titleInfo.sequences.0.children.0')?.libraryId).toBe(302);

    const authorIds = form.customInfo.filter((r) => r.infoType === 'mlauthorid').map((r) => r.text);
    expect(authorIds).toEqual(['101 Толстой Лев Николаевич', '102 Достоевский Фёдор Михайлович']);

    const seriesIds = form.customInfo.filter((r) => r.infoType === 'mlseriesid').map((r) => r.text);
    expect(seriesIds).toEqual(['301 Мир Полдня', '302 Полдень, XXII век']);

    // Editing non-lookup fields preserves confirmation.
    const editedNick = setAtPath(form, 'titleInfo.authors.0.nickname', 'Count');
    const editedNum = setAtPath(editedNick, 'titleInfo.sequences.0.number', 7);
    expect(deriveMaximaBindings(editedNum).byRowPath.get('titleInfo.authors.0')?.libraryId).toBe(
      101,
    );
    expect(deriveMaximaBindings(editedNum).byRowPath.get('titleInfo.sequences.0')?.libraryId).toBe(
      301,
    );

    // Deleting parent series removes both parent and nested child mlseriesid entries.
    const subtreePaths = collectSubtreeRowPaths(
      'titleInfo.sequences.0',
      deriveMaximaBindings(editedNum),
    );
    expect(subtreePaths).toEqual(['titleInfo.sequences.0', 'titleInfo.sequences.0.children.0']);
    const afterSubtreeDelete = unbindRowIdentities(
      setAtPath(editedNum, 'titleInfo.sequences', []),
      subtreePaths,
      deriveMaximaBindings(editedNum),
    );
    expect(afterSubtreeDelete.customInfo.filter((r) => r.infoType === 'mlseriesid')).toHaveLength(
      0,
    );
  });

  it('withdraws confirmation immediately when the ml*id row is edited or deleted in Custom info', () => {
    let form = makeForm({
      titleInfo: {
        ...fakeDocument().description.titleInfo,
        authors: [
          { lastName: 'Толстой', firstName: 'Лев', middleName: '', homePages: [], emails: [] },
        ],
      },
    });
    form = bindRowIdentity(form, 'titleInfo.authors.0', 'mlauthorid', 101, 'Толстой Лев');
    expect(deriveMaximaBindings(form).byRowPath.get('titleInfo.authors.0')?.libraryId).toBe(101);

    // Direct text edit in Custom info breaks exact name match -> badge immediately withdrawn.
    const ciIndex =
      deriveMaximaBindings(form).byRowPath.get('titleInfo.authors.0')!.customInfoIndex;
    const editedCustom = setAtPath(form, `customInfo.${ciIndex}.text`, '101 Толстой Алексей');
    expect(deriveMaximaBindings(editedCustom).byRowPath.has('titleInfo.authors.0')).toBe(false);

    // Direct delete in Custom info withdraws confirmation.
    const deletedCustom = {
      ...form,
      customInfo: form.customInfo.filter((_, i) => i !== ciIndex),
    };
    expect(deriveMaximaBindings(deletedCustom).byRowPath.has('titleInfo.authors.0')).toBe(false);
  });

  it('commits pick and withdrawal atomically so Undo and Redo revert both fields and ml*id in one step', () => {
    const store = createAppStore();
    const undo = new UndoCoordinator();
    const doc = fakeDocument();
    doc.description.titleInfo.authors = [
      { lastName: 'Толс', firstName: '', middleName: 'Старое', homePages: [], emails: [] },
    ];
    actions.setDocument(store, doc);
    const controller = new DescriptionController({ store, undo });
    undo.registerView('description', controller.undoAdapter);

    // Single atomic pick updates all 3 name parts (clearing middleName) AND inserts mlauthorid.
    controller.update((current) => {
      const prev = deriveMaximaBindings(current);
      let next = setAtPath(current, 'titleInfo.authors.0.lastName', 'Толстой');
      next = setAtPath(next, 'titleInfo.authors.0.firstName', 'Лев');
      next = setAtPath(next, 'titleInfo.authors.0.middleName', '');
      return bindRowIdentity(next, 'titleInfo.authors.0', 'mlauthorid', 101, 'Толстой Лев', prev);
    });

    expect(controller.currentForm!.titleInfo.authors[0]!.lastName).toBe('Толстой');
    expect(controller.currentForm!.titleInfo.authors[0]!.middleName).toBe('');
    expect(
      deriveMaximaBindings(controller.currentForm!).byRowPath.get('titleInfo.authors.0')?.libraryId,
    ).toBe(101);

    // One Undo step reverts BOTH name parts AND the mlauthorid custom-info row together.
    expect(undo.undo()).toBe(true);
    expect(controller.currentForm!.titleInfo.authors[0]!.lastName).toBe('Толс');
    expect(controller.currentForm!.titleInfo.authors[0]!.middleName).toBe('Старое');
    expect(deriveMaximaBindings(controller.currentForm!).byRowPath.has('titleInfo.authors.0')).toBe(
      false,
    );
    expect(store.getState().document!.description.customInfo).toHaveLength(0);

    // One Redo step restores BOTH together.
    expect(undo.redo()).toBe(true);
    expect(controller.currentForm!.titleInfo.authors[0]!.lastName).toBe('Толстой');
    expect(
      deriveMaximaBindings(controller.currentForm!).byRowPath.get('titleInfo.authors.0')?.libraryId,
    ).toBe(101);
  });
});
