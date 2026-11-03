/**
 * Feature 008, T050 (FR-040 to FR-044, research R9): the Links bar's Href box with its list.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HrefCombo } from '@/app/HrefCombo';

const TARGETS = ['#n_1', '#n_2', '#n_10', '#Chapter_One'].map((href) => ({ href, label: href }));

function setup(value = '#n_2') {
  const onCommit = vi.fn();
  const options = vi.fn(() => TARGETS);
  render(
    <HrefCombo label="Href" value={value} disabled={false} options={options} onCommit={onCommit} />,
  );
  return { onCommit, options, input: screen.getByTestId('links-bar-href') };
}

const optionTexts = () => screen.queryAllByRole('option').map((option) => option.textContent ?? '');

describe('HrefCombo', () => {
  it('the button opens the full list even when the field holds a value', async () => {
    const user = userEvent.setup();
    const { options } = setup('#n_2');
    await user.click(screen.getByTestId('links-bar-href-toggle'));
    expect(options).toHaveBeenCalledTimes(1);
    expect(optionTexts()).toEqual(['#n_1', '#n_2', '#n_10', '#Chapter_One']);
  });

  it('Alt+Down and F4 open it from the keyboard; typing narrows it, ignoring case', async () => {
    const user = userEvent.setup();
    const { input } = setup('');
    await user.click(input);
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(screen.getByTestId('links-bar-href-list')).toBeInTheDocument();
    await user.keyboard('{F4}');
    expect(screen.queryByTestId('links-bar-href-list')).toBeNull();
    await user.keyboard('{F4}');
    await user.type(input, 'chap');
    expect(optionTexts()).toEqual(['#Chapter_One']);
  });

  it('Enter applies the active entry once; a click applies the clicked one once', async () => {
    const user = userEvent.setup();
    const { input, onCommit } = setup('');
    await user.click(input);
    await user.keyboard('{F4}{ArrowDown}{ArrowDown}{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith('#n_10');
    await user.click(screen.getByTestId('links-bar-href-toggle'));
    await user.click(screen.getByTestId('links-bar-href-option-0'));
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith('#n_1');
  });

  it('Escape closes the list, then restores the field without applying anything', async () => {
    const user = userEvent.setup();
    const { input, onCommit } = setup('#n_2');
    await user.click(input);
    await user.clear(input);
    await user.type(input, '#other');
    await user.keyboard('{F4}{Escape}');
    expect(screen.queryByTestId('links-bar-href-list')).toBeNull();
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('#n_2');
    expect(onCommit).not.toHaveBeenCalled();
  });
});
