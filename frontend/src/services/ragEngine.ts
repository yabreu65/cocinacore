import {
  Citation,
  EmbeddingService,
  PdfChunkerService,
  RecipeGenerationPromptInput,
  RecipeBookChunk,
  RecipeGenerationService,
  RestrictionOverrideInput,
  RestrictionProfile,
  RecipeSearchInput,
  SemanticSearchService,
  TenantContext,
  TrialState,
} from './types';
import { serverLogger } from '@/lib/serverLogger';

export interface RagEngineConfig {
  chunker: PdfChunkerService;
  embedder: EmbeddingService;
  generator: RecipeGenerationService;
  dbAdapter: SemanticSearchService;
}

export class TrialSoftBlockError extends Error {
  constructor(action: 'generate recipes' | 'upload PDFs') {
    super(`Trial expired: cannot ${action}.`);
    this.name = 'TrialSoftBlockError';
  }
}

export class PdfUploadLimitError extends Error {
  constructor(limit: number) {
    super(`PDF upload limit reached (${limit}).`);
    this.name = 'PdfUploadLimitError';
  }
}

const EMPTY_RESTRICTIONS: RestrictionProfile = {
  allergies: [],
  dietaryRules: [],
};

function normalizeArray(values?: string[]): string[] {
  if (!values) {
    return [];
  }

  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function resolveRestrictions(
  restrictionProfile?: RestrictionProfile,
  overrideRestrictions?: RestrictionOverrideInput
): RestrictionProfile {
  const base = restrictionProfile ?? EMPTY_RESTRICTIONS;

  const allergies = overrideRestrictions?.allergies
    ? normalizeArray(overrideRestrictions.allergies)
    : normalizeArray(base.allergies);

  const dietaryRules = overrideRestrictions?.dietaryRules
    ? normalizeArray(overrideRestrictions.dietaryRules)
    : normalizeArray(base.dietaryRules);

  return {
    allergies,
    dietaryRules,
  };
}

function buildRecipeSearchQuery(ingredients: string[], restrictions: RestrictionProfile): string {
  const ingredientClause =
    ingredients.length > 0
      ? `Available ingredients: ${ingredients.join(', ')}.`
      : 'No inventory ingredients were provided. Return versatile recipes using common pantry assumptions.';

  const allergiesClause =
    restrictions.allergies.length > 0
      ? `Avoid allergens: ${restrictions.allergies.join(', ')}.`
      : 'No allergen exclusions were specified.';

  const dietaryClause =
    restrictions.dietaryRules.length > 0
      ? `Respect dietary rules: ${restrictions.dietaryRules.join(', ')}.`
      : 'No additional dietary rules were specified.';

  return `Gourmet recipe preparation and cooking instructions. ${ingredientClause} ${allergiesClause} ${dietaryClause}`;
}

function assertServerOnlyModelBoundary(action: 'pdf ingestion' | 'recipe generation'): void {
  if (typeof window !== 'undefined') {
    throw new Error(`Server-only AI boundary violation: ${action} must run on the server.`);
  }
}

function tenantUploadLimit(tenantType: TenantContext['tenantType']): number {
  return tenantType === 'professional' ? 15 : 5;
}

function assertTrialAllows(action: 'generate' | 'upload', trialState?: TrialState): void {
  if (!trialState) {
    return;
  }

  const isAllowed = action === 'generate' ? trialState.canGenerate : trialState.canUploadPdf;

  if (!isAllowed) {
    throw new TrialSoftBlockError(action === 'generate' ? 'generate recipes' : 'upload PDFs');
  }
}

function toCitation(chunk: RecipeBookChunk): Citation {
  const sourceType = chunk.sourceType ?? chunk.metadata.source_type ?? 'ai_generated';
  const baseCitation = {
    title: chunk.metadata.book_title,
    pageNumber: chunk.metadata.page_number,
    chunkId: chunk.id,
  };

  if (sourceType === 'global_pdf') {
    return {
      sourceType,
      globalBookId: chunk.metadata.global_book_id ?? chunk.book_id,
      ...baseCitation,
    };
  }

  if (sourceType === 'tenant_pdf') {
    return {
      sourceType,
      tenantBookId: chunk.metadata.tenant_book_id ?? chunk.book_id,
      tenantId: chunk.metadata.tenant_id ?? '',
      ...baseCitation,
    };
  }

  return {
    sourceType: 'ai_generated',
    ...baseCitation,
  };
}

export class RagEngine {
  private chunker: PdfChunkerService;
  private embedder: EmbeddingService;
  private generator: RecipeGenerationService;
  private dbAdapter: SemanticSearchService;

  constructor(config: RagEngineConfig) {
    this.chunker = config.chunker;
    this.embedder = config.embedder;
    this.generator = config.generator;
    this.dbAdapter = config.dbAdapter;
  }

  /**
   * Pipeline 1: Cookbooks Processing, Chunking and Embedding Store
   * - Takes the extracted PDF text of a cookbook
   * - Splits it into semantically integral overlapping blocks
   * - Generates vector embeddings for each block using text-embedding-004
   * - Bulk inserts chunks to the database, automatically constrained by tenant checks
   */
  public async ingestCookbookText(
    text: string,
    metadata: { book_id: string; book_title?: string; page_number?: number },
    options?: {
      chunkSize?: number;
      chunkOverlap?: number;
      trialState?: TrialState;
      tenantContext?: TenantContext;
    }
  ): Promise<number> {
    assertTrialAllows('upload', options?.trialState);
    assertServerOnlyModelBoundary('pdf ingestion');

    if (options?.tenantContext && this.dbAdapter.getTenantPdfCount) {
      const existingPdfs = await this.dbAdapter.getTenantPdfCount();
      const limit = tenantUploadLimit(options.tenantContext.tenantType);
      if (existingPdfs >= limit) {
        throw new PdfUploadLimitError(limit);
      }
    }

    if (!text || text.trim() === '') {
      throw new Error('No cookbook text provided for ingestion.');
    }

    serverLogger.info('rag_engine.ingestion.start', {
      bookId: metadata.book_id,
      bookTitle: metadata.book_title,
    });

    // 1. Chunk the PDF text
    const chunks = this.chunker.chunkPdfText(text, metadata, options);
    if (chunks.length === 0) {
      serverLogger.info('rag_engine.ingestion.no_chunks', { bookId: metadata.book_id });
      return 0;
    }

    serverLogger.info('rag_engine.ingestion.embeddings_generating', { chunkCount: chunks.length });

    // 2. Extract contents for batch embedding request
    const contents = chunks.map((c) => c.content);

    // Batch embeddings to prevent multiple roundtrips and respect rate limits
    const embeddings = await this.embedder.generateEmbeddings(contents);

    // 3. Attach embeddings back to chunk records
    const fullyConfiguredChunks = chunks.map((chunk, idx) => ({
      ...chunk,
      embedding: embeddings[idx],
    }));

    serverLogger.info('rag_engine.ingestion.uploading', {
      chunkCount: fullyConfiguredChunks.length,
    });

    // 4. Save to Database
    await this.dbAdapter.saveChunks(fullyConfiguredChunks);

    serverLogger.info('rag_engine.ingestion.complete', {
      chunkCount: fullyConfiguredChunks.length,
    });
    return fullyConfiguredChunks.length;
  }

  /**
   * Pipeline 2: Ingredient-Based Semantic Search and Grounded Recipe Generation
   * - Formulates a cooking query based on active fridge ingredients
   * - Generates query embedding using text-embedding-004
   * - Conducts a semantic search against pgvector via database-side access controls
   * - Generates a premium, hallucination-free recipe with Gemini 1.5 Flash grounded on the matches
   */
  public async generateRecipeFromFridge(
    searchInput: RecipeSearchInput,
    options: {
      bookIds?: string[];
      matchCount?: number;
      matchThreshold?: number;
      temperature?: number;
      maxOutputTokens?: number;
      trialState?: TrialState;
    } = {}
  ): Promise<{ recipe: string; retrievedChunks: RecipeBookChunk[]; citations: Citation[] }> {
    assertTrialAllows('generate', options.trialState);
    assertServerOnlyModelBoundary('recipe generation');

    const ingredients = normalizeArray(searchInput.ingredients);
    const restrictions = resolveRestrictions(
      searchInput.restrictionProfile,
      searchInput.overrideRestrictions
    );

    // 1. Formulate a semantic search query based on ingredients
    // A clean conceptual query helps text-embedding-004 align closer with recipes and preparations
    const searchQuery = buildRecipeSearchQuery(ingredients, restrictions);

    serverLogger.info('rag_engine.query_embedding', { ingredientCount: ingredients.length });
    const queryEmbedding = await this.embedder.generateEmbedding(searchQuery);

    serverLogger.info('rag_engine.querying_match_chunks');
    // 2. Fetch matched chunks from cookbooks
    const matchedChunks = await this.dbAdapter.searchChunks(queryEmbedding, {
      matchThreshold: options.matchThreshold ?? 0.35, // Relaxed threshold for ingredient overlaps
      matchCount: options.matchCount ?? 6, // High chunk context to capture multiple ingredients/steps
      bookIds: options.bookIds,
    });

    serverLogger.info('rag_engine.match_chunks_found', { matchCount: matchedChunks.length });

    // 3. Generate recipe grounded strictly in the matched context
    serverLogger.info('rag_engine.recipe_generation_start');
    const promptInput: RecipeGenerationPromptInput = {
      ingredients,
      restrictions,
    };

    const recipe = await this.generator.generateRecipe(promptInput, matchedChunks, {
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    const citations = matchedChunks.map(toCitation);

    return {
      recipe,
      retrievedChunks: matchedChunks,
      citations,
    };
  }
}
