import { describe, expect, it } from 'vitest';

import {
  isGeminiBatchEmbedContentsResponseDto,
  isGeminiEmbedContentResponseDto,
  isGeminiGenerateContentResponseDto,
  isNumberArray,
  isRecord,
} from '../apiDtos';

describe('Gemini DTO guards', () => {
  it('accepts valid embed response shapes', () => {
    expect(isGeminiEmbedContentResponseDto({ embedding: { values: [0.1, 0.2] } })).toBe(true);
    expect(
      isGeminiBatchEmbedContentsResponseDto({ embeddings: [{ values: [0.1] }, { values: [0.2] }] })
    ).toBe(true);
  });

  it('rejects invalid embed response shapes', () => {
    expect(isGeminiEmbedContentResponseDto({ embedding: { values: ['0.1'] } })).toBe(false);
    expect(
      isGeminiBatchEmbedContentsResponseDto({ embeddings: [{ values: [0.1] }, { values: null }] })
    ).toBe(false);
  });

  it('accepts valid generate-content response shapes and rejects invalid text parts', () => {
    expect(
      isGeminiGenerateContentResponseDto({
        candidates: [{ content: { parts: [{ text: 'Recipe text' }] } }],
      })
    ).toBe(true);

    expect(
      isGeminiGenerateContentResponseDto({
        candidates: [{ content: { parts: [{ text: 42 }] } }],
      })
    ).toBe(false);
  });
});

describe('isRecord', () => {
  it('returns true for plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ key: 'value' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isRecord(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isRecord([])).toBe(true); // arrays are typeof 'object'
  });

  it('returns false for primitives', () => {
    expect(isRecord('string')).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });
});

describe('isNumberArray', () => {
  it('returns true for arrays of numbers', () => {
    expect(isNumberArray([1, 2, 3])).toBe(true);
    expect(isNumberArray([0.1, 0.2])).toBe(true);
    expect(isNumberArray([])).toBe(true);
  });

  it('returns false for arrays with non-number items', () => {
    expect(isNumberArray([1, '2'])).toBe(false);
    expect(isNumberArray([null])).toBe(false);
    expect(isNumberArray([undefined])).toBe(false);
  });

  it('returns false for non-arrays', () => {
    expect(isNumberArray('not an array')).toBe(false);
    expect(isNumberArray(42)).toBe(false);
    expect(isNumberArray({})).toBe(false);
  });
});
