/**
 * Feature 020 (T023, US1): Vitest unit tests for interactive PDF OCR import state,
 * book <lang> resolution (OCR primary language + scanner metadata override), and
 * localized OCR refusal / summary formatting.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { initI18n } from '@/i18n';
import {
  getSessionUseOcr,
  pdfImportReason,
  resetSessionUseOcrForTests,
  setSessionUseOcr,
} from '@/features/pdf/importCommand';
import { metadataDescription, resolveImportLanguage } from '@/features/pdf/import/describe';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';
import type { CommandContext } from '@/app/commands';

const TEMPLATE =
  '<?xml version="1.0" encoding="UTF-8"?><FictionBook><description><title-info>' +
  '<genre>prose</genre><author><last-name>Unknown</last-name></author>' +
  '<book-title>Blank</book-title><lang>en</lang></title-info></description></FictionBook>';

describe('PDF import session-sticky Use OCR state (data-model §4)', () => {
  beforeEach(() => {
    resetSessionUseOcrForTests();
  });

  it('defaults from saved Settings.imports.pdf.useOcr before first user confirmation', () => {
    expect(getSessionUseOcr(true)).toBe(true);
    expect(getSessionUseOcr(false)).toBe(false);
    expect(getSessionUseOcr(undefined)).toBe(true);
  });

  it('stays sticky for the session once confirmed without altering saved default', () => {
    setSessionUseOcr(false);
    expect(getSessionUseOcr(true)).toBe(false);
    setSessionUseOcr(true);
    expect(getSessionUseOcr(false)).toBe(true);
    resetSessionUseOcrForTests();
    expect(getSessionUseOcr(false)).toBe(false);
  });
});

describe('describe.ts OCR <title-info><lang> resolution (contracts/page-model.md §2)', () => {
  it('uses OCR primary detected language for scanned books and overrides contradictory scanner metadata', () => {
    const lang = resolveImportLanguage({
      pdfLang: 'en',
      ocrSummary: {
        used: true,
        pagesRecognized: 10,
        imageBlocksRecognized: 0,
        fallbackPages: 0,
        lowConfidencePages: 0,
        primaryLang: 'ru',
        languages: ['ru'],
      },
      totalPages: 10,
      guessedLang: null,
    });
    expect(lang).toBe('ru');

    const desc = metadataDescription(undefined, TEMPLATE, 'scan-ru', lang, null);
    expect(desc).toContain('<lang>ru</lang>');
  });

  it('supports bundled and custom ISO language codes from OCR (de, uk, cs)', () => {
    for (const code of ['de', 'uk', 'cs', 'pl', 'fr']) {
      const lang = resolveImportLanguage({
        pdfLang: undefined,
        ocrSummary: {
          used: true,
          pagesRecognized: 4,
          imageBlocksRecognized: 0,
          fallbackPages: 0,
          lowConfidencePages: 0,
          primaryLang: code,
          languages: [code],
        },
        totalPages: 4,
        guessedLang: null,
      });
      expect(lang).toBe(code);
    }
  });

  it('preserves explicit PDF metadata language on text-only books where OCR did not run', () => {
    const lang = resolveImportLanguage({
      pdfLang: 'de',
      ocrSummary: undefined,
      totalPages: 20,
      guessedLang: 'en',
    });
    expect(lang).toBe('de');
  });
});

describe('OCR refusal reason formatting', () => {
  it('localizes ocrNoLanguages, ocrLanguageDisabled, ocrLanguageMissing, and ocrUnreadable', async () => {
    const i18n = await initI18n({ language: 'en', mode: 'test', react: false });
    const ctx = {
      t: (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts),
    } as unknown as CommandContext;

    const noLang = new RpcError(RpcErrorCode.pdfImportFailed, '', {
      reason: 'ocrNoLanguages',
    });
    expect(pdfImportReason(ctx, noLang)).toContain('Settings -> OCR');

    const disabled = new RpcError(RpcErrorCode.pdfImportFailed, '', {
      reason: 'ocrLanguageDisabled',
      script: 'cyrillic',
      suggestedLanguages: ['rus', 'ukr'],
    });
    const disabledMsg = pdfImportReason(ctx, disabled);
    expect(disabledMsg).toContain('cyrillic');
    expect(disabledMsg).toContain('rus');

    const missing = new RpcError(RpcErrorCode.pdfImportFailed, '', {
      reason: 'ocrLanguageMissing',
      script: 'georgian',
    });
    expect(pdfImportReason(ctx, missing)).toContain('georgian');

    const unreadable = new RpcError(RpcErrorCode.pdfImportFailed, '', {
      reason: 'ocrUnreadable',
      pages: 1,
    });
    expect(pdfImportReason(ctx, unreadable)).toContain('no usable text');
  });
});
