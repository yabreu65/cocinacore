import { describe, expect, it } from 'vitest';

import {
  isGeminiBatchEmbedContentsResponseDto,
  isGeminiEmbedContentResponseDto,
  isGeminiGenerateContentResponseDto,
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
