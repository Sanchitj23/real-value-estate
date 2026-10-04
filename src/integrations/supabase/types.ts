export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          detail: Json
          entity: string
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          detail?: Json
          entity: string
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          detail?: Json
          entity?: string
          entity_id?: string | null
          id?: string
        }
        Relationships: []
      }
      dataset_versions: {
        Row: {
          change_tests: Json
          counts: Json
          created_at: string
          created_by: string | null
          default_as_of: string
          format_version: string
          id: string
          known_gaps: Json
          package_metadata: Json
          package_name: string | null
          receipt: Json
          rule_record_schema: Json | null
          status: string
          upload_sha256: string
        }
        Insert: {
          change_tests?: Json
          counts?: Json
          created_at?: string
          created_by?: string | null
          default_as_of?: string
          format_version: string
          id?: string
          known_gaps?: Json
          package_metadata?: Json
          package_name?: string | null
          receipt?: Json
          rule_record_schema?: Json | null
          status?: string
          upload_sha256: string
        }
        Update: {
          change_tests?: Json
          counts?: Json
          created_at?: string
          created_by?: string | null
          default_as_of?: string
          format_version?: string
          id?: string
          known_gaps?: Json
          package_metadata?: Json
          package_name?: string | null
          receipt?: Json
          rule_record_schema?: Json | null
          status?: string
          upload_sha256?: string
        }
        Relationships: []
      }
      extraction_runs: {
        Row: {
          candidates: number
          chunk_count: number
          chunk_index: number
          created_at: string
          created_by: string | null
          error: string | null
          finished_at: string | null
          id: string
          invalid: number
          model: string
          pipeline_version: string
          raw_output: Json | null
          source_id: string
          status: string
          valid: number
        }
        Insert: {
          candidates?: number
          chunk_count?: number
          chunk_index?: number
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          invalid?: number
          model: string
          pipeline_version: string
          raw_output?: Json | null
          source_id: string
          status?: string
          valid?: number
        }
        Update: {
          candidates?: number
          chunk_count?: number
          chunk_index?: number
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          invalid?: number
          model?: string
          pipeline_version?: string
          raw_output?: Json | null
          source_id?: string
          status?: string
          valid?: number
        }
        Relationships: [
          {
            foreignKeyName: "extraction_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      jurisdiction_resolutions: {
        Row: {
          benchmark: string | null
          county_name: string | null
          created_at: string
          created_by: string | null
          evidence: Json
          id: string
          is_current: boolean
          lat: number | null
          lon: number | null
          matched_address: string | null
          place_geoid: string | null
          place_kind: string | null
          place_name: string | null
          property_id: string
          provider: string
          state_name: string | null
          status: string
          vintage: string | null
          warnings: Json
        }
        Insert: {
          benchmark?: string | null
          county_name?: string | null
          created_at?: string
          created_by?: string | null
          evidence?: Json
          id?: string
          is_current?: boolean
          lat?: number | null
          lon?: number | null
          matched_address?: string | null
          place_geoid?: string | null
          place_kind?: string | null
          place_name?: string | null
          property_id: string
          provider?: string
          state_name?: string | null
          status: string
          vintage?: string | null
          warnings?: Json
        }
        Update: {
          benchmark?: string | null
          county_name?: string | null
          created_at?: string
          created_by?: string | null
          evidence?: Json
          id?: string
          is_current?: boolean
          lat?: number | null
          lon?: number | null
          matched_address?: string | null
          place_geoid?: string | null
          place_kind?: string | null
          place_name?: string | null
          property_id?: string
          provider?: string
          state_name?: string | null
          status?: string
          vintage?: string | null
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "jurisdiction_resolutions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address_id: string
          dataset_id: string
          id: string
          postal_city: string | null
          raw_row: Json
          retrieved_at: string | null
          source_dataset: string | null
          state: string
          street_address: string
          units: number | null
          use_code: string | null
          use_description: string | null
          year_built: number | null
          zip: string | null
        }
        Insert: {
          address_id: string
          dataset_id: string
          id?: string
          postal_city?: string | null
          raw_row?: Json
          retrieved_at?: string | null
          source_dataset?: string | null
          state: string
          street_address: string
          units?: number | null
          use_code?: string | null
          use_description?: string | null
          year_built?: number | null
          zip?: string | null
        }
        Update: {
          address_id?: string
          dataset_id?: string
          id?: string
          postal_city?: string | null
          raw_row?: Json
          retrieved_at?: string | null
          source_dataset?: string | null
          state?: string
          street_address?: string
          units?: number | null
          use_code?: string | null
          use_description?: string | null
          year_built?: number | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "dataset_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_evidence: {
        Row: {
          end_offset: number | null
          field: string
          id: string
          match_kind: string
          quote: string
          rule_version_id: string
          start_offset: number | null
          valid: boolean
        }
        Insert: {
          end_offset?: number | null
          field: string
          id?: string
          match_kind: string
          quote: string
          rule_version_id: string
          start_offset?: number | null
          valid: boolean
        }
        Update: {
          end_offset?: number | null
          field?: string
          id?: string
          match_kind?: string
          quote?: string
          rule_version_id?: string
          start_offset?: number | null
          valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "rule_evidence_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_relations: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          evidence_quote: string | null
          from_rule_key: string
          id: string
          note: string | null
          relation_type: string
          to_rule_key: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          evidence_quote?: string | null
          from_rule_key: string
          id?: string
          note?: string | null
          relation_type: string
          to_rule_key: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          evidence_quote?: string | null
          from_rule_key?: string
          id?: string
          note?: string | null
          relation_type?: string
          to_rule_key?: string
        }
        Relationships: []
      }
      rule_versions: {
        Row: {
          category: string
          change_reason: string | null
          citation: string
          city: string | null
          confidence: number | null
          coverage: Json | null
          coverage_text: string | null
          created_at: string
          created_by: string | null
          effective_date: string | null
          enacted_date: string | null
          exemptions: Json | null
          exemptions_text: string | null
          expiry_date: string | null
          id: string
          interaction_text: string | null
          is_current: boolean
          jurisdiction: string
          key_value: string | null
          legal_status: string
          level: string
          quoted_span: string
          requirement: string
          review_state: string
          rule_key: string
          run_id: string | null
          source_id: string
          source_url: string | null
          state: string
          supersedes: string | null
          title: string
          validation_errors: Json
          version: number
        }
        Insert: {
          category: string
          change_reason?: string | null
          citation: string
          city?: string | null
          confidence?: number | null
          coverage?: Json | null
          coverage_text?: string | null
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          enacted_date?: string | null
          exemptions?: Json | null
          exemptions_text?: string | null
          expiry_date?: string | null
          id?: string
          interaction_text?: string | null
          is_current?: boolean
          jurisdiction: string
          key_value?: string | null
          legal_status?: string
          level: string
          quoted_span: string
          requirement: string
          review_state?: string
          rule_key: string
          run_id?: string | null
          source_id: string
          source_url?: string | null
          state: string
          supersedes?: string | null
          title: string
          validation_errors?: Json
          version?: number
        }
        Update: {
          category?: string
          change_reason?: string | null
          citation?: string
          city?: string | null
          confidence?: number | null
          coverage?: Json | null
          coverage_text?: string | null
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          enacted_date?: string | null
          exemptions?: Json | null
          exemptions_text?: string | null
          expiry_date?: string | null
          id?: string
          interaction_text?: string | null
          is_current?: boolean
          jurisdiction?: string
          key_value?: string | null
          legal_status?: string
          level?: string
          quoted_span?: string
          requirement?: string
          review_state?: string
          rule_key?: string
          run_id?: string | null
          source_id?: string
          source_url?: string | null
          state?: string
          supersedes?: string | null
          title?: string
          validation_errors?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "rule_versions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_versions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_versions_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      scenarios: {
        Row: {
          as_of: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          patch: Json
          rule_key: string
        }
        Insert: {
          as_of?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          patch?: Json
          rule_key: string
        }
        Update: {
          as_of?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          patch?: Json
          rule_key?: string
        }
        Relationships: []
      }
      semantic_mappings: {
        Row: {
          challenge_rule_id: string
          mapped_at: string
          mapped_by: string | null
          note: string | null
          rule_key: string | null
        }
        Insert: {
          challenge_rule_id: string
          mapped_at?: string
          mapped_by?: string | null
          note?: string | null
          rule_key?: string | null
        }
        Update: {
          challenge_rule_id?: string
          mapped_at?: string
          mapped_by?: string | null
          note?: string | null
          rule_key?: string | null
        }
        Relationships: []
      }
      source_documents: {
        Row: {
          capture: string | null
          dataset_id: string
          doc_id: string
          hash_matches: boolean | null
          id: string
          imported_at: string
          jurisdictions: string | null
          link_only_row: Json | null
          local_sha256: string | null
          manifest_row: Json
          manifest_sha256: string | null
          retrieved_at: string | null
          source_type: string | null
          text: string | null
          text_available: boolean
          url: string | null
        }
        Insert: {
          capture?: string | null
          dataset_id: string
          doc_id: string
          hash_matches?: boolean | null
          id?: string
          imported_at?: string
          jurisdictions?: string | null
          link_only_row?: Json | null
          local_sha256?: string | null
          manifest_row?: Json
          manifest_sha256?: string | null
          retrieved_at?: string | null
          source_type?: string | null
          text?: string | null
          text_available?: boolean
          url?: string | null
        }
        Update: {
          capture?: string | null
          dataset_id?: string
          doc_id?: string
          hash_matches?: boolean | null
          id?: string
          imported_at?: string
          jurisdictions?: string | null
          link_only_row?: Json | null
          local_sha256?: string | null
          manifest_row?: Json
          manifest_sha256?: string | null
          retrieved_at?: string | null
          source_type?: string | null
          text?: string | null
          text_available?: boolean
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_documents_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "dataset_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "reviewer" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "reviewer", "user"],
    },
  },
} as const
