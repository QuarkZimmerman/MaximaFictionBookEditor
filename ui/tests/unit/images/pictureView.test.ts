/**
 * Feature 007 (T098, data-model §5, FR-050 to FR-054): the picture view of a Binary objects
 * thumbnail. It opens at the natural size when the picture fits the window, else fitted;
 * a click (or Space, Enter) toggles only when the picture exceeds the window; the source is
 * the original bytes when the engine shows the type, else the core's preview at the natural
 * size; the view closes when its binary goes, and refits when the window changes size.
 */

import { act, createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import { PictureView } from '@/features/images/PictureView';
import {
  canViewPicture,
  displaySize,
  exceedsWindow,
  initialMode,
  pictureViewUrl,
  toggledMode,
} from '@/features/images/pictureViewModel';
import { initI18n } from '@/i18n';
import type { BinaryMeta } from '@/model/document';
import { actions, createAppStore } from '@/model/store';

import { fakeDocument } from '../features/testUtils';

const WINDOW = { width: 1280, height: 800 };

function meta(
  id: string,
  contentType: string,
  width: number,
  height: number,
): BinaryMeta & { width: number; height: number } {
  return {
    id,
    contentType,
    size: 1000,
    width,
    height,
    decodable: true,
    willConvert: false,
    referenceCount: 1,
  };
}

const SMALL = meta('small.jpg', 'image/jpeg', 572, 603);
const BIG = meta('big.jpg', 'image/jpeg', 3000, 4000);
const SCAN = meta('scan.tif', 'image/tiff', 640, 480);

describe('the picture view model', () => {
  it('opens at the natural size when the picture fits the window, else fitted', () => {
    expect(exceedsWindow(SMALL, WINDOW)).toBe(false);
    expect(initialMode(SMALL, WINDOW)).toBe('natural');
    expect(exceedsWindow(BIG, WINDOW)).toBe(true);
    expect(initialMode(BIG, WINDOW)).toBe('fitted');
    // Wider than the window alone is enough.
    expect(initialMode(meta('w', 'image/png', 1281, 10), WINDOW)).toBe('fitted');
  });

  it('toggles only when the picture exceeds the window', () => {
    expect(toggledMode('fitted', BIG, WINDOW)).toBe('natural');
    expect(toggledMode('natural', BIG, WINDOW)).toBe('fitted');
    expect(toggledMode('natural', SMALL, WINDOW)).toBe('natural');
  });

  it('fits proportionally and never enlarges', () => {
    expect(displaySize('fitted', BIG, WINDOW)).toEqual({ width: 600, height: 800 });
    expect(displaySize('natural', BIG, WINDOW)).toEqual({ width: 3000, height: 4000 });
    expect(displaySize('fitted', SMALL, WINDOW)).toEqual({ width: 572, height: 603 });
  });

  it('shows the original bytes when the engine shows the type, else the preview at the natural size', () => {
    expect(pictureViewUrl('doc-1', BIG)).toMatch(/^\/binary\/doc-1\/big\.jpg(\?token=.*)?$/);
    expect(pictureViewUrl('doc-1', BIG)).not.toContain('/preview');
    const scan = pictureViewUrl('doc-1', SCAN) ?? '';
    expect(scan).toContain('/binary/doc-1/scan.tif/preview?w=640&h=480');
    expect(pictureViewUrl(null, BIG)).toBeNull();
  });

  it('has a view only for pictures the editor decodes', () => {
    expect(canViewPicture(BIG)).toBe(true);
    expect(canViewPicture({ ...BIG, decodable: false })).toBe(false);
    expect(canViewPicture({ ...BIG, width: undefined })).toBe(false);
  });
});

describe('the picture view', () => {
  async function open(binary: BinaryMeta) {
    const i18n = await initI18n({ instance: createInstance(), react: true, language: 'en' });
    const store = createAppStore();
    actions.setDocument(store, fakeDocument({ docId: 'doc-1', binaries: [SMALL, BIG, SCAN] }));
    const onClose = vi.fn();
    render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(PictureView, { docId: 'doc-1', binary, store, onClose }),
      ),
    );
    return { store, onClose };
  }

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: WINDOW.width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: WINDOW.height, configurable: true });
  });

  it('a large picture opens fitted; a click gives the natural size and the next fits it again', async () => {
    await open(BIG);
    const picture = screen.getByTestId('picture-view-picture');
    expect(screen.getByTestId('picture-view')).toHaveAttribute('data-mode', 'fitted');
    expect(picture).toHaveStyle({ width: '600px', height: '800px' });
    expect(picture).toHaveAttribute('title', 'Click to see the picture at its natural size');
    expect(picture).toHaveClass('mfbe-picture-view-zoom-in');
    fireEvent.click(picture);
    expect(screen.getByTestId('picture-view')).toHaveAttribute('data-mode', 'natural');
    expect(picture).toHaveStyle({ width: '3000px', height: '4000px' });
    expect(picture).toHaveClass('mfbe-picture-view-zoom-out');
    expect(picture).toHaveAttribute('title', 'Click to fit the picture into the window');
    // Space and Enter toggle too.
    fireEvent.keyDown(picture, { key: ' ' });
    expect(screen.getByTestId('picture-view')).toHaveAttribute('data-mode', 'fitted');
    fireEvent.keyDown(picture, { key: 'Enter' });
    expect(screen.getByTestId('picture-view')).toHaveAttribute('data-mode', 'natural');
  });

  it('a small picture shows at its natural size and does not toggle', async () => {
    await open(SMALL);
    const picture = screen.getByTestId('picture-view-picture');
    expect(screen.getByTestId('picture-view')).toHaveAttribute('data-mode', 'natural');
    expect(picture).toHaveStyle({ width: '572px', height: '603px' });
    expect(picture).not.toHaveAttribute('title');
    fireEvent.click(picture);
    expect(screen.getByTestId('picture-view')).toHaveAttribute('data-mode', 'natural');
  });

  it('closes with the close control and with a click outside the picture, not on it', async () => {
    const { onClose } = await open(BIG);
    fireEvent.click(screen.getByTestId('picture-view-picture'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('picture-view-area'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('picture-view-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('picture-view-close')).toHaveAccessibleName('Close');
  });

  it('closes when its binary is removed', async () => {
    const { store, onClose } = await open(BIG);
    expect(onClose).not.toHaveBeenCalled();
    const document = store.getState().document!;
    act(() => {
      actions.updateDocument(store, { ...document, binaries: [SMALL, SCAN] });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('refits on a window resize in fitted mode', async () => {
    await open(BIG);
    const picture = screen.getByTestId('picture-view-picture');
    expect(picture).toHaveStyle({ width: '600px', height: '800px' });
    act(() => {
      Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true });
      window.dispatchEvent(new Event('resize'));
    });
    expect(picture).toHaveStyle({ width: '300px', height: '400px' });
  });

  it('shows a picture the engine cannot through the preview at its natural size', async () => {
    await open(SCAN);
    expect(screen.getByTestId('picture-view-picture')).toHaveAttribute(
      'src',
      expect.stringContaining('/binary/doc-1/scan.tif/preview?w=640&h=480'),
    );
  });
});
