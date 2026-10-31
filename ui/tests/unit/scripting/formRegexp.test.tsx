/**
 * Feature 007 (contracts/script-api.md §4, conversion rule 6): the `'regexp'` field of
 * `mfbe.ui.form`, added for the 2.7.9 heading markup dialog that offers ready-made patterns for
 * an editable one. Choosing a preset puts its pattern in the field; a pattern that does not
 * compile shows the engine's message and disables OK; the value is the pattern as typed.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import { initI18n } from '@/i18n';
import type { UiLanguage } from '@/rpc/types';
import { initialValues, normaliseFields, regexpProblem } from '@/scripting/formModel';
import { ScriptFormDialog } from '@/scripting/forms';
import type { FormField, FormValues } from '@/scripting/types';

const PRESETS = [
  { value: '[^ \\xA0]', label: 'Any non-empty paragraph' },
  { value: '^[ \\xA0]*\\d+[ \\xA0]*\\.?$', label: 'Like "123"' },
];

async function show(field: FormField, language: UiLanguage = 'en') {
  const i18n = await initI18n({ instance: createInstance(), react: true, language });
  const closed: (FormValues | null)[] = [];
  render(
    <I18nextProvider i18n={i18n}>
      <ScriptFormDialog
        spec={{ title: 'Headings', fields: [field] }}
        onClose={(values) => closed.push(values)}
      />
    </I18nextProvider>,
  );
  return closed;
}

describe('the regexp form field', () => {
  it('is a field kind of its own; its value is the pattern string', () => {
    const fields = normaliseFields([
      { kind: 'regexp', id: 're', label: 'Pattern', value: '^Глава \\d+$', presets: PRESETS },
      { kind: 'regexp', id: 'empty', label: 'Empty' },
    ]);
    expect(fields.map((f) => f.kind)).toEqual(['regexp', 'regexp']);
    expect(initialValues(fields)).toEqual({ re: '^Глава \\d+$', empty: '' });
  });

  it('checks the pattern with its flags', () => {
    expect(regexpProblem('^a+$', '')).toBeNull();
    expect(regexpProblem('(unclosed', '')).toMatch(/./);
    // `\p{L}` compiles with the u flag only when written properly; a lone brace fails under u.
    expect(regexpProblem('a{', '')).toBeNull();
    expect(regexpProblem('a{', 'u')).toMatch(/./);
  });

  it('puts a preset’s pattern into the field and returns what was typed', async () => {
    const closed = await show({
      kind: 'regexp',
      id: 're',
      label: 'Pattern',
      value: '^.*$',
      presets: PRESETS,
      presetsLabel: 'Ready-made patterns',
    });
    const input = screen.getByTestId('dialog-script-form-field-re') as HTMLInputElement;
    const presets = screen.getByTestId('dialog-script-form-field-re-presets') as HTMLSelectElement;
    expect(screen.getByText('Ready-made patterns')).toBeInTheDocument();
    // The initial pattern is no preset: the list starts on the empty entry.
    expect(presets.value).toBe('');
    fireEvent.change(presets, { target: { value: PRESETS[1]!.value } });
    expect(input.value).toBe(PRESETS[1]!.value);
    // Editing by hand leaves the list on no preset.
    fireEvent.change(input, { target: { value: '^Глава \\d+$' } });
    expect(presets.value).toBe('');
    fireEvent.click(screen.getByTestId('dialog-script-form-button-ok'));
    expect(closed).toEqual([{ re: '^Глава \\d+$' }]);
  });

  it('starts the presets on the one the initial pattern equals', async () => {
    await show({
      kind: 'regexp',
      id: 're',
      label: 'Pattern',
      value: PRESETS[0]!.value,
      presets: PRESETS,
    });
    const presets = screen.getByTestId('dialog-script-form-field-re-presets') as HTMLSelectElement;
    expect(presets.value).toBe(PRESETS[0]!.value);
    // The editor's own label when the script gives none.
    expect(screen.getByText('Ready-made patterns')).toBeInTheDocument();
  });

  it('disables OK while the pattern does not compile and says why', async () => {
    const closed = await show({ kind: 'regexp', id: 're', label: 'Pattern', value: 'a' }, 'ru');
    const input = screen.getByTestId('dialog-script-form-field-re');
    const ok = screen.getByTestId('dialog-script-form-button-ok');
    expect(screen.queryByTestId('dialog-script-form-field-re-presets')).toBeNull();
    fireEvent.change(input, { target: { value: '(a' } });
    expect(ok).toBeDisabled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('dialog-script-form-field-re-error').textContent).toMatch(
      /^Это не регулярное выражение: .+/,
    );
    fireEvent.click(ok);
    expect(closed).toEqual([]);
    // Cancel stays available.
    fireEvent.click(screen.getByTestId('dialog-script-form-button-cancel'));
    expect(closed).toEqual([null]);
  });
});
