import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeBookChunk, RecipeGenerationPromptInput } from '../types';

const fetchMock = vi.fn();

vi.mock('../env', () => ({ getServerSecret: () => 'gemini-test-key' }));
vi.mock('@/lib/ai/gemini-config', () => ({
  getGeminiBaseUrl: () => 'https://generativelanguage.googleapis.com/v1beta',
}));
vi.mock('@/lib/serverLogger', () => ({
  serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { GeminiRecipeGenerator } = await import('../gemini');

const input: RecipeGenerationPromptInput = {
  ingredients: ['tomato'],
  restrictions: { allergies: [], dietaryRules: [] },
};
const chunks: RecipeBookChunk[] = [{ book_id: 'book-1', content: 'Roast gently.', metadata: {} }];

describe('GeminiRecipeGenerator', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('concatenates all ordered text parts and ignores non-text provider parts', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true },
                  { text: 'Recipe heading\n' },
                  { inlineData: {} },
                  { text: 'Recipe body' },
                ],
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    await expect(new GeminiRecipeGenerator().generateRecipe(input, chunks)).resolves.toBe(
      'Recipe heading\nRecipe body'
    );
  });

  it.each([
    { candidates: [] },
    { candidates: [{ content: { parts: [] } }] },
    { candidates: [{ content: { parts: [{ text: 42 }] } }] },
    { candidates: [{ content: { parts: [{ thought: true }] } }] },
  ])('rejects malformed or empty multipart responses', async (payload) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));

    await expect(new GeminiRecipeGenerator().generateRecipe(input, chunks)).rejects.toThrow(
      'Failed to retrieve text generation content from Gemini API response'
    );
  });
});
