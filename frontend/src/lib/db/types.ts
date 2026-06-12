export type TenantType = 'home' | 'professional';
export type TenantRole = 'owner' | 'admin' | 'member';
export type PdfProcessingStatus = 'processing' | 'ready' | 'failed';
export type PdfSourceType = 'global_pdf' | 'tenant_pdf' | 'ai_generated';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type PremiumRecipeStatus = 'published' | 'withdrawn' | 'moderation_hidden';
export type PremiumReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';
export type ShoppingItemStatus = 'pending' | 'purchased';
export type PreferenceType = 'identity' | 'prefer' | 'avoid' | 'goal';
export type InventoryMovementType = 'purchase' | 'recipe_consumption' | 'manual_adjustment' | 'correction';
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

export interface UserCulinaryProfileRow {
  user_id: string;
  tenant_id: string;
  level: string | null;
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
  purchase_location: string | null;
  low_stock_threshold: number | null;
  normalized_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

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
