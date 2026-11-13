export type TenantType = 'home' | 'professional';
export type TenantRole = 'owner' | 'admin' | 'member';
export type PdfProcessingStatus = 'processing' | 'ready' | 'failed';
export type PdfSourceType = 'global_pdf' | 'tenant_pdf' | 'ai_generated';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type PremiumRecipeStatus = 'published' | 'withdrawn' | 'moderation_hidden';
export type PremiumReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';
export type ShoppingItemStatus = 'pending' | 'purchased';
export type PreferenceType = 'identity' | 'prefer' | 'avoid' | 'goal';
export type InventoryMovementType =
  | 'purchase'
  | 'recipe_consumption'
  | 'manual_adjustment'
  | 'correction';
export type OptimizationMode =
  | 'reduce_waste'
  | 'optimize_cost'
  | 'prioritize_fresh'
  | 'reduce_missing'
  | 'reuse_proteins'
  | 'balance_ingredients';
export type MealPlanPeriod = 'week' | 'fortnight' | 'month';
export type MealPlanMode = 'inventory_to_menu' | 'menu_to_shopping' | 'balanced_ai';
export type FusionIntensity = 'sutil' | 'media' | 'alta';
export type UserFeedback = 'accepted' | 'discarded';

export interface TenantRow {
  id: string;
  tenant_type: TenantType;
  name: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_soft_blocked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  email_confirmed: boolean;
  full_name: string | null;
  tenant_id: string | null;
  role: TenantRole;
  terms_accepted_at: string | null;
  terms_version: string | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
}

export interface TenantMembershipRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  created_at: string;
  updated_at: string;
}

export interface PlatformOwnerRow {
  user_id: string;
  created_at: string;
  requires_manual_review: boolean;
}

export interface GlobalBookRow {
  id: string;
  title: string;
  author: string | null;
  description: string | null;
  cuisine_region: string;
  cuisine_country: string | null;
  cuisine_style: string | null;
  tags: string[];
  created_at: string;
}

export interface GlobalPdfLibraryRow {
  id: string;
  global_book_id: string;
  storage_path: string;
  file_size_bytes: number;
  page_count: number;
  checksum_sha256: string;
  uploaded_by: string;
  created_at: string;
}

export interface TenantPdfLibraryRow {
  id: string;
  tenant_id: string;
  tenant_book_id: string | null;
  storage_path: string;
  file_size_bytes: number | null;
  page_count: number | null;
  checksum_sha256: string | null;
  created_at: string;
  ocr_used: boolean;
  processing_status: PdfProcessingStatus;
  processed_chunks_count: number | null;
  processing_error: string | null;
  uploaded_by: string | null;
}

export interface TenantBookRow {
  id: string;
  tenant_id: string;
  title: string;
  author: string | null;
  description: string | null;
  created_at: string;
}

export interface CulinaryDimensionRow {
  id: string;
  key: string;
  label: string;
  sort_order: number;
  created_at: string;
}

export interface CulinaryTermRow {
  id: string;
  dimension_id: string;
  label: string;
  is_active: boolean;
}

export type HouseholdAgeGroup = 'adult' | 'teen' | 'child';

export interface HouseholdMember {
  name: string;
  ageGroup: HouseholdAgeGroup;
}

export interface UserCulinaryProfileRow {
  user_id: string;
  tenant_id: string;
  level: string | null;
  available_time_minutes: number | null;
  disliked_ingredients: string[];
  allergies: string[];
  household_members: HouseholdMember[];
  created_at: string;
  updated_at: string;
}

export interface UserCulinaryProfileTermRow {
  user_id: string;
  term_id: string;
  preference_type: PreferenceType;
  weight: number;
  created_at: string;
}

export interface ShoppingListItemRow {
  id: string;
  tenant_id: string;
  user_id: string;
  source: string;
  premium_recipe_id: string | null;
  ingredient_name: string;
  quantity: string | null;
  status: ShoppingItemStatus;
  transfer_inventory_item_id: string | null;
  transferred_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeInventoryItemRow {
  id: string;
  tenant_id: string;
  user_id: string;
  ingredient_name: string;
  quantity: string | null;
  unit: string | null;
  category: string | null;
  expiration_date: string | null;
  estimated_unit_price: number | null;
  // Optional on historical 020 projections; new 021 rows carry these columns.
  price_currency?: string | null;
  price_reference_quantity?: string | number | null;
  price_reference_unit?: string | null;
  purchase_location: string | null;
  low_stock_threshold: number | null;
  normalized_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRecipeRow {
  id: string;
  tenant_id: string;
  user_id: string;
  category: string | null;
  tags: string[];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRecipeVersionRow {
  id: string;
  recipe_id: string;
  tenant_id: string;
  user_id: string;
  version_number: number;
  title: string;
  instructions: string;
  servings: number | null;
  ingredients: ManualRecipeIngredient[];
  source_recipe_history_id: string | null;
  created_at: string;
}

export interface ManualRecipeIngredient {
  name: string;
  quantity?: string | null;
  unit?: string | null;
}

export interface UserRecipeDetailDto extends UserRecipeRow {
  current_version: UserRecipeVersionRow;
}

export interface UserRecipeListDto extends UserRecipeRow {
  current_version: Pick<
    UserRecipeVersionRow,
    | 'id'
    | 'version_number'
    | 'title'
    | 'instructions'
    | 'servings'
    | 'ingredients'
    | 'source_recipe_history_id'
    | 'created_at'
  >;
}

export type UserRecipeVersionDto = UserRecipeVersionRow;

export interface RecipeAiHistoryRow {
  id: string;
  tenant_id: string;
  user_id: string;
  source: string;
  recipe_title: string | null;
  recipe_payload: unknown;
  restrictions_snapshot: unknown;
  inventory_snapshot: unknown;
  user_feedback: UserFeedback | null;
  user_feedback_at: string | null;
  is_saved: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface UserMealPlanRow {
  id: string;
  tenant_id: string;
  user_id: string;
  people_count: number;
  period: MealPlanPeriod;
  mode: MealPlanMode;
  base_cuisine: string;
  fusion_cuisines: string[];
  fusion_intensity: FusionIntensity;
  goal: string | null;
  restrictions: string[];
  inventory_snapshot: unknown;
  calendar_payload: unknown;
  consumption_payload: unknown;
  ai_content: string | null;
  created_at: string;
  updated_at: string;
}

export type CookingSessionStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface CookingSessionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  meal_plan_id: string;
  day_index: number;
  meal_type: 'breakfast' | 'lunch' | 'dinner';
  recipe_id: string;
  recipe_version_id: string;
  status: CookingSessionStatus;
  current_step: number;
  total_steps: number;
  instruction_snapshot: unknown;
  source_updated_at: string;
  source_calendar_payload_hash: string;
  version: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  retention_until: string | null;
}

export interface CookingSessionEventRow {
  id: string;
  session_id: string;
  tenant_id: string;
  user_id: string;
  operation_type: 'start' | 'resume' | 'pause' | 'advance' | 'complete' | 'cancel';
  previous_step: number;
  next_step: number;
  previous_status: CookingSessionStatus;
  next_status: CookingSessionStatus;
  idempotency_key: string;
  payload_hash: string;
  created_at: string;
}

export interface BookChunkRow {
  id: string;
  tenant_id: string | null;
  global_book_id: string | null;
  tenant_book_id: string | null;
  source_type: PdfSourceType;
  content: string;
  metadata: unknown;
  embedding: number[];
  created_at: string;
}
