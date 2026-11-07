// Feature 010, US2 (T013): the picture chooser - list order, filter, current image selected,
// enlarge, OK answers the chosen #id, Cancel removes the files added in the dialog (D3, D6).

import { act, fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { PictureChooser } from '@/features/images/PictureChooser';
import { filterPictures } from '@/features/images/pictureChooserModel';
import { initI18n } from '@/i18n';
import type { BinaryMeta } from '@/model/document';
import type { RpcClient } from '@/rpc/client';

vi.mock('@/features/images/binaries', () => ({
  addBinaryFromFile: vi.fn(async () => picture('added.png')),
}));

function picture(id: string): BinaryMeta {
  return {
    id,
    contentType: 'image/png',
    size: 10,
    decodable: true,
    width: 20,
    height: 10,
  } as BinaryMeta;
}

const i18n = createInstance();
beforeAll(async () => {
  await initI18n({ instance: i18n, language: 'en' });
});

function renderChooser(overrides: Partial<Parameters<typeof PictureChooser>[0]> = {}) {
  const onClose = vi.fn();
  const onBinaryAdded = vi.fn();
  const onBinaryRemoved = vi.fn();
  const onShowPicture = vi.fn();
  const call = vi.fn(async () => ({}));
  const rpc = { call } as unknown as RpcClient;
  render(
    <I18nextProvider i18n={i18n}>
      <PictureChooser
        rpc={rpc}
        docId="doc-1"
        binaries={[picture('cover.jpg'), picture('map.png'), picture('portrait.png')]}
        initial="#map.png"
        caption="Choose a picture"
        onBinaryAdded={onBinaryAdded}
        onBinaryRemoved={onBinaryRemoved}
        onShowPicture={onShowPicture}
        onClose={onClose}
        {...overrides}
      />
    </I18nextProvider>,
  );
  return { onClose, onBinaryAdded, onBinaryRemoved, onShowPicture, call };
}

describe('filterPictures', () => {
  it('keeps the order and matches ids case-insensitively', () => {
    const list = [picture('Cover.jpg'), picture('map.png'), picture('cover-back.png')];
    expect(filterPictures(list, 'COVER').map((b) => b.id)).toEqual(['Cover.jpg', 'cover-back.png']);
    expect(filterPictures(list, '  ')).toBe(list);
  });
});

describe('PictureChooser', () => {
  it('lists the pictures in order with the current image selected', () => {
    renderChooser();
    const items = screen.getAllByRole('option');
    expect(items.map((item) => item.getAttribute('data-testid'))).toEqual([
      'picture-chooser-item-cover.jpg',
      'picture-chooser-item-map.png',
      'picture-chooser-item-portrait.png',
    ]);
    expect(screen.getByTestId('picture-chooser-item-map.png').getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('filters by id and answers the chosen picture on double-click', () => {
    const { onClose } = renderChooser();
    fireEvent.change(screen.getByTestId('picture-chooser-filter'), { target: { value: 'port' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.doubleClick(screen.getByTestId('picture-chooser-item-portrait.png'));
    expect(onClose).toHaveBeenCalledWith('#portrait.png');
  });

  it('opens the picture view from the enlarge button', () => {
    const { onShowPicture, onClose } = renderChooser();
    fireEvent.click(screen.getByTestId('picture-chooser-enlarge-cover.jpg'));
    expect(onShowPicture).toHaveBeenCalledWith(expect.objectContaining({ id: 'cover.jpg' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes a file added through From file... when the dialog is cancelled', async () => {
    const { onBinaryAdded, onBinaryRemoved, onClose, call } = renderChooser();
    await act(async () => {
      fireEvent.click(screen.getByTestId('picture-chooser-add-file'));
    });
    expect(onBinaryAdded).toHaveBeenCalledWith(expect.objectContaining({ id: 'added.png' }));
    expect(screen.getByTestId('picture-chooser-item-added.png').getAttribute('aria-selected')).toBe(
      'true',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(call).toHaveBeenCalledWith('binary.remove', {
      docId: 'doc-1',
      id: 'added.png',
      force: true,
    });
    expect(onBinaryRemoved).toHaveBeenCalledWith('added.png');
    expect(onClose).toHaveBeenCalledWith(null);
  });
});
