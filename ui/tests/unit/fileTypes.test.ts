/**
 * File types of the native file dialogs (feature 002, spec FR-010, FR-011): the original
 * editor's lists in its order plus `.fbd` and WebP, each name followed by its patterns, in the
 * interface language.
 */

import { createInstance, type TFunction } from 'i18next';

import {
  BINARY_SELECTED_TYPE,
  binaryFileTypes,
  dictionaryFileTypes,
  documentFileTypes,
  fileType,
  imageFileTypes,
  parentFolder,
  savedImageFileTypes,
} from '@/dialogs/fileTypes';
import { initI18n } from '@/i18n';

async function translator(language: 'en' | 'ru'): Promise<TFunction> {
  const i18n = await initI18n({ instance: createInstance(), react: false, language });
  return i18n.t;
}

describe('file types of the native dialogs (FR-010)', () => {
  it('a type shows its name with the patterns of its extensions', () => {
    expect(fileType('Supported images', ['jpg', 'jpeg', 'png'])).toEqual({
      name: 'Supported images (*.jpg;*.jpeg;*.png)',
      extensions: ['jpg', 'jpeg', 'png'],
    });
    expect(fileType('All files', ['*'])).toEqual({ name: 'All files (*.*)', extensions: ['*'] });
  });

  it('lists the original types in order, in English', async () => {
    const t = await translator('en');
    expect(documentFileTypes(t)).toEqual([
      { name: 'FictionBook files (*.fb2)', extensions: ['fb2'] },
      { name: 'FictionBook descriptors (*.fbd)', extensions: ['fbd'] },
      { name: 'All files (*.*)', extensions: ['*'] },
    ]);
    const images = [
      'Supported images (*.jpg;*.jpeg;*.png)',
      'JPEG (*.jpg)',
      'PNG (*.png)',
      'Bitmap (*.bmp)',
      'GIF (*.gif)',
      'TIFF (*.tif)',
      'WebP (*.webp)',
    ];
    expect(imageFileTypes(t).map((type) => type.name)).toEqual(images);
    expect(imageFileTypes(t).map((type) => type.extensions)).toEqual([
      ['jpg', 'jpeg', 'png'],
      ['jpg'],
      ['png'],
      ['bmp'],
      ['gif'],
      ['tif'],
      ['webp'],
    ]);
    expect(binaryFileTypes(t).map((type) => type.name)).toEqual(['All files (*.*)', ...images]);
    expect(binaryFileTypes(t)[BINARY_SELECTED_TYPE]!.name).toBe(images[0]);
    expect(savedImageFileTypes(t)).toEqual([
      { name: 'JPEG files (*.jpg)', extensions: ['jpg'] },
      { name: 'PNG files (*.png)', extensions: ['png'] },
      { name: 'All files (*.*)', extensions: ['*'] },
    ]);
    expect(dictionaryFileTypes(t)).toEqual([
      { name: 'Dictionaries (*.dic)', extensions: ['dic'] },
      { name: 'All files (*.*)', extensions: ['*'] },
    ]);
  });

  it('shows the names in Russian (FR-011)', async () => {
    const t = await translator('ru');
    expect(documentFileTypes(t).map((type) => type.name)).toEqual([
      'Файлы FictionBook (*.fb2)',
      'Описания FictionBook (*.fbd)',
      'Все файлы (*.*)',
    ]);
    expect(imageFileTypes(t).map((type) => type.name)).toEqual([
      'Поддерживаемые изображения (*.jpg;*.jpeg;*.png)',
      'JPEG (*.jpg)',
      'PNG (*.png)',
      'Точечные рисунки (*.bmp)',
      'GIF (*.gif)',
      'TIFF (*.tif)',
      'WebP (*.webp)',
    ]);
    expect(savedImageFileTypes(t).map((type) => type.name)).toEqual([
      'Файлы JPEG (*.jpg)',
      'Файлы PNG (*.png)',
      'Все файлы (*.*)',
    ]);
    expect(dictionaryFileTypes(t).map((type) => type.name)).toEqual([
      'Словари (*.dic)',
      'Все файлы (*.*)',
    ]);
  });

  it('finds the folder a proposed file lies in', () => {
    expect(parentFolder('/home/user/словари/my.dic')).toBe('/home/user/словари');
    expect(parentFolder('C:\\Dictionaries\\my.dic')).toBe('C:\\Dictionaries');
    expect(parentFolder('C:\\my.dic')).toBe('C:\\');
    expect(parentFolder('/my.dic')).toBe('/');
    expect(parentFolder('my.dic')).toBe('');
    expect(parentFolder('')).toBe('');
  });
});
