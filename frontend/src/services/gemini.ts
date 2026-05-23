import {
  isGeminiBatchEmbedContentsResponseDto,
  isGeminiEmbedContentResponseDto,
  isGeminiGenerateContentResponseDto,
} from './apiDtos';
import { getServerSecret } from './env';
import {
  EmbeddingService,
  RecipeGenerationPromptInput,
  RecipeGenerationOptions,
  RecipeGenerationService,
  RecipeBookChunk,
} from './types';

export class GeminiEmbeddingService implements EmbeddingService {
  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004';

  constructor(apiKey?: string) {
    // Server-only API key. Do not fall back to NEXT_PUBLIC_* secrets.
    this.apiKey = apiKey ?? getServerSecret('GEMINI_API_KEY');
  }

  /**
   * Generates a single vector embedding for a chunk of text using text-embedding-004
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim() === '') {
      throw new Error('Text is required to generate embeddings.');
    }

    try {
      const response = await fetch(`${this.baseUrl}:embedContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: {
            parts: [{ text }],
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API Error (${response.status}): ${errorText}`);
      }

      const data: unknown = await response.json();
      if (!isGeminiEmbedContentResponseDto(data)) {
        throw new Error('Failed to parse embedding values from Gemini response');
      }

      return data.embedding.values;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }

  /**
   * Generates multiple vector embeddings in a batch using text-embedding-004
   */
  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    try {
      const response = await fetch(`${this.baseUrl}:batchEmbedContents?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: 'models/text-embedding-004',
            content: {
              parts: [{ text }],
            },
          })),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini Batch API Error (${response.status}): ${errorText}`);
      }

      const data: unknown = await response.json();
      if (!isGeminiBatchEmbedContentsResponseDto(data)) {
        throw new Error('Failed to parse batch embeddings from Gemini response');
      }

      return data.embeddings.map((embedding) => embedding.values);
    } catch (error) {
      console.error('Error generating batch embeddings:', error);
      throw error;
    }
  }
}

export class GeminiRecipeGenerator implements RecipeGenerationService {
  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash';

  constructor(apiKey?: string) {
    // Server-only API key. Do not fall back to NEXT_PUBLIC_* secrets.
    this.apiKey = apiKey ?? getServerSecret('GEMINI_API_KEY');
  }

  /**
   * Generates a gourmet recipe grounded strictly in the retrieved cookbook context and available ingredients.
   */
  public async generateRecipe(
    input: RecipeGenerationPromptInput,
    contextChunks: RecipeBookChunk[],
    options: RecipeGenerationOptions = {}
  ): Promise<string> {
    const ingredients = input.ingredients;

    const normalizedIngredients = ingredients
      .map((ingredient) => ingredient.trim())
      .filter((ingredient) => ingredient.length > 0);

    const temperature = options.temperature ?? 0.2; // Low temperature to encourage strict factual grounding
    const maxTokens = options.maxOutputTokens ?? 2048;

    // Build standard structure representing the retrieved context
    const formattedContext = contextChunks.map((chunk, index) => {
      const sourceInfo = `[Source ID: ${chunk.book_id}]` + 
        (chunk.metadata?.book_title ? ` Book: "${chunk.metadata.book_title}"` : '') +
        (chunk.metadata?.page_number ? ` Page: ${chunk.metadata.page_number}` : '');
      return `--- CONTEXT CHUNK ${index + 1} (${sourceInfo}) ---\n${chunk.content}`;
    }).join('\n\n');

    const systemPrompt = `You are a professional Michelin-star chef who specializes in crafting gourmet dishes by adapting classic techniques from legendary cookbooks.

Your task is to create a realistic, premium, high-quality recipe using ONLY the ingredients available in the user's fridge and relying strictly on the retrieved cookbook context chunks.

## CRITICAL GROUNDING AND TRUTH CONSTRAINTS:
1. STRICT TRUTH: Rely ONLY on facts, ratios, culinary concepts, and preparation methods described in the retrieved context chunks.
2. NO HALLUCINATION: Do NOT invent or make up complex recipes or professional techniques that are not supported by the retrieved context. If the ingredients and context are not sufficient to make a recipe, explain why and suggest what basic ingredients or techniques are missing, referencing the cookbooks.
3. INGREDIENT MATCHING: You MUST design the recipe primarily using the "Fridge Ingredients" provided by the user. If absolutely necessary, you may suggest standard pantry staples (like salt, pepper, oil, water) but label them clearly as "Pantry Staples".
4. RESTRICTION SAFETY: You MUST reject any ingredient, substitution, garnish, or pantry staple that conflicts with the user's allergies or dietary rules.
5. RESTRICTION OVERRIDE PRECEDENCE: The supplied restrictions already include per-search overrides. Treat them as final and authoritative.
6. SOURCES: You MUST cite the source cookbook and page numbers within the recipe. Use inline markdown brackets such as [Book Name, Page X] when describing a technique directly derived from a chunk metadata.

## OUTPUT STRUCTURE:
Your recipe response MUST be beautifully formatted in markdown and contain the following sections:
- **# Recipe Name**: A creative, high-end name for the recipe.
- **## Cookbook Origin**: Clearly specify which cookbook, page, or chapter this recipe is adapted from based on chunk metadata.
- **## Recipe Concept**: A brief description (1-2 sentences) of the dish and the professional technique utilized from the cookbooks.
- **## Ingredients**:
  - Fridge Ingredients (used in this dish): [List items from the user's fridge]
  - Recommended Pantry Items (optional/basic): [List common elements like salt, water, cooking fat]
- **## Step-by-Step Instructions**:
  - Detailed, professional preparation steps. Use precise terminology retrieved from the chunks and cite them inline (e.g. "[Book Title, Page X]").
- **## Chef's Secrets**: A pro-tip or technique secret (emulsion, heat management, resting times, etc.) retrieved from the cookbook context.

If the user's ingredients do not align with any techniques in the retrieved chunks, politely explain this mismatch in a constructive way, teaching the user the principles from the retrieved cookbooks instead of hallucinating a false recipe.`;

    const userPrompt = `Fridge Ingredients: ${normalizedIngredients.join(', ') || 'None provided'}
Allergies to avoid: ${input.restrictions.allergies.join(', ') || 'None provided'}
Dietary rules to enforce: ${input.restrictions.dietaryRules.join(', ') || 'None provided'}

Retrieved Cookbook Context Chunks:
${formattedContext || 'No relevant cookbook context chunks found.'}

Please craft the gourmet recipe based on these inputs:`;

    try {
      const response = await fetch(`${this.baseUrl}:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
            }
          ],
          generationConfig: {
            temperature: temperature,
            maxOutputTokens: maxTokens,
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini Recipe Generation Error (${response.status}): ${errorText}`);
      }

      const data: unknown = await response.json();
      if (!isGeminiGenerateContentResponseDto(data)) {
        throw new Error('Failed to retrieve text generation content from Gemini API response');
      }

      const textResponse = data.candidates[0]?.content.parts[0]?.text;
      if (!textResponse) {
        throw new Error('Failed to retrieve text generation content from Gemini API response');
      }

      return textResponse;
    } catch (error) {
      console.error('Error generating recipe via Gemini:', error);
      throw error;
    }
  }
}
