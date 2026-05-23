export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          tenant_id: string | null;
          full_name: string | null;
          onboarding_completed: boolean | null;
        };
        Insert: {
          id: string;
          tenant_id?: string | null;
          full_name?: string | null;
          onboarding_completed?: boolean | null;
        };
        Update: {
          id?: string;
          tenant_id?: string | null;
          full_name?: string | null;
          onboarding_completed?: boolean | null;
        };
        Relationships: [];
      };
      tenants: {
        Row: {
          id: string;
          trial_ends_at: string | null;
        };
        Insert: {
          id?: string;
          trial_ends_at?: string | null;
        };
        Update: {
          id?: string;
          trial_ends_at?: string | null;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          ingredient_name: string;
          quantity?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          ingredient_name?: string;
          quantity?: string | null;
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
          user_feedback: "accepted" | "discarded" | null;
          user_feedback_at: string | null;
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
          user_feedback?: "accepted" | "discarded" | null;
          user_feedback_at?: string | null;
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
          user_feedback?: "accepted" | "discarded" | null;
          user_feedback_at?: string | null;
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
          processing_status: "processing" | "ready" | "failed";
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
          processing_status?: "processing" | "ready" | "failed";
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
          processing_status?: "processing" | "ready" | "failed";
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
          preference_type: "identity" | "prefer" | "avoid" | "goal";
          weight: number;
          created_at: string;
          culinary_terms: { label: string }[] | { label: string } | null;
        };
        Insert: {
          user_id: string;
          term_id: string;
          preference_type: "identity" | "prefer" | "avoid" | "goal";
          weight?: number;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          term_id?: string;
          preference_type?: "identity" | "prefer" | "avoid" | "goal";
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
