import { describe, expect, it } from 'vitest';
import { PRIVATE_PDF_MAX_BYTES, PRIVATE_PDF_MAX_CHUNKS, PRIVATE_PDF_MAX_PAGES, validatePrivatePdfFile, validatePrivatePdfIndex } from './validation';

const vector = () => Array.from({ length: 1536 }, () => 0.1);
const chunk = () => ({ content: 'Recipe', pageNumber: 1, embedding: vector() });

describe('private PDF candidate validation', () => {
  it('requires the PDF media type, magic bytes and bounded size', () => {
    const pdf = new TextEncoder().encode('%PDF-1.7');
    expect(validatePrivatePdfFile('application/pdf', pdf)).toBe(true);
    expect(validatePrivatePdfFile('text/plain', pdf)).toBe(false);
    expect(validatePrivatePdfFile('application/pdf', new TextEncoder().encode('hello'))).toBe(false);
    expect(validatePrivatePdfFile('application/pdf', new Uint8Array(PRIVATE_PDF_MAX_BYTES + 1))).toBe(false);
    expect(validatePrivatePdfFile('application/pdf', new Uint8Array())).toBe(false);
  });

  it('bounds pages and chunks and rejects invalid text, page references and vectors', () => {
    expect(validatePrivatePdfIndex(1, [chunk()])).toBe(true);
    for (const pages of [0, PRIVATE_PDF_MAX_PAGES + 1, 1.5, NaN]) expect(validatePrivatePdfIndex(pages, [chunk()])).toBe(false);
    expect(validatePrivatePdfIndex(1, [])).toBe(false);
    expect(validatePrivatePdfIndex(1, Array.from({ length: PRIVATE_PDF_MAX_CHUNKS + 1 }, chunk))).toBe(false);
    for (const bad of [null, { ...chunk(), content: '  ' }, { ...chunk(), content: 'a'.repeat(5001) },
      { ...chunk(), pageNumber: 2 }, { ...chunk(), pageNumber: 0.5 },
      { ...chunk(), embedding: [1] }, { ...chunk(), embedding: Array(1536).fill(0) },
      { ...chunk(), embedding: [...vector().slice(1), Infinity] }]) {
      expect(validatePrivatePdfIndex(1, [bad])).toBe(false);
    }
  });
});
