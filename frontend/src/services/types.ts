export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type TenantType = 'home' | 'professional';

export type TenantRole = 'owner' | 'admin' | 'member';

export type PdfSourceType = 'global_pdf' | 'tenant_pdf' | 'ai_generated';

export interface TenantContext {
  tenantId: string;
  role: TenantRole;
  tenantType: TenantType;
}

export interface RecipeBookChunkMetadata {
  page_number?: number;
  chapter?: string;
  book_title?: string;
  tenant_id?: string | null;
  global_book_id?: string | null;
  tenant_book_id?: string | null;
  source_type?: PdfSourceType;
  [key: string]: JsonValue | undefined;
}

export interface GlobalPdfSourceDto {
  sourceType: 'global_pdf';
  globalBookId: string;
  title?: string;
  pageNumber?: number;
  chunkId?: string;
}

export interface TenantPdfSourceDto {
  sourceType: 'tenant_pdf';
  tenantBookId: string;
  tenantId: string;
  title?: string;
  pageNumber?: number;
  chunkId?: string;
}

export interface AiGeneratedSourceDto {
  sourceType: 'ai_generated';
  title?: string;
  pageNumber?: number;
  chunkId?: string;
}

export type Citation = GlobalPdfSourceDto | TenantPdfSourceDto | AiGeneratedSourceDto;

export interface RecipeBookChunk {
  id?: string;
  book_id: string;
  content: string;
  metadata: RecipeBookChunkMetadata;
  sourceType?: PdfSourceType;
  embedding?: number[];
  similarity?: number;
}

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface Chunk {
  content: string;
  page_number?: number;
  charIndexStart: number;
  charIndexEnd: number;
}

export interface EmbeddingService {
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
}

export interface RecipeGenerationOptions {
  temperature?: number;
  maxOutputTokens?: number;
}

export interface RestrictionProfile {
  allergies: string[];
  dietaryRules: string[];
}

export interface RestrictionOverrideInput {
  allergies?: string[];
  dietaryRules?: string[];
}

export interface InventoryItemDto {
  id: string;
  tenantId: string;
  userId: string;
  ingredient: string;
  quantity?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeSearchInput {
  ingredients?: string[];
  restrictionProfile?: RestrictionProfile;
  overrideRestrictions?: RestrictionOverrideInput;
}

export interface RecipeHistoryItemDto {
  id: string;
  tenantId: string;
  userId: string;
  ingredients: string[];
  restrictions: RestrictionProfile;
  recipe: string;
  citations: Citation[];
  createdAt: string;
}

export interface RecipeRatingDto {
  id: string;
  generationId: string;
  tenantId: string;
  userId: string;
  rating: number;
  comment?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeGenerationPromptInput {
  ingredients: string[];
  restrictions: RestrictionProfile;
}

export interface RecipeGenerationService {
  generateRecipe(
    input: RecipeGenerationPromptInput,
    contextChunks: RecipeBookChunk[],
    options?: RecipeGenerationOptions
  ): Promise<string>;
}

export interface PdfChunkerService {
  chunkPdfText(
    text: string,
    metadata: { book_id: string; book_title?: string; page_number?: number },
    options?: ChunkOptions
  ): RecipeBookChunk[];
}

export interface SemanticSearchService {
  searchChunks(
    embedding: number[],
    options?: {
      matchThreshold?: number;
      matchCount?: number;
      bookIds?: string[];
    }
  ): Promise<RecipeBookChunk[]>;

  saveChunks(chunks: RecipeBookChunk[]): Promise<void>;

  getTenantPdfCount?(): Promise<number>;
}

export type AuthProvider = 'password' | 'google';

export type MfaAssuranceLevel = 'aal1' | 'aal2';

export type MfaFactorStatus = 'unverified' | 'verified';

export interface MfaFactor {
  id: string;
  friendlyName: string | null;
  factorType: 'totp' | 'phone';
  status: MfaFactorStatus;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  provider: AuthProvider;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: AuthUser;
}

export interface Invitation {
  id: string;
  tenantId: string;
  email: string;
  invitedBy: string;
  role: TenantRole;
  token: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  createdAt: string;
}

export interface InvitationCreateInput {
  tenantId: string;
  email: string;
  invitedBy: string;
  role: Extract<TenantRole, 'member'>;
  expiresAt: string;
}

export interface InvitationListFilter {
  tenantId: string;
  status?: Invitation['status'];
}

export interface TrialState {
  startedAt: string;
  endsAt: string;
  softBlockedAt: string | null;
  isExpired: boolean;
  canGenerate: boolean;
  canUploadPdf: boolean;
}

export type PremiumRecipeStatus = 'published' | 'withdrawn' | 'moderation_hidden';

export type PremiumReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export interface PremiumRecipeAttributionDto {
  creatorUserId: string;
  displayName: string | null;
}

export interface PremiumRecipeDto {
  id: string;
  sourceRecipeHistoryId: string;
  sourceTenantId: string;
  creatorUserId: string;
  creatorDisplayName: string | null;
  eligibilityScore: number;
  creatorOptedIn: boolean;
  status: PremiumRecipeStatus;
  publishedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PremiumRecipeReviewDto {
  id: string;
  premiumRecipeId: string;
  userId: string;
  stars: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PremiumRecipeReportDto {
  id: string;
  premiumRecipeId: string;
  reviewId: string | null;
  reporterUserId: string;
  reason: string;
  status: PremiumReportStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface PremiumRecipeDetailDto extends PremiumRecipeDto {
  reviews: PremiumRecipeReviewDto[];
}

export interface PremiumRecipePublishInput {
  sourceRecipeHistoryId: string;
  sourceTenantId: string;
  creatorUserId: string;
  attribution: PremiumRecipeAttributionDto;
  eligibilityScore: number;
  creatorOptIn: boolean;
}

export type PremiumRecipePublishResult = PremiumRecipeDto;

export interface PremiumRecipeReviewInput {
  premiumRecipeId: string;
  userId: string;
  stars: 1 | 2 | 3 | 4 | 5;
  comment?: string;
}

export type PremiumRecipeReviewResult = PremiumRecipeReviewDto;

export interface PremiumRecipeReportInput {
  premiumRecipeId: string;
  reviewId?: string;
  reporterUserId: string;
  reason: string;
}

export type PremiumRecipeReportResult = PremiumRecipeReportDto;

export interface PremiumRecipeWithdrawInput {
  premiumRecipeId: string;
  creatorUserId: string;
}

export type PremiumRecipeWithdrawResult = PremiumRecipeDto;
