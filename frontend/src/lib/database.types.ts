export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      user_meal_plans: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          people_count: number;
          period: 'week' | 'fortnight' | 'month';
          mode: 'inventory_to_menu' | 'menu_to_shopping' | 'balanced_ai';
          base_cuisine: string;
          fusion_cuisines: string[];
          fusion_intensity: 'sutil' | 'media' | 'alta';
          goal: string | null;
          restrictions: string[];
          inventory_snapshot: Json;
          calendar_payload: Json;
          ai_content: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          people_count?: number;
          period: 'week' | 'fortnight' | 'month';
          mode: 'inventory_to_menu' | 'menu_to_shopping' | 'balanced_ai';
          base_cuisine: string;
          fusion_cuisines?: string[];
          fusion_intensity: 'sutil' | 'media' | 'alta';
          goal?: string | null;
          restrictions?: string[];
          inventory_snapshot: Json;
          calendar_payload: Json;
          ai_content?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          people_count?: number;
          period?: 'week' | 'fortnight' | 'month';
          mode?: 'inventory_to_menu' | 'menu_to_shopping' | 'balanced_ai';
          base_cuisine?: string;
          fusion_cuisines?: string[];
          fusion_intensity?: 'sutil' | 'media' | 'alta';
          goal?: string | null;
          restrictions?: string[];
          inventory_snapshot?: Json;
          calendar_payload?: Json;
          ai_content?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_meal_plan_inventory_suggestions: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          meal_plan_id: string;
          people_count: number;
          period: 'week' | 'fortnight' | 'month';
          normalized_items: Json;
          raw_items: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          meal_plan_id: string;
          people_count: number;
          period: 'week' | 'fortnight' | 'month';
          normalized_items: Json;
          raw_items: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          meal_plan_id?: string;
          people_count?: number;
          period?: 'week' | 'fortnight' | 'month';
          normalized_items?: Json;
          raw_items?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_meal_plan_optimization_snapshots: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          meal_plan_id: string;
          optimization_mode:
            | 'reduce_waste'
            | 'optimize_cost'
            | 'prioritize_fresh'
            | 'reduce_missing'
            | 'reuse_proteins'
            | 'balance_ingredients';
          baseline_score: Json;
          optimized_score: Json;
          comparison: Json;
          explainability_notes: Json;
          baseline_calendar: Json;
          optimized_calendar: Json;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          meal_plan_id: string;
          optimization_mode:
            | 'reduce_waste'
            | 'optimize_cost'
            | 'prioritize_fresh'
            | 'reduce_missing'
            | 'reuse_proteins'
            | 'balance_ingredients';
          baseline_score: Json;
          optimized_score: Json;
          comparison: Json;
          explainability_notes: Json;
          baseline_calendar: Json;
          optimized_calendar: Json;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          meal_plan_id?: string;
          optimization_mode?:
            | 'reduce_waste'
            | 'optimize_cost'
            | 'prioritize_fresh'
            | 'reduce_missing'
            | 'reuse_proteins'
            | 'balance_ingredients';
          baseline_score?: Json;
          optimized_score?: Json;
          comparison?: Json;
          explainability_notes?: Json;
          baseline_calendar?: Json;
          optimized_calendar?: Json;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          id: string;
          tenant_id: string | null;
          email: string | null;
          role: 'owner' | 'admin' | 'member';
          full_name: string | null;
          terms_accepted_at: string | null;
          terms_version: string | null;
          onboarding_completed: boolean | null;
          created_at: string | null;
        };
        Insert: {
          id: string;
          tenant_id?: string | null;
          email?: string | null;
          role?: 'owner' | 'admin' | 'member';
          full_name?: string | null;
          terms_accepted_at?: string | null;
          terms_version?: string | null;
          onboarding_completed?: boolean | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string | null;
          email?: string | null;
          role?: 'owner' | 'admin' | 'member';
          full_name?: string | null;
          terms_accepted_at?: string | null;
          terms_version?: string | null;
          onboarding_completed?: boolean | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      tenants: {
        Row: {
          id: string;
          tenant_type: 'home' | 'professional';
          trial_started_at: string | null;
          trial_ends_at: string | null;
          trial_soft_blocked_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_type?: 'home' | 'professional';
          trial_started_at?: string | null;
          trial_ends_at?: string | null;
          trial_soft_blocked_at?: string | null;
        };
        Update: {
          id?: string;
          tenant_type?: 'home' | 'professional';
          trial_started_at?: string | null;
          trial_ends_at?: string | null;
          trial_soft_blocked_at?: string | null;
        };
        Relationships: [];
      };
      tenant_invitations: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          invited_by: string;
          role: 'member';
          invitation_token: string;
          status: 'pending' | 'accepted' | 'revoked' | 'expired';
          expires_at: string;
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          email: string;
          invited_by: string;
          role?: 'member';
          invitation_token: string;
          status?: 'pending' | 'accepted' | 'revoked' | 'expired';
          expires_at?: string;
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          email?: string;
          invited_by?: string;
          role?: 'member';
          invitation_token?: string;
          status?: 'pending' | 'accepted' | 'revoked' | 'expired';
          expires_at?: string;
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      platform_owners: {
        Row: {
          user_id: string;
          created_at: string;
          requires_manual_review: boolean;
        };
        Insert: {
          user_id: string;
          created_at?: string;
          requires_manual_review?: boolean;
        };
        Update: {
          user_id?: string;
          created_at?: string;
          requires_manual_review?: boolean;
        };
        Relationships: [];
      };
      global_books: {
        Row: {
          id: string;
          title: string;
          author: string | null;
          description: string | null;
          cuisine_region: string;
          cuisine_country: string | null;
          cuisine_style: string | null;
          tags: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          author?: string | null;
          description?: string | null;
          cuisine_region?: string;
          cuisine_country?: string | null;
          cuisine_style?: string | null;
          tags?: string[];
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          author?: string | null;
          description?: string | null;
          cuisine_region?: string;
          cuisine_country?: string | null;
          cuisine_style?: string | null;
          tags?: string[];
          created_at?: string;
        };
        Relationships: [];
      };
      global_pdf_library: {
        Row: {
          id: string;
          global_book_id: string;
          storage_path: string;
          file_size_bytes: number;
          page_count: number;
          checksum_sha256: string;
          uploaded_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          global_book_id: string;
          storage_path: string;
          file_size_bytes: number;
          page_count: number;
          checksum_sha256: string;
          uploaded_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          global_book_id?: string;
          storage_path?: string;
          file_size_bytes?: number;
          page_count?: number;
          checksum_sha256?: string;
          uploaded_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      recipe_inventory_items: {
        Row: {
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
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          ingredient_name: string;
          quantity?: string | null;
          unit?: string | null;
          category?: string | null;
          expiration_date?: string | null;
          estimated_unit_price?: number | null;
          purchase_location?: string | null;
          low_stock_threshold?: number | null;
          normalized_name?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          ingredient_name?: string;
          quantity?: string | null;
          unit?: string | null;
          category?: string | null;
          expiration_date?: string | null;
          estimated_unit_price?: number | null;
          purchase_location?: string | null;
          low_stock_threshold?: number | null;
          normalized_name?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      inventory_movements: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          inventory_item_id: string;
          movement_type: 'purchase' | 'recipe_consumption' | 'manual_adjustment' | 'correction';
          quantity: number;
          unit: string;
          normalized_name: string;
          source: string;
          source_recipe: string | null;
          source_meal_plan_id: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          inventory_item_id: string;
          movement_type: 'purchase' | 'recipe_consumption' | 'manual_adjustment' | 'correction';
          quantity: number;
          unit: string;
          normalized_name: string;
          source?: string;
          source_recipe?: string | null;
          source_meal_plan_id?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          inventory_item_id?: string;
          movement_type?: 'purchase' | 'recipe_consumption' | 'manual_adjustment' | 'correction';
          quantity?: number;
          unit?: string;
          normalized_name?: string;
          source?: string;
          source_recipe?: string | null;
          source_meal_plan_id?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      recipe_ai_history: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          source: string;
          recipe_title: string | null;
          recipe_payload: Json;
          restrictions_snapshot: Json;
          inventory_snapshot: Json;
          user_feedback: 'accepted' | 'discarded' | null;
          user_feedback_at: string | null;
          is_saved: boolean;
          expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          source: string;
          recipe_title?: string | null;
          recipe_payload: Json;
          restrictions_snapshot?: Json;
          inventory_snapshot?: Json;
          user_feedback?: 'accepted' | 'discarded' | null;
          user_feedback_at?: string | null;
          is_saved?: boolean;
          expires_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          source?: string;
          recipe_title?: string | null;
          recipe_payload?: Json;
          restrictions_snapshot?: Json;
          inventory_snapshot?: Json;
          user_feedback?: 'accepted' | 'discarded' | null;
          user_feedback_at?: string | null;
          is_saved?: boolean;
          expires_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      tenant_pdf_library: {
        Row: {
          id: string;
          tenant_id: string;
          tenant_book_id: string | null;
          storage_path: string;
          file_size_bytes: number | null;
          page_count: number | null;
          checksum_sha256: string | null;
          created_at: string;
          ocr_used: boolean;
          processing_status: 'processing' | 'ready' | 'failed';
          processed_chunks_count: number | null;
          processing_error: string | null;
          uploaded_by: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          tenant_book_id?: string | null;
          storage_path: string;
          file_size_bytes?: number | null;
          page_count?: number | null;
          checksum_sha256?: string | null;
          created_at?: string;
          ocr_used?: boolean;
          processing_status?: 'processing' | 'ready' | 'failed';
          processed_chunks_count?: number | null;
          processing_error?: string | null;
          uploaded_by?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          tenant_book_id?: string | null;
          storage_path?: string;
          file_size_bytes?: number | null;
          page_count?: number | null;
          checksum_sha256?: string | null;
          created_at?: string;
          ocr_used?: boolean;
          processing_status?: 'processing' | 'ready' | 'failed';
          processed_chunks_count?: number | null;
          processing_error?: string | null;
          uploaded_by?: string | null;
        };
        Relationships: [];
      };
      tenant_books: {
        Row: {
          id: string;
          tenant_id: string;
          title: string;
          author: string | null;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          title: string;
          author?: string | null;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          title?: string;
          author?: string | null;
          description?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      user_culinary_profiles: {
        Row: {
          user_id: string;
          tenant_id: string;
          level: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          tenant_id: string;
          level?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          tenant_id?: string;
          level?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_culinary_profile_terms: {
        Row: {
          user_id: string;
          term_id: string;
          preference_type: 'identity' | 'prefer' | 'avoid' | 'goal';
          weight: number;
          created_at: string;
          culinary_terms: { label: string }[] | { label: string } | null;
        };
        Insert: {
          user_id: string;
          term_id: string;
          preference_type: 'identity' | 'prefer' | 'avoid' | 'goal';
          weight?: number;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          term_id?: string;
          preference_type?: 'identity' | 'prefer' | 'avoid' | 'goal';
          weight?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      culinary_terms: {
        Row: {
          id: string;
          dimension_id: string;
          label: string;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          dimension_id: string;
          label: string;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          dimension_id?: string;
          label?: string;
          is_active?: boolean;
        };
        Relationships: [];
      };
      culinary_dimensions: {
        Row: {
          id: string;
          key: string;
          label: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          label: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          key?: string;
          label?: string;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };

      saved_premium_recipes: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          premium_recipe_id: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          premium_recipe_id: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          premium_recipe_id?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      shopping_list_items: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          source: string;
          premium_recipe_id: string | null;
          ingredient_name: string;
          quantity: string | null;
          status: 'pending' | 'purchased';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          source?: string;
          premium_recipe_id?: string | null;
          ingredient_name: string;
          quantity?: string | null;
          status?: 'pending' | 'purchased';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          source?: string;
          premium_recipe_id?: string | null;
          ingredient_name?: string;
          quantity?: string | null;
          status?: 'pending' | 'purchased';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      premium_recipes: {
        Row: {
          id: string;
          source_recipe_history_id: string;
          source_tenant_id: string;
          creator_user_id: string;
          creator_display_name: string | null;
          eligibility_score: number;
          creator_opted_in: boolean;
          status: 'published' | 'withdrawn' | 'moderation_hidden';
          published_at: string | null;
          withdrawn_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          source_recipe_history_id: string;
          source_tenant_id: string;
          creator_user_id: string;
          creator_display_name?: string | null;
          eligibility_score: number;
          creator_opted_in?: boolean;
          status?: 'published' | 'withdrawn' | 'moderation_hidden';
          published_at?: string | null;
          withdrawn_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          source_recipe_history_id?: string;
          source_tenant_id?: string;
          creator_user_id?: string;
          creator_display_name?: string | null;
          eligibility_score?: number;
          creator_opted_in?: boolean;
          status?: 'published' | 'withdrawn' | 'moderation_hidden';
          published_at?: string | null;
          withdrawn_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      premium_recipe_reviews: {
        Row: {
          id: string;
          premium_recipe_id: string;
          user_id: string;
          stars: 1 | 2 | 3 | 4 | 5;
          comment: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          premium_recipe_id: string;
          user_id: string;
          stars: 1 | 2 | 3 | 4 | 5;
          comment?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          premium_recipe_id?: string;
          user_id?: string;
          stars?: 1 | 2 | 3 | 4 | 5;
          comment?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      premium_review_reports: {
        Row: {
          id: string;
          premium_recipe_id: string;
          review_id: string | null;
          reporter_user_id: string;
          reason: string;
          status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          premium_recipe_id: string;
          review_id?: string | null;
          reporter_user_id: string;
          reason: string;
          status?: 'open' | 'reviewing' | 'resolved' | 'dismissed';
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          premium_recipe_id?: string;
          review_id?: string | null;
          reporter_user_id?: string;
          reason?: string;
          status?: 'open' | 'reviewing' | 'resolved' | 'dismissed';
          created_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [];
      };
      book_chunks: {
        Row: {
          id: string;
          tenant_id: string | null;
          tenant_book_id: string | null;
          global_book_id: string | null;
          source_type: string;
          content: string;
          metadata: Json | null;
          embedding: number[] | null;
        };
        Insert: {
          id?: string;
          tenant_id?: string | null;
          tenant_book_id?: string | null;
          global_book_id?: string | null;
          source_type: string;
          content: string;
          metadata?: Json | null;
          embedding?: number[] | null;
        };
        Update: {
          id?: string;
          tenant_id?: string | null;
          tenant_book_id?: string | null;
          global_book_id?: string | null;
          source_type?: string;
          content?: string;
          metadata?: Json | null;
          embedding?: number[] | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      accept_tenant_invitation: {
        Args: {
          p_invitation_token: string;
        };
        Returns: string;
      };
      match_chunks: {
        Args: {
          query_embedding: number[];
          match_threshold: number;
          match_count: number;
          filter_tenant_id: string | null;
        };
        Returns: Array<{
          id: string;
          content: string;
          similarity: number;
          metadata: { page_number?: number; book_title?: string } | null;
        }>;
      };
      is_platform_owner: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      get_owner_overview_metrics: {
        Args: Record<string, never>;
        Returns: Json;
      };
      remove_tenant_member: {
        Args: {
          p_member_id: string;
        };
        Returns: void;
      };
      update_tenant_member_role: {
        Args: {
          p_member_id: string;
          p_role: 'admin' | 'member';
        };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
