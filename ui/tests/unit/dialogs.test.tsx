import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { ReactNode } from 'react';

import { DialogHost, DialogService, createDialogs } from '@/dialogs';
import { initI18n } from '@/i18n';

async function setup(language: 'en' | 'ru' = 'en') {
  const instance = createInstance();
  await initI18n({ instance, language });
  const service = new DialogService();
  const dialogs = createDialogs(service);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={instance}>{children}</I18nextProvider>
  );
  render(<DialogHost service={service} />, { wrapper });
  return { service, dialogs, user: userEvent.setup() };
}

/**
 * Opens a dialog from outside React and flushes the resulting render. The pending promise is
 * returned inside an object (an async function would otherwise await it).
 */
async function open<T>(fn: () => Promise<T>): Promise<{ result: Promise<T> }> {
  let result!: Promise<T>;
  await act(async () => {
    result = fn();
  });
  return { result };
}

describe('MessageBox', () => {
  it('renders caption, text, icon and the button set; resolves with the clicked button', async () => {
    const { dialogs, user } = await setup();
    const { result: promise } = await open(() =>
      dialogs.showMessage({
        text: 'Save changes to book.fb2?',
        caption: 'Maxima',
        buttons: 'yesNoCancel',
        icon: 'question',
        testId: 'save-prompt',
      }),
    );
    expect(screen.getByTestId('save-prompt-title')).toHaveTextContent('Maxima');
    expect(screen.getByTestId('save-prompt-text')).toHaveTextContent('Save changes to book.fb2?');
    expect(screen.getByTestId('save-prompt-icon-question')).toBeInTheDocument();
    expect(screen.getByTestId('save-prompt-button-yes')).toHaveTextContent('Yes');
    expect(screen.getByTestId('save-prompt-button-no')).toHaveTextContent('No');
    expect(screen.getByTestId('save-prompt-button-cancel')).toHaveTextContent('Cancel');
    expect(screen.getByTestId('save-prompt-button-yes')).toHaveFocus();
    await user.click(screen.getByTestId('save-prompt-button-no'));
    await expect(promise).resolves.toBe('no');
    expect(screen.queryByTestId('save-prompt')).not.toBeInTheDocument();
  });

  it('Escape triggers the cancel button and Enter the default button', async () => {
    const { dialogs, user } = await setup();
    const { result: cancelled } = await open(() =>
      dialogs.showMessage({ text: 'x', buttons: 'okCancel' }),
    );
    await user.keyboard('{Escape}');
    await expect(cancelled).resolves.toBe('cancel');

    const { result: confirmed } = await open(() =>
      dialogs.showMessage({ text: 'y', buttons: 'yesNo', defaultButton: 'no' }),
    );
    expect(screen.getByTestId('messagebox-button-no')).toHaveFocus();
    await user.keyboard('{Enter}');
    await expect(confirmed).resolves.toBe('no');
  });

  it('ignores Escape for Yes/No boxes (no cancel button, no close box)', async () => {
    const { dialogs, user } = await setup();
    const { result: promise } = await open(() =>
      dialogs.showMessage({ text: 'x', buttons: 'yesNo' }),
    );
    expect(screen.queryByTestId('messagebox-close')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('messagebox')).toBeInTheDocument();
    await user.keyboard('n'); // bare accelerator of "&No"
    await expect(promise).resolves.toBe('no');
  });

  it('supports Alt+accelerator, the abortRetryIgnore set and the "Don\'t ask again" box', async () => {
    const { dialogs, user } = await setup();
    const { result: promise } = await open(() =>
      dialogs.showMessageWithResult({
        text: 'disk error',
        buttons: 'abortRetryIgnore',
        icon: 'error',
        dontAskAgain: true,
      }),
    );
    await user.click(screen.getByTestId('messagebox-dontask'));
    await user.keyboard('{Alt>}r{/Alt}');
    await expect(promise).resolves.toEqual({ button: 'retry', dontAskAgain: true });
  });

  it('uses the Russian catalogue for buttons and the default caption', async () => {
    const { dialogs, user } = await setup('ru');
    const { result: promise } = await open(() =>
      dialogs.showMessage({ text: 'Текст', buttons: 'yesNoCancel' }),
    );
    expect(screen.getByTestId('messagebox-title')).toHaveTextContent('Maxima Fiction Book Editor');
    expect(screen.getByTestId('messagebox-button-yes')).toHaveTextContent('Да');
    expect(screen.getByTestId('messagebox-button-cancel')).toHaveTextContent('Отмена');
    await user.keyboard('{Alt>}д{/Alt}');
    await expect(promise).resolves.toBe('yes');
  });

  it('stacks dialogs: only the top one is interactive, Tab cycles inside it', async () => {
    const { dialogs, user } = await setup();
    const { result: first } = await open(() =>
      dialogs.showMessage({ text: 'first', buttons: 'okCancel', testId: 'first' }),
    );
    const { result: second } = await open(() =>
      dialogs.showMessage({ text: 'second', buttons: 'yesNoCancel', testId: 'second' }),
    );
    await waitFor(() => expect(screen.getByTestId('second')).toBeInTheDocument());
    expect(screen.getByTestId('dialog-backdrop-0')).toHaveAttribute('inert');
    expect(screen.getByTestId('dialog-backdrop-1')).not.toHaveAttribute('inert');

    expect(screen.getByTestId('second-button-yes')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('second-button-no')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('second-button-cancel')).toHaveFocus();
    await user.tab(); // wraps to the first focusable element of the top dialog
    expect(screen.getByTestId('second-button-yes')).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByTestId('second-button-cancel')).toHaveFocus();

    await user.keyboard('{Escape}');
    await expect(second).resolves.toBe('cancel');
    await waitFor(() => expect(screen.getByTestId('first-button-ok')).toHaveFocus());
    await user.keyboard('{Enter}');
    await expect(first).resolves.toBe('ok');
  });

  it('restores focus to the previously focused element when closed', async () => {
    const { dialogs, user } = await setup();
    const button = document.createElement('button');
    button.textContent = 'outside';
    document.body.append(button);
    button.focus();
    const { result: promise } = await open(() => dialogs.showMessage({ text: 'x' }));
    expect(screen.getByTestId('messagebox-button-ok')).toHaveFocus();
    await user.keyboard('{Enter}');
    await promise;
    expect(button).toHaveFocus();
    button.remove();
  });

  it('closeTop() dismisses the top dialog programmatically', async () => {
    const { dialogs, service } = await setup();
    const { result: promise } = await open(() =>
      dialogs.showMessageWithResult({ text: 'x', buttons: 'ok' }),
    );
    expect(service.isOpen).toBe(true);
    act(() => {
      service.closeTop({ button: 'cancel', dontAskAgain: false });
    });
    await expect(promise).resolves.toEqual({ button: 'cancel', dontAskAgain: false });
    expect(service.isOpen).toBe(false);
  });
});

describe('InputDialog', () => {
  it('shows the IDD_INPUTBOX layout and returns Yes with the typed value', async () => {
    const { dialogs, user } = await setup();
    const { result: promise } = await open(() => dialogs.showInput({ defaultValue: 'old' }));
    expect(screen.getByTestId('inputdialog-title')).toHaveTextContent('Input');
    expect(screen.getByTestId('inputdialog-prompt')).toHaveTextContent('Text:');
    const input = screen.getByTestId('inputdialog-input');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('old');
    await user.clear(input);
    await user.type(input, 'new value{Enter}');
    await expect(promise).resolves.toEqual({ button: 'yes', value: 'new value' });
  });

  it('returns No / Cancel without validation and blocks confirmation on invalid input', async () => {
    const { dialogs, user } = await setup();
    const { result: no } = await open(() =>
      dialogs.showInput({ prompt: 'Name?', caption: 'Custom', buttons: 'yesNoCancel' }),
    );
    expect(screen.getByTestId('inputdialog-title')).toHaveTextContent('Custom');
    expect(screen.getByTestId('inputdialog-prompt')).toHaveTextContent('Name?');
    await user.click(screen.getByTestId('inputdialog-button-no'));
    await expect(no).resolves.toEqual({ button: 'no', value: '' });

    const { result: validated } = await open(() =>
      dialogs.showInput({
        buttons: 'okCancel',
        validate: (value) => (value.trim() ? null : 'required'),
      }),
    );
    expect(screen.getByTestId('inputdialog-button-ok')).toHaveTextContent('OK');
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('inputdialog-error')).toHaveTextContent('required');
    expect(screen.getByTestId('inputdialog')).toBeInTheDocument();
    await user.type(screen.getByTestId('inputdialog-input'), 'abc');
    expect(screen.queryByTestId('inputdialog-error')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await expect(validated).resolves.toEqual({ button: 'cancel', value: 'abc' });
  });

  it('does not treat letters typed into the input as button accelerators', async () => {
    const { dialogs, user } = await setup();
    const { result: promise } = await open(() => dialogs.showInput({}));
    await user.type(screen.getByTestId('inputdialog-input'), 'yes no cancel');
    expect(screen.getByTestId('inputdialog-input')).toHaveValue('yes no cancel');
    await user.click(screen.getByTestId('inputdialog-close'));
    await expect(promise).resolves.toEqual({ button: 'cancel', value: 'yes no cancel' });
  });
});
