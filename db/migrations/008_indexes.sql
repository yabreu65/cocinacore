-- Migration 008: Indexes for tenant-scoped and search queries

-- Tenants
create index idx_tenants_created_at on public.tenants(created_at);

-- Users
create index idx_users_tenant_id on public.users(tenant_id);
create index idx_users_email on public.users(email);
create index idx_users_created_at on public.users(created_at);

-- Sessions
create index idx_sessions_user_id on public.sessions(user_id);
create index idx_sessions_token_hash on public.sessions(token_hash);
create index idx_sessions_expires_at on public.sessions(expires_at);

-- Tenant memberships
create index idx_tenant_memberships_tenant_id on public.tenant_memberships(tenant_id);
create index idx_tenant_memberships_user_id on public.tenant_memberships(user_id);

-- Books
create index idx_global_books_created_at on public.global_books(created_at);
create index idx_tenant_books_tenant_id on public.tenant_books(tenant_id);
create index idx_tenant_books_created_at on public.tenant_books(created_at);

-- PDF libraries
create index idx_global_pdf_library_global_book_id on public.global_pdf_library(global_book_id);
create index idx_tenant_pdf_library_tenant_id on public.tenant_pdf_library(tenant_id);
create index idx_tenant_pdf_library_tenant_book_id on public.tenant_pdf_library(tenant_book_id);
create index idx_tenant_pdf_library_processing_status on public.tenant_pdf_library(processing_status);

-- Book chunks
create index idx_book_chunks_tenant_id on public.book_chunks(tenant_id);
create index idx_book_chunks_global_book_id on public.book_chunks(global_book_id);
create index idx_book_chunks_tenant_book_id on public.book_chunks(tenant_book_id);
create index idx_book_chunks_source_type on public.book_chunks(source_type);
create index idx_book_chunks_embedding_hnsw on public.book_chunks using hnsw (embedding vector_cosine_ops);

-- Inventory
create index idx_recipe_inventory_items_tenant_id on public.recipe_inventory_items(tenant_id);
create index idx_recipe_inventory_items_user_id on public.recipe_inventory_items(user_id);
create index idx_recipe_inventory_items_normalized_name on public.recipe_inventory_items(normalized_name);
create index idx_recipe_inventory_items_created_at on public.recipe_inventory_items(created_at);

create index idx_inventory_movements_tenant_id on public.inventory_movements(tenant_id);
create index idx_inventory_movements_user_id on public.inventory_movements(user_id);
create index idx_inventory_movements_inventory_item_id on public.inventory_movements(inventory_item_id);

-- Recipe AI history
create index idx_recipe_ai_history_tenant_id on public.recipe_ai_history(tenant_id);
create index idx_recipe_ai_history_user_id on public.recipe_ai_history(user_id);
create index idx_recipe_ai_history_is_saved on public.recipe_ai_history(is_saved);
create index idx_recipe_ai_history_expires_at on public.recipe_ai_history(expires_at);
create index idx_recipe_ai_history_created_at on public.recipe_ai_history(created_at);

-- Meal plans
create index idx_user_meal_plans_tenant_id on public.user_meal_plans(tenant_id);
create index idx_user_meal_plans_user_id on public.user_meal_plans(user_id);
create index idx_user_meal_plans_created_at on public.user_meal_plans(created_at);

create index idx_meal_plan_suggestions_tenant_id on public.user_meal_plan_inventory_suggestions(tenant_id);
create index idx_meal_plan_suggestions_meal_plan_id on public.user_meal_plan_inventory_suggestions(meal_plan_id);

create index idx_meal_plan_snapshots_tenant_id on public.user_meal_plan_optimization_snapshots(tenant_id);
create index idx_meal_plan_snapshots_meal_plan_id on public.user_meal_plan_optimization_snapshots(meal_plan_id);

-- Premium
create index idx_premium_recipes_source_tenant_id on public.premium_recipes(source_tenant_id);
create index idx_premium_recipes_creator_user_id on public.premium_recipes(creator_user_id);
create index idx_premium_recipes_status on public.premium_recipes(status);

create index idx_saved_premium_recipes_tenant_id on public.saved_premium_recipes(tenant_id);
create index idx_saved_premium_recipes_user_id on public.saved_premium_recipes(user_id);

create index idx_premium_recipe_reviews_premium_recipe_id on public.premium_recipe_reviews(premium_recipe_id);
create index idx_premium_recipe_reviews_user_id on public.premium_recipe_reviews(user_id);

create index idx_premium_review_reports_premium_recipe_id on public.premium_review_reports(premium_recipe_id);

-- Shopping list
create index idx_shopping_list_items_tenant_id on public.shopping_list_items(tenant_id);
create index idx_shopping_list_items_user_id on public.shopping_list_items(user_id);
create index idx_shopping_list_items_status on public.shopping_list_items(status);

-- Invitations
create index idx_tenant_invitations_tenant_id on public.tenant_invitations(tenant_id);
create index idx_tenant_invitations_token on public.tenant_invitations(invitation_token);
create index idx_tenant_invitations_status on public.tenant_invitations(status);

-- Culinary taxonomy
create index idx_culinary_terms_dimension_id on public.culinary_terms(dimension_id);
create index idx_user_culinary_profile_terms_user_id on public.user_culinary_profile_terms(user_id);
