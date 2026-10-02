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

export interface RecipeContextDbAdapter {
  searchChunks: SemanticSearchService['searchChunks'];
}

export interface RecipeContextRetrievalDependencies {
  embedder: EmbeddingService;
  dbAdapter: RecipeContextDbAdapter;
}

export interface RecipeContextRetrievalOptions {
  bookIds?: string[];
  matchCount?: number;
  matchThreshold?: number;
}

export interface RecipeContextRetrievalResult {
  searchQuery: string;
  ingredients: string[];
  restrictions: RestrictionProfile;
  chunks: RecipeBookChunk[];
  citations: Citation[];
}

export const RAG_MATCH_THRESHOLD = 0.35;
export const RAG_MATCH_COUNT = 6;
export const RAG_MAX_CHUNK_CONTENT_CHARS = 4_000;
export const RAG_MAX_CONTEXT_CONTENT_CHARS = 12_000;
export const RAG_MAX_QUERY_CHARS = 6_000;

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

export function buildRecipeSearchQuery(searchInput: RecipeSearchInput): string {
  const ingredients = normalizeArray(searchInput.ingredients);
  const restrictions = resolveRestrictions(
    searchInput.restrictionProfile,
    searchInput.overrideRestrictions
  );
  const recipeName = searchInput.recipeName?.trim();
  const mealType = searchInput.mealType?.trim();
  const day = searchInput.day?.trim();
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

  const intentClauses = [
    recipeName ? `Requested recipe: ${recipeName}.` : '',
    mealType ? `Meal type: ${mealType}.` : '',
    day ? `Planned day: ${day}.` : '',
  ].filter(Boolean);

  return [
    'Gourmet recipe preparation and cooking instructions.',
    ingredientClause,
    allergiesClause,
    dietaryClause,
    ...intentClauses,
  ].join(' ');
}

function boundSearchQuery(query: string): string {
  return query.slice(0, RAG_MAX_QUERY_CHARS);
}

function boundContextChunks(chunks: RecipeBookChunk[]): RecipeBookChunk[] {
  let remainingContentChars = RAG_MAX_CONTEXT_CONTENT_CHARS;

  return chunks.reduce<RecipeBookChunk[]>((boundedChunks, chunk) => {
    if (remainingContentChars <= 0 || !chunk.content.trim()) {
      return boundedChunks;
    }

    const content = chunk.content.slice(
      0,
      Math.min(RAG_MAX_CHUNK_CONTENT_CHARS, remainingContentChars)
    );
    remainingContentChars -= content.length;
    boundedChunks.push({ ...chunk, content });
    return boundedChunks;
  }, []);
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

export function toCitation(chunk: RecipeBookChunk): Citation {
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

export async function retrieveRecipeContext(
  searchInput: RecipeSearchInput,
  dependencies: RecipeContextRetrievalDependencies,
  options: RecipeContextRetrievalOptions = {}
): Promise<RecipeContextRetrievalResult> {
  assertServerOnlyModelBoundary('recipe generation');

  const ingredients = normalizeArray(searchInput.ingredients);
  const restrictions = resolveRestrictions(
    searchInput.restrictionProfile,
    searchInput.overrideRestrictions
  );
  const searchQuery = boundSearchQuery(buildRecipeSearchQuery(searchInput));
  const matchCount = Math.min(Math.max(options.matchCount ?? RAG_MATCH_COUNT, 1), RAG_MATCH_COUNT);

  serverLogger.info('rag_engine.query_embedding', { ingredientCount: ingredients.length });
  const queryEmbedding = await dependencies.embedder.generateEmbedding(searchQuery);

  serverLogger.info('rag_engine.querying_match_chunks');
  const matchedChunks = await dependencies.dbAdapter.searchChunks(queryEmbedding, {
    matchThreshold: options.matchThreshold ?? RAG_MATCH_THRESHOLD,
    matchCount,
    bookIds: options.bookIds,
  });
  const chunks = boundContextChunks(matchedChunks);

  serverLogger.info('rag_engine.match_chunks_found', { matchCount: chunks.length });

  return {
    searchQuery,
    ingredients,
    restrictions,
    chunks,
    citations: chunks.map(toCitation),
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

    const retrievedContext = await retrieveRecipeContext(
      searchInput,
      { embedder: this.embedder, dbAdapter: this.dbAdapter },
      options
    );

    // 3. Generate recipe grounded strictly in the matched context
    serverLogger.info('rag_engine.recipe_generation_start');
    const promptInput: RecipeGenerationPromptInput = {
      ingredients: retrievedContext.ingredients,
      restrictions: retrievedContext.restrictions,
    };

    const recipe = await this.generator.generateRecipe(promptInput, retrievedContext.chunks, {
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    return {
      recipe,
      retrievedChunks: retrievedContext.chunks,
      citations: retrievedContext.citations,
    };
  }
}
