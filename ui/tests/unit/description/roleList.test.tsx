/**
 * Feature 004, User Story 3 (T034) - the "Other persons" list is a list of its own: empty for a
 * new document with the Add control alone, Add appends an entry with the first role and empty
 * names, Remove drops it; it sits in the Title info form after Translators and before Sequences
 * and not in the source title info; the Authors and Translators lists (`PersonList`) are left
 * exactly as release 0.0.3 had them (requester's correction of 2026-10-20: no reordering of
 * persons anywhere).
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore, type ReactNode } from 'react';

import { AppServicesContext, createAppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import type { CustomInfo, Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { descriptionControllerFor, type DescriptionController } from '@/views/description/binding';
import { DescriptionFormContext } from '@/views/description/formContext';
import { EMPTY_GENRES, EMPTY_LANGUAGES } from '@/views/description/resources';
import { RoleList } from '@/views/description/RoleList';
import { TitleInfoForm } from '@/views/description/TitleInfoForm';

import { fakeDocument, fakeRpc } from '../features/testUtils';

beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
  document.elementFromPoint = () => null;
});

function documentWith(customInfo: CustomInfo[]): Document {
  const base = fakeDocument();
  return { ...base, description: { ...base.description, customInfo } };
}

/** The form context the Description view provides, fed by the controller's snapshot. */
function Harness({
  controller,
  children,
}: {
  controller: DescriptionController;
  children: ReactNode;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!snapshot.form || !snapshot.issues) return null;
  return (
    <DescriptionFormContext.Provider
      value={{
        controller,
        form: snapshot.form,
        issues: snapshot.issues,
        language: 'en',
        genres: EMPTY_GENRES,
        languages: EMPTY_LANGUAGES,
        reloadGenres: () => {},
        docId: snapshot.docId,
        binaries: [],
        readOnly: false,
      }}
    >
      {children}
    </DescriptionFormContext.Provider>
  );
}

async function setup(document: Document, children: ReactNode) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  actions.setDocument(store, document);
  const rpc = fakeRpc({ 'doc.position': {}, 'binary.list': [] });
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const controller = descriptionControllerFor(store);
  const user = userEvent.setup();
  render(
    <AppServicesContext.Provider value={services}>
      <Harness controller={controller}>{children}</Harness>
    </AppServicesContext.Provider>,
  );
  return { store, controller, user };
}

const customInfo = (store: ReturnType<typeof createAppStore>) =>
  store.getState().document!.description.customInfo;

describe('RoleList - the Other persons list (US3 scenario 10, FR-020)', () => {
  it('shows the caption and the Add control only for a document without role rows', async () => {
    await setup(documentWith([]), <RoleList />);
    const list = screen.getByTestId('description-role-list');
    expect(list).toHaveTextContent('Other persons');
    expect(screen.getByTestId('description-role-add')).toBeInTheDocument();
    expect(screen.queryByTestId('description-role-0')).toBeNull();
    // Nothing but the Add control: no entry, no field, no reorder control.
    expect(list.querySelectorAll('button, input, select, textarea')).toHaveLength(1);
    expect(list.querySelectorAll('[data-testid]')).toHaveLength(1);
    expect(list.querySelector('[data-testid$="-up"], [data-testid$="-down"]')).toBeNull();
  });

  it('Add appends an entry with the first role and empty names; Remove drops it', async () => {
    const { store, user } = await setup(documentWith([]), <RoleList />);
    expect(store.getState().modified).toBe(false);
    await user.click(screen.getByTestId('description-role-add'));
    const entry = screen.getByTestId('description-role-0');
    expect(within(entry).getByTestId('description-role-0-role')).toHaveValue('illustrator');
    expect(within(entry).getByTestId('description-role-0-last')).toHaveValue('');
    expect(within(entry).getByTestId('description-role-0-first')).toHaveValue('');
    expect(within(entry).getByTestId('description-role-0-middle')).toHaveValue('');
    // The six roles, the library's English names.
    expect(
      [...within(entry).getByTestId('description-role-0-role').querySelectorAll('option')].map(
        (option) => option.textContent,
      ),
    ).toEqual(['Illustrator', 'Editor', 'Compiler', 'Designer', 'Commentator', 'About the author']);
    // An all-empty entry is not written; the document is modified by the structural change.
    expect(customInfo(store)).toEqual([]);
    expect(store.getState().modified).toBe(true);
    expect(screen.queryByTestId('description-role-0-incomplete')).toBeNull();

    await user.selectOptions(screen.getByTestId('description-role-0-role'), 'editor');
    await user.type(screen.getByTestId('description-role-0-first'), 'Шарль');
    // No last name yet: flagged, written as the format allows.
    expect(screen.getByTestId('description-role-0-incomplete')).toBeInTheDocument();
    expect(customInfo(store)).toEqual([{ infoType: 'mleditor', text: 'Шарль' }]);
    await user.type(screen.getByTestId('description-role-0-last'), 'Де Голль');
    expect(screen.queryByTestId('description-role-0-incomplete')).toBeNull();
    expect(customInfo(store)).toEqual([{ infoType: 'mleditor', text: 'Де_Голль Шарль' }]);

    await user.click(screen.getByTestId('description-role-add'));
    expect(screen.getByTestId('description-role-1-role')).toHaveValue('illustrator');
    await user.click(screen.getByTestId('description-role-0-remove'));
    // The second entry moved up to index 0; the removed one is gone from the model.
    expect(screen.queryByTestId('description-role-1')).toBeNull();
    expect(screen.getByTestId('description-role-0-role')).toHaveValue('illustrator');
    expect(customInfo(store)).toEqual([]);
    await user.click(screen.getByTestId('description-role-0-remove'));
    expect(screen.queryByTestId('description-role-0')).toBeNull();
    expect(
      screen.getByTestId('description-role-list').querySelectorAll('[data-testid]'),
    ).toHaveLength(1);
  });

  it('lists the role rows of an opened description and hides nothing else', async () => {
    const { store, user } = await setup(
      documentWith([
        { infoType: 'mlseriesid', text: '99 Какая-то серия' },
        { infoType: 'mlillustrator', text: 'Илюстраторов Илья Ильич' },
        { infoType: 'mleditor', text: 'Де_Голль Шарль', lang: 'ru' },
      ]),
      <RoleList />,
    );
    expect(screen.getByTestId('description-role-0-role')).toHaveValue('illustrator');
    expect(screen.getByTestId('description-role-0-last')).toHaveValue('Илюстраторов');
    expect(screen.getByTestId('description-role-1-role')).toHaveValue('editor');
    expect(screen.getByTestId('description-role-1-last')).toHaveValue('Де Голль');
    expect(screen.getByTestId('description-role-1-first')).toHaveValue('Шарль');
    expect(screen.queryByTestId('description-role-2')).toBeNull();
    // Unedited: the model is untouched.
    expect(store.getState().modified).toBe(false);
    // An edit rewrites the list after the plain row, the untouched entry verbatim, lang kept.
    await user.type(screen.getByTestId('description-role-1-middle'), 'Ж');
    expect(customInfo(store)).toEqual([
      { infoType: 'mlseriesid', text: '99 Какая-то серия' },
      { infoType: 'mlillustrator', text: 'Илюстраторов Илья Ильич' },
      { infoType: 'mleditor', text: 'Де_Голль Шарль Ж', lang: 'ru' },
    ]);
  });
});

describe('TitleInfoForm - where the list sits (FR-020)', () => {
  it('puts the Other persons list after Translators and before Sequences in the Title info form', async () => {
    await setup(documentWith([]), <TitleInfoForm block="titleInfo" />);
    const form = screen.getByTestId('description-title-info-form');
    const lists = [...form.querySelectorAll('fieldset[data-testid$="-list"]')].map((node) =>
      node.getAttribute('data-testid'),
    );
    expect(lists).toEqual([
      'description-author-list',
      'description-cover-list',
      'description-translator-list',
      'description-role-list',
      'description-sequence-list',
    ]);
    // The Authors and Translators lists are the 0.0.3 ones: Add only in their heading, no
    // reorder control anywhere in the form.
    expect(screen.getByTestId('description-author-add')).toBeInTheDocument();
    expect(screen.getByTestId('description-translator-add')).toBeInTheDocument();
    expect(form.querySelector('[data-testid$="-up"], [data-testid$="-down"]')).toBeNull();
    const authorIds = [...form.querySelectorAll('[data-testid^="description-author-0"]')]
      .map((node) => node.getAttribute('data-testid'))
      .sort();
    expect(authorIds).toEqual(
      [
        'description-author-0',
        'description-author-0-remove',
        'description-author-0-first',
        'description-author-0-first-row',
        'description-author-0-middle',
        'description-author-0-middle-row',
        'description-author-0-last',
        'description-author-0-last-row',
        'description-author-0-nickname',
        'description-author-0-nickname-row',
        'description-author-0-id',
        'description-author-0-id-row',
        'description-author-0-homepage-list',
        'description-author-0-homepage-add',
        'description-author-0-email-list',
        'description-author-0-email-add',
      ].sort(),
    );
  });

  it('offers no role list in the source title info', async () => {
    await setup(documentWith([]), <TitleInfoForm block="srcTitleInfo" />);
    expect(screen.getByTestId('description-sti-title-info-form')).toBeInTheDocument();
    expect(screen.queryByTestId('description-sti-role-list')).toBeNull();
    expect(screen.queryByTestId('description-role-list')).toBeNull();
    expect(screen.getByTestId('description-sti-translator-list')).toBeInTheDocument();
    expect(screen.getByTestId('description-sti-sequence-list')).toBeInTheDocument();
  });
});
