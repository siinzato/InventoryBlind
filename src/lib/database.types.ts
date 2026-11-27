// GERADO AUTOMATICAMENTE — não edite à mão.
//
// Origem: schema `public` do Supabase, lido do banco (não das migrations).
// Regenerar depois de QUALQUER migration aplicada:
//
//   npx supabase@latest gen types typescript --project-id <ref do VITE_SUPABASE_URL> --schema public > src/lib/database.types.ts
//
// Este arquivo é o contrato entre o cliente e o banco. Tipo escrito à mão em
// supabase.ts descreve o que alguém ACHA que a tabela tem; este descreve o que ela tem.

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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      abc_curve_analyses: {
        Row: {
          company_id: string
          cost_coverage_pct: number | null
          created_at: string
          created_by: string | null
          excess_coverage_days: number
          healthy_coverage_days: number
          id: string
          low_coverage_days: number
          low_margin_pct: number
          name: string
          pricing_snapshot_date: string
          published_at: string | null
          published_by: string | null
          sales_period_end: string
          sales_period_start: string
          status: string
          stock_coverage_pct: number | null
          stock_snapshot_date: string | null
          strong_margin_pct: number
          threshold_a: number
          threshold_b: number
          total_quantity: number
          total_revenue: number
          total_sku_count: number
          updated_at: string
          warning_count: number
        }
        Insert: {
          company_id?: string
          cost_coverage_pct?: number | null
          created_at?: string
          created_by?: string | null
          excess_coverage_days?: number
          healthy_coverage_days?: number
          id?: string
          low_coverage_days?: number
          low_margin_pct?: number
          name: string
          pricing_snapshot_date: string
          published_at?: string | null
          published_by?: string | null
          sales_period_end: string
          sales_period_start: string
          status?: string
          stock_coverage_pct?: number | null
          stock_snapshot_date?: string | null
          strong_margin_pct?: number
          threshold_a?: number
          threshold_b?: number
          total_quantity?: number
          total_revenue?: number
          total_sku_count?: number
          updated_at?: string
          warning_count?: number
        }
        Update: {
          company_id?: string
          cost_coverage_pct?: number | null
          created_at?: string
          created_by?: string | null
          excess_coverage_days?: number
          healthy_coverage_days?: number
          id?: string
          low_coverage_days?: number
          low_margin_pct?: number
          name?: string
          pricing_snapshot_date?: string
          published_at?: string | null
          published_by?: string | null
          sales_period_end?: string
          sales_period_start?: string
          status?: string
          stock_coverage_pct?: number | null
          stock_snapshot_date?: string | null
          strong_margin_pct?: number
          threshold_a?: number
          threshold_b?: number
          total_quantity?: number
          total_revenue?: number
          total_sku_count?: number
          updated_at?: string
          warning_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "abc_curve_analyses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      abc_curve_import_batches: {
        Row: {
          analysis_id: string
          company_id: string
          connection_id: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          file_hash: string | null
          file_kind: string
          file_name: string | null
          id: string
          imported_count: number
          provider: string | null
          row_count: number
          source_type: string
          status: string
          sync_status: string | null
          warning_count: number
        }
        Insert: {
          analysis_id: string
          company_id?: string
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          file_hash?: string | null
          file_kind: string
          file_name?: string | null
          id?: string
          imported_count?: number
          provider?: string | null
          row_count?: number
          source_type?: string
          status?: string
          sync_status?: string | null
          warning_count?: number
        }
        Update: {
          analysis_id?: string
          company_id?: string
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          file_hash?: string | null
          file_kind?: string
          file_name?: string | null
          id?: string
          imported_count?: number
          provider?: string | null
          row_count?: number
          source_type?: string
          status?: string
          sync_status?: string | null
          warning_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "abc_curve_import_batches_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "abc_curve_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abc_curve_import_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      abc_curve_recommendations: {
        Row: {
          analysis_id: string
          code: string
          company_id: string
          created_at: string
          id: string
          justification: string
          priority: number
          rule_applied: string
          sku: string
          sku_snapshot_id: string
        }
        Insert: {
          analysis_id: string
          code: string
          company_id?: string
          created_at?: string
          id?: string
          justification: string
          priority: number
          rule_applied: string
          sku: string
          sku_snapshot_id: string
        }
        Update: {
          analysis_id?: string
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          justification?: string
          priority?: number
          rule_applied?: string
          sku?: string
          sku_snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "abc_curve_recommendations_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "abc_curve_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abc_curve_recommendations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abc_curve_recommendations_sku_snapshot_id_fkey"
            columns: ["sku_snapshot_id"]
            isOneToOne: false
            referencedRelation: "abc_curve_sku_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      abc_curve_sku_snapshots: {
        Row: {
          analysis_id: string
          avg_price: number | null
          cogs: number | null
          company_id: string
          cost: number | null
          cost_state: string
          coverage_days: number | null
          created_at: string
          daily_demand: number | null
          freight: number
          gross_margin: number | null
          gross_profit: number | null
          id: string
          lead_time_days: number | null
          list_price: number | null
          price_realization: number | null
          product_id: string | null
          product_name: string | null
          profit_class: string | null
          promo_price: number | null
          quantity: number
          realized_markup: number | null
          reorder_point: number | null
          revenue: number
          revenue_class: string | null
          safety_stock: number | null
          signal_codes: string[]
          sku: string
          stock_available: number | null
          stock_in_transit: number | null
          stock_reserved: number | null
          suggested_purchase: number | null
          tiny_classification: string | null
          tiny_cumulative_pct: number | null
          tiny_individual_pct: number | null
          tiny_quantity: number | null
          tiny_value: number | null
          turnover_class: string | null
          updated_at: string
        }
        Insert: {
          analysis_id: string
          avg_price?: number | null
          cogs?: number | null
          company_id?: string
          cost?: number | null
          cost_state?: string
          coverage_days?: number | null
          created_at?: string
          daily_demand?: number | null
          freight?: number
          gross_margin?: number | null
          gross_profit?: number | null
          id?: string
          lead_time_days?: number | null
          list_price?: number | null
          price_realization?: number | null
          product_id?: string | null
          product_name?: string | null
          profit_class?: string | null
          promo_price?: number | null
          quantity?: number
          realized_markup?: number | null
          reorder_point?: number | null
          revenue?: number
          revenue_class?: string | null
          safety_stock?: number | null
          signal_codes?: string[]
          sku: string
          stock_available?: number | null
          stock_in_transit?: number | null
          stock_reserved?: number | null
          suggested_purchase?: number | null
          tiny_classification?: string | null
          tiny_cumulative_pct?: number | null
          tiny_individual_pct?: number | null
          tiny_quantity?: number | null
          tiny_value?: number | null
          turnover_class?: string | null
          updated_at?: string
        }
        Update: {
          analysis_id?: string
          avg_price?: number | null
          cogs?: number | null
          company_id?: string
          cost?: number | null
          cost_state?: string
          coverage_days?: number | null
          created_at?: string
          daily_demand?: number | null
          freight?: number
          gross_margin?: number | null
          gross_profit?: number | null
          id?: string
          lead_time_days?: number | null
          list_price?: number | null
          price_realization?: number | null
          product_id?: string | null
          product_name?: string | null
          profit_class?: string | null
          promo_price?: number | null
          quantity?: number
          realized_markup?: number | null
          reorder_point?: number | null
          revenue?: number
          revenue_class?: string | null
          safety_stock?: number | null
          signal_codes?: string[]
          sku?: string
          stock_available?: number | null
          stock_in_transit?: number | null
          stock_reserved?: number | null
          suggested_purchase?: number | null
          tiny_classification?: string | null
          tiny_cumulative_pct?: number | null
          tiny_individual_pct?: number | null
          tiny_quantity?: number | null
          tiny_value?: number | null
          turnover_class?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "abc_curve_sku_snapshots_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "abc_curve_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abc_curve_sku_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abc_curve_sku_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_certificates: {
        Row: {
          company_id: string
          id: string
          issued_at: string | null
          learner_name: string
          total_workload_hours: number
          track_id: string
          user_id: string
        }
        Insert: {
          company_id?: string
          id?: string
          issued_at?: string | null
          learner_name: string
          total_workload_hours: number
          track_id: string
          user_id?: string
        }
        Update: {
          company_id?: string
          id?: string
          issued_at?: string | null
          learner_name?: string
          total_workload_hours?: number
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_certificates_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "academy_track_progress_v"
            referencedColumns: ["track_id"]
          },
          {
            foreignKeyName: "academy_certificates_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "academy_tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_course_progress: {
        Row: {
          company_id: string
          completed_at: string | null
          course_id: string
          id: string
          started_at: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company_id?: string
          completed_at?: string | null
          course_id: string
          id?: string
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          course_id?: string
          id?: string
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_course_progress_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_courses: {
        Row: {
          created_at: string | null
          id: string
          is_placeholder: boolean
          key: string
          objectives: string
          order_index: number
          pilar_tag: string | null
          title: string
          track_id: string
          workload_hours: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_placeholder?: boolean
          key: string
          objectives: string
          order_index?: number
          pilar_tag?: string | null
          title: string
          track_id: string
          workload_hours?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          is_placeholder?: boolean
          key?: string
          objectives?: string
          order_index?: number
          pilar_tag?: string | null
          title?: string
          track_id?: string
          workload_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "academy_courses_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "academy_track_progress_v"
            referencedColumns: ["track_id"]
          },
          {
            foreignKeyName: "academy_courses_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "academy_tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_enrollments: {
        Row: {
          company_id: string
          completed_at: string | null
          id: string
          started_at: string | null
          track_id: string
          user_id: string
        }
        Insert: {
          company_id?: string
          completed_at?: string | null
          id?: string
          started_at?: string | null
          track_id: string
          user_id?: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          id?: string
          started_at?: string | null
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_enrollments_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "academy_track_progress_v"
            referencedColumns: ["track_id"]
          },
          {
            foreignKeyName: "academy_enrollments_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "academy_tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_lesson_progress: {
        Row: {
          company_id: string
          completed: boolean
          completed_at: string | null
          id: string
          lesson_id: string
          user_id: string
        }
        Insert: {
          company_id?: string
          completed?: boolean
          completed_at?: string | null
          id?: string
          lesson_id: string
          user_id?: string
        }
        Update: {
          company_id?: string
          completed?: boolean
          completed_at?: string | null
          id?: string
          lesson_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "academy_lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_lessons: {
        Row: {
          attachments: Json
          body_richtext: string
          course_id: string
          created_at: string | null
          id: string
          order_index: number
          title: string
          video_url: string | null
        }
        Insert: {
          attachments?: Json
          body_richtext: string
          course_id: string
          created_at?: string | null
          id?: string
          order_index?: number
          title: string
          video_url?: string | null
        }
        Update: {
          attachments?: Json
          body_richtext?: string
          course_id?: string
          created_at?: string | null
          id?: string
          order_index?: number
          title?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academy_lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_quiz_attempts: {
        Row: {
          answers: Json
          company_id: string
          created_at: string | null
          id: string
          passed: boolean
          quiz_id: string
          score_pct: number
          user_id: string
        }
        Insert: {
          answers: Json
          company_id?: string
          created_at?: string | null
          id?: string
          passed: boolean
          quiz_id: string
          score_pct: number
          user_id?: string
        }
        Update: {
          answers?: Json
          company_id?: string
          created_at?: string | null
          id?: string
          passed?: boolean
          quiz_id?: string
          score_pct?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_quiz_attempts_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "academy_quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_quiz_questions: {
        Row: {
          correct_index: number
          id: string
          options: Json
          order_index: number
          question: string
          quiz_id: string
        }
        Insert: {
          correct_index: number
          id?: string
          options: Json
          order_index?: number
          question: string
          quiz_id: string
        }
        Update: {
          correct_index?: number
          id?: string
          options?: Json
          order_index?: number
          question?: string
          quiz_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_quiz_questions_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "academy_quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_quizzes: {
        Row: {
          course_id: string
          created_at: string | null
          id: string
          min_pass_pct: number
        }
        Insert: {
          course_id: string
          created_at?: string | null
          id?: string
          min_pass_pct?: number
        }
        Update: {
          course_id?: string
          created_at?: string | null
          id?: string
          min_pass_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "academy_quizzes_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_tracks: {
        Row: {
          created_at: string | null
          description: string
          icon: string
          id: string
          key: string
          order_index: number
          title: string
        }
        Insert: {
          created_at?: string | null
          description: string
          icon?: string
          id?: string
          key: string
          order_index?: number
          title: string
        }
        Update: {
          created_at?: string | null
          description?: string
          icon?: string
          id?: string
          key?: string
          order_index?: number
          title?: string
        }
        Relationships: []
      }
      accuracy_target_settings: {
        Row: {
          company_id: string
          created_at: string
          target_pct: number
          updated_at: string
          warning_floor_pct: number
        }
        Insert: {
          company_id?: string
          created_at?: string
          target_pct?: number
          updated_at?: string
          warning_floor_pct?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          target_pct?: number
          updated_at?: string
          warning_floor_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "accuracy_target_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      achievement_definitions: {
        Row: {
          category: string
          created_at: string | null
          description: string
          goal_metric: string
          goal_value: number
          icon: string
          id: string
          key: string
          level: string
          order_index: number
          title: string
        }
        Insert: {
          category: string
          created_at?: string | null
          description: string
          goal_metric: string
          goal_value: number
          icon?: string
          id?: string
          key: string
          level: string
          order_index?: number
          title: string
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string
          goal_metric?: string
          goal_value?: number
          icon?: string
          id?: string
          key?: string
          level?: string
          order_index?: number
          title?: string
        }
        Relationships: []
      }
      admin_top10_config: {
        Row: {
          abc_analysis_id: string | null
          company_id: string
          created_at: string
          enabled: boolean
          id: string
          manual_metric: string
          manual_period_from: string | null
          manual_period_preset: string
          manual_period_to: string | null
          ranking_metric: string | null
          source_mode: string
          updated_at: string
        }
        Insert: {
          abc_analysis_id?: string | null
          company_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          manual_metric?: string
          manual_period_from?: string | null
          manual_period_preset?: string
          manual_period_to?: string | null
          ranking_metric?: string | null
          source_mode?: string
          updated_at?: string
        }
        Update: {
          abc_analysis_id?: string | null
          company_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          manual_metric?: string
          manual_period_from?: string | null
          manual_period_preset?: string
          manual_period_to?: string | null
          ranking_metric?: string | null
          source_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_top10_config_abc_analysis_id_fkey"
            columns: ["abc_analysis_id"]
            isOneToOne: false
            referencedRelation: "abc_curve_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_top10_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      api_key_rate_limits: {
        Row: {
          api_key_id: string
          request_count: number
          window_start: string
        }
        Insert: {
          api_key_id: string
          request_count?: number
          window_start?: string
        }
        Update: {
          api_key_id?: string
          request_count?: number
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_key_rate_limits_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: true
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          company_id: string | null
          created_at: string | null
          description: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          resource_id: string | null
          resource_type: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          company_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_events: {
        Row: {
          company_id: string
          created_at: string
          depth: number
          event_type: string
          id: string
          origin_automation_id: string | null
          origin_execution_id: string | null
          payload: Json
          processed_at: string | null
          resume_actions: Json | null
          resume_automation_id: string | null
          resume_execution_id: string | null
          resume_node_id: string | null
          scheduled_for: string | null
          source_id: string | null
          source_table: string | null
          status: string
        }
        Insert: {
          company_id: string
          created_at?: string
          depth?: number
          event_type: string
          id?: string
          origin_automation_id?: string | null
          origin_execution_id?: string | null
          payload?: Json
          processed_at?: string | null
          resume_actions?: Json | null
          resume_automation_id?: string | null
          resume_execution_id?: string | null
          resume_node_id?: string | null
          scheduled_for?: string | null
          source_id?: string | null
          source_table?: string | null
          status?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          depth?: number
          event_type?: string
          id?: string
          origin_automation_id?: string | null
          origin_execution_id?: string | null
          payload?: Json
          processed_at?: string | null
          resume_actions?: Json | null
          resume_automation_id?: string | null
          resume_execution_id?: string | null
          resume_node_id?: string | null
          scheduled_for?: string | null
          source_id?: string | null
          source_table?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_events_resume_automation_id_fkey"
            columns: ["resume_automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_events_resume_execution_id_fkey"
            columns: ["resume_execution_id"]
            isOneToOne: false
            referencedRelation: "automation_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_executions: {
        Row: {
          automation_id: string
          automation_version: number
          company_id: string
          context: Json
          depth: number
          dry_run: boolean
          duration_ms: number | null
          error_message: string | null
          event_id: string | null
          finished_at: string | null
          id: string
          resumed_at_node_id: string | null
          resumed_from_execution_id: string | null
          started_at: string
          status: string
          trigger_source: string
          trigger_type: string
          triggered_by: string | null
        }
        Insert: {
          automation_id: string
          automation_version?: number
          company_id: string
          context?: Json
          depth?: number
          dry_run?: boolean
          duration_ms?: number | null
          error_message?: string | null
          event_id?: string | null
          finished_at?: string | null
          id?: string
          resumed_at_node_id?: string | null
          resumed_from_execution_id?: string | null
          started_at?: string
          status?: string
          trigger_source?: string
          trigger_type: string
          triggered_by?: string | null
        }
        Update: {
          automation_id?: string
          automation_version?: number
          company_id?: string
          context?: Json
          depth?: number
          dry_run?: boolean
          duration_ms?: number | null
          error_message?: string | null
          event_id?: string | null
          finished_at?: string | null
          id?: string
          resumed_at_node_id?: string | null
          resumed_from_execution_id?: string | null
          started_at?: string
          status?: string
          trigger_source?: string
          trigger_type?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_executions_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "automation_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_resumed_from_execution_id_fkey"
            columns: ["resumed_from_execution_id"]
            isOneToOne: false
            referencedRelation: "automation_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_node_executions: {
        Row: {
          attempts: number
          company_id: string
          condition_result: boolean | null
          duration_ms: number | null
          error_message: string | null
          execution_id: string
          finished_at: string | null
          id: string
          node_id: string
          node_label: string | null
          node_type: string
          output: Json | null
          sequence: number
          started_at: string
          status: string
        }
        Insert: {
          attempts?: number
          company_id: string
          condition_result?: boolean | null
          duration_ms?: number | null
          error_message?: string | null
          execution_id: string
          finished_at?: string | null
          id?: string
          node_id: string
          node_label?: string | null
          node_type: string
          output?: Json | null
          sequence: number
          started_at?: string
          status: string
        }
        Update: {
          attempts?: number
          company_id?: string
          condition_result?: boolean | null
          duration_ms?: number | null
          error_message?: string | null
          execution_id?: string
          finished_at?: string | null
          id?: string
          node_id?: string
          node_label?: string | null
          node_type?: string
          output?: Json | null
          sequence?: number
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_node_executions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_node_executions_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "automation_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_notifications: {
        Row: {
          automation_id: string | null
          body: string | null
          company_id: string
          context: Json
          created_at: string
          execution_id: string | null
          id: string
          read_at: string | null
          recipient_id: string | null
          severity: string
          title: string
        }
        Insert: {
          automation_id?: string | null
          body?: string | null
          company_id: string
          context?: Json
          created_at?: string
          execution_id?: string | null
          id?: string
          read_at?: string | null
          recipient_id?: string | null
          severity?: string
          title: string
        }
        Update: {
          automation_id?: string | null
          body?: string | null
          company_id?: string
          context?: Json
          created_at?: string
          execution_id?: string | null
          id?: string
          read_at?: string | null
          recipient_id?: string | null
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_notifications_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_notifications_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "automation_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_pending_waits: {
        Row: {
          automation_id: string
          company_id: string
          created_at: string
          depth: number
          event_type: string
          execution_id: string
          expires_at: string
          id: string
          payload: Json
          resume_actions: Json
          resume_node_id: string
          resumed_at: string | null
          status: string
          token: string
        }
        Insert: {
          automation_id: string
          company_id: string
          created_at?: string
          depth?: number
          event_type: string
          execution_id: string
          expires_at: string
          id?: string
          payload?: Json
          resume_actions?: Json
          resume_node_id: string
          resumed_at?: string | null
          status?: string
          token: string
        }
        Update: {
          automation_id?: string
          company_id?: string
          created_at?: string
          depth?: number
          event_type?: string
          execution_id?: string
          expires_at?: string
          id?: string
          payload?: Json
          resume_actions?: Json
          resume_node_id?: string
          resumed_at?: string | null
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_pending_waits_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_pending_waits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_pending_waits_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "automation_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runtime_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      automation_webhook_deliveries: {
        Row: {
          automation_id: string
          company_id: string
          event_id: string | null
          id: string
          payload_hash: string
          reason: string | null
          received_at: string
          status: string
        }
        Insert: {
          automation_id: string
          company_id: string
          event_id?: string | null
          id?: string
          payload_hash: string
          reason?: string | null
          received_at?: string
          status: string
        }
        Update: {
          automation_id?: string
          company_id?: string
          event_id?: string | null
          id?: string
          payload_hash?: string
          reason?: string | null
          received_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_webhook_deliveries_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_webhook_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_webhook_deliveries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "automation_events"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_webhook_secrets: {
        Row: {
          automation_id: string
          company_id: string
          created_at: string
          rotated_at: string | null
          secret: string
        }
        Insert: {
          automation_id: string
          company_id: string
          created_at?: string
          rotated_at?: string | null
          secret: string
        }
        Update: {
          automation_id?: string
          company_id?: string
          created_at?: string
          rotated_at?: string | null
          secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_webhook_secrets_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: true
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_webhook_secrets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          execution_count: number
          id: string
          last_executed_at: string | null
          name: string
          schedule_hour: number | null
          schedule_kind: string | null
          schedule_minute: number | null
          schedule_minutes: number | null
          schedule_next_run_at: string | null
          schedule_timezone: string
          schedule_weekday: number | null
          status: string
          trigger_type: string
          updated_at: string
          version: number
          workflow: Json
        }
        Insert: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          execution_count?: number
          id?: string
          last_executed_at?: string | null
          name: string
          schedule_hour?: number | null
          schedule_kind?: string | null
          schedule_minute?: number | null
          schedule_minutes?: number | null
          schedule_next_run_at?: string | null
          schedule_timezone?: string
          schedule_weekday?: number | null
          status?: string
          trigger_type: string
          updated_at?: string
          version?: number
          workflow?: Json
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          execution_count?: number
          id?: string
          last_executed_at?: string | null
          name?: string
          schedule_hour?: number | null
          schedule_kind?: string | null
          schedule_minute?: number | null
          schedule_minutes?: number | null
          schedule_next_run_at?: string | null
          schedule_timezone?: string
          schedule_weekday?: number | null
          status?: string
          trigger_type?: string
          updated_at?: string
          version?: number
          workflow?: Json
        }
        Relationships: [
          {
            foreignKeyName: "automations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          logo_path: string | null
          name: string
          owner_id: string | null
          plan: string
          settings: Json
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          logo_path?: string | null
          name: string
          owner_id?: string | null
          plan?: string
          settings?: Json
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          logo_path?: string | null
          name?: string
          owner_id?: string | null
          plan?: string
          settings?: Json
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      company_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          company_id: string
          created_at: string
          email: string
          email_normalized: string
          expires_at: string
          id: string
          invited_by: string | null
          invited_name: string | null
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id: string
          created_at?: string
          email: string
          email_normalized: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          invited_name?: string | null
          role: string
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id?: string
          created_at?: string
          email?: string
          email_normalized?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          invited_name?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_invite_codes: {
        Row: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          valid_date: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          valid_date?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          valid_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_invite_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string | null
          last_accessed_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          last_accessed_at?: string | null
          role?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          last_accessed_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_security_settings: {
        Row: {
          allowed_file_types: string[] | null
          company_id: string
          created_at: string | null
          id: string
          max_failed_login_attempts: number | null
          max_upload_size_mb: number | null
          require_2fa: boolean | null
          require_email_confirmation: boolean | null
          session_timeout_minutes: number | null
          updated_at: string | null
        }
        Insert: {
          allowed_file_types?: string[] | null
          company_id: string
          created_at?: string | null
          id?: string
          max_failed_login_attempts?: number | null
          max_upload_size_mb?: number | null
          require_2fa?: boolean | null
          require_email_confirmation?: boolean | null
          session_timeout_minutes?: number | null
          updated_at?: string | null
        }
        Update: {
          allowed_file_types?: string[] | null
          company_id?: string
          created_at?: string | null
          id?: string
          max_failed_login_attempts?: number | null
          max_upload_size_mb?: number | null
          require_2fa?: boolean | null
          require_email_confirmation?: boolean | null
          session_timeout_minutes?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      company_webhook_deliveries: {
        Row: {
          attempt_count: number
          company_id: string
          created_at: string
          delivered_at: string | null
          duration_ms: number | null
          error_message: string | null
          event_type: string
          http_status: number | null
          id: string
          next_attempt_at: string
          payload: Json
          status: string
          webhook_id: string
        }
        Insert: {
          attempt_count?: number
          company_id: string
          created_at?: string
          delivered_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          event_type: string
          http_status?: number | null
          id?: string
          next_attempt_at?: string
          payload?: Json
          status?: string
          webhook_id: string
        }
        Update: {
          attempt_count?: number
          company_id?: string
          created_at?: string
          delivered_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          event_type?: string
          http_status?: number | null
          id?: string
          next_attempt_at?: string
          payload?: Json
          status?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_webhook_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "company_webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      company_webhook_secrets: {
        Row: {
          secret: string
          updated_at: string
          webhook_id: string
        }
        Insert: {
          secret: string
          updated_at?: string
          webhook_id: string
        }
        Update: {
          secret?: string
          updated_at?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_webhook_secrets_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: true
            referencedRelation: "company_webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      company_webhooks: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          events: string[]
          id: string
          is_active: boolean
          last_delivery_at: string | null
          last_delivery_http_status: number | null
          last_delivery_status: string | null
          name: string
          updated_at: string
          url: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          events?: string[]
          id?: string
          is_active?: boolean
          last_delivery_at?: string | null
          last_delivery_http_status?: number | null
          last_delivery_status?: string | null
          name: string
          updated_at?: string
          url: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          events?: string[]
          id?: string
          is_active?: boolean
          last_delivery_at?: string | null
          last_delivery_http_status?: number | null
          last_delivery_status?: string | null
          name?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_webhooks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_kpis: {
        Row: {
          company_id: string
          cor_icone: string | null
          created_at: string | null
          id: string
          order_index: number | null
          tipo_variacao: string | null
          titulo: string
          unidade: string | null
          updated_at: string | null
          valor: string
          variacao: string | null
        }
        Insert: {
          company_id?: string
          cor_icone?: string | null
          created_at?: string | null
          id?: string
          order_index?: number | null
          tipo_variacao?: string | null
          titulo: string
          unidade?: string | null
          updated_at?: string | null
          valor: string
          variacao?: string | null
        }
        Update: {
          company_id?: string
          cor_icone?: string | null
          created_at?: string | null
          id?: string
          order_index?: number | null
          tipo_variacao?: string | null
          titulo?: string
          unidade?: string | null
          updated_at?: string | null
          valor?: string
          variacao?: string | null
        }
        Relationships: []
      }
      cycle_program_notifications: {
        Row: {
          company_id: string
          created_at: string
          id: string
          kind: string
          message: string
          read_at: string | null
          reference_date: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          kind: string
          message: string
          read_at?: string | null
          reference_date: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          kind?: string
          message?: string
          read_at?: string | null
          reference_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_program_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_program_settings: {
        Row: {
          cadence_days_a: number
          cadence_days_b: number
          cadence_days_c: number
          cadence_days_unclassified: number
          company_id: string
          created_at: string
          daily_capacity: number
          enabled: boolean
          schedule_enabled: boolean
          schedule_hour: number
          schedule_timezone: string
          schedule_weekdays: number[]
          updated_at: string
        }
        Insert: {
          cadence_days_a?: number
          cadence_days_b?: number
          cadence_days_c?: number
          cadence_days_unclassified?: number
          company_id?: string
          created_at?: string
          daily_capacity?: number
          enabled?: boolean
          schedule_enabled?: boolean
          schedule_hour?: number
          schedule_timezone?: string
          schedule_weekdays?: number[]
          updated_at?: string
        }
        Update: {
          cadence_days_a?: number
          cadence_days_b?: number
          cadence_days_c?: number
          cadence_days_unclassified?: number
          company_id?: string
          created_at?: string
          daily_capacity?: number
          enabled?: boolean
          schedule_enabled?: boolean
          schedule_hour?: number
          schedule_timezone?: string
          schedule_weekdays?: number[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_program_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_incentives: {
        Row: {
          cc_manager: boolean
          company_id: string
          created_at: string | null
          employee_user_id: string
          id: string
          message: string
          reward_suggestion: string | null
          sent_by: string | null
          status: string
          subject: string
          type: string
        }
        Insert: {
          cc_manager?: boolean
          company_id?: string
          created_at?: string | null
          employee_user_id: string
          id?: string
          message: string
          reward_suggestion?: string | null
          sent_by?: string | null
          status?: string
          subject: string
          type: string
        }
        Update: {
          cc_manager?: boolean
          company_id?: string
          created_at?: string | null
          employee_user_id?: string
          id?: string
          message?: string
          reward_suggestion?: string | null
          sent_by?: string | null
          status?: string
          subject?: string
          type?: string
        }
        Relationships: []
      }
      erp_integrations: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string | null
          id: string
          last_sync_at: string | null
          provider: string
          status: string
          token_masked: string | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          last_sync_at?: string | null
          provider: string
          status?: string
          token_masked?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          last_sync_at?: string | null
          provider?: string
          status?: string
          token_masked?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      erp_sync_events: {
        Row: {
          adjustment: number | null
          company_id: string
          created_at: string | null
          created_by: string | null
          error_message: string | null
          final_quantity: number | null
          id: string
          idempotency_key: string
          item_id: string | null
          pending: boolean
          previous_quantity: number | null
          product_id: string | null
          provider: string
          request_payload: Json | null
          response_payload: Json | null
          session_id: string
          sku: string | null
          success: boolean
        }
        Insert: {
          adjustment?: number | null
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          final_quantity?: number | null
          id?: string
          idempotency_key: string
          item_id?: string | null
          pending?: boolean
          previous_quantity?: number | null
          product_id?: string | null
          provider?: string
          request_payload?: Json | null
          response_payload?: Json | null
          session_id: string
          sku?: string | null
          success: boolean
        }
        Update: {
          adjustment?: number | null
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          final_quantity?: number | null
          id?: string
          idempotency_key?: string
          item_id?: string | null
          pending?: boolean
          previous_quantity?: number | null
          product_id?: string | null
          provider?: string
          request_payload?: Json | null
          response_payload?: Json | null
          session_id?: string
          sku?: string | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "erp_sync_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_sync_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "physical_count_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_sync_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "physical_count_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_entities: {
        Row: {
          cnpj: string
          company_id: string
          created_at: string
          created_by: string | null
          data_incomplete: boolean
          id: string
          is_default: boolean
          legal_name: string
          state_registration: string | null
          status: string
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          cnpj: string
          company_id: string
          created_at?: string
          created_by?: string | null
          data_incomplete?: boolean
          id?: string
          is_default?: boolean
          legal_name: string
          state_registration?: string | null
          status?: string
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          cnpj?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          data_incomplete?: boolean
          id?: string
          is_default?: boolean
          legal_name?: string
          state_registration?: string | null
          status?: string
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_entities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      full_operation_items: {
        Row: {
          company_id: string
          created_at: string | null
          ean: string | null
          id: string
          listing_id: string | null
          location: string | null
          operation_id: string
          picked_at: string | null
          picked_by_user_id: string | null
          picker_notes: string | null
          product_id: string | null
          product_name: string | null
          quantity_picked: number
          quantity_requested: number
          sku: string | null
          status: string
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          ean?: string | null
          id?: string
          listing_id?: string | null
          location?: string | null
          operation_id: string
          picked_at?: string | null
          picked_by_user_id?: string | null
          picker_notes?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity_picked?: number
          quantity_requested?: number
          sku?: string | null
          status?: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          ean?: string | null
          id?: string
          listing_id?: string | null
          location?: string | null
          operation_id?: string
          picked_at?: string | null
          picked_by_user_id?: string | null
          picker_notes?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity_picked?: number
          quantity_requested?: number
          sku?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "full_operation_items_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "full_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      full_operations: {
        Row: {
          assigned_user_id: string | null
          checked_at: string | null
          checker: string | null
          checker_notes: string | null
          company_id: string
          completed_at: string | null
          created_at: string | null
          full_number: string
          id: string
          marketplace: string
          notes: string | null
          responsible: string | null
          scheduled_date: string | null
          scheduled_time: string | null
          status: string
          total_pieces: number
          total_sku: number
          updated_at: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          checked_at?: string | null
          checker?: string | null
          checker_notes?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string | null
          full_number: string
          id?: string
          marketplace?: string
          notes?: string | null
          responsible?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          status?: string
          total_pieces?: number
          total_sku?: number
          updated_at?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          checked_at?: string | null
          checker?: string | null
          checker_notes?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string | null
          full_number?: string
          id?: string
          marketplace?: string
          notes?: string | null
          responsible?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          status?: string
          total_pieces?: number
          total_sku?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      full_withdrawal_events: {
        Row: {
          company_id: string
          created_by: string | null
          event_type: string
          id: string
          note: string | null
          occurred_at: string
          plan_id: string
        }
        Insert: {
          company_id?: string
          created_by?: string | null
          event_type: string
          id?: string
          note?: string | null
          occurred_at?: string
          plan_id: string
        }
        Update: {
          company_id?: string
          created_by?: string | null
          event_type?: string
          id?: string
          note?: string | null
          occurred_at?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "full_withdrawal_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "full_withdrawal_events_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "full_withdrawal_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      full_withdrawal_items: {
        Row: {
          company_id: string
          confirmed_quantity: number | null
          created_at: string
          description: string
          divergence_note: string | null
          divergence_noted_at: string | null
          divergence_noted_by: string | null
          id: string
          plan_id: string
          planned_quantity: number
          product_id: string | null
          received_quantity: number | null
          situation: string
          sku: string | null
          updated_at: string
        }
        Insert: {
          company_id?: string
          confirmed_quantity?: number | null
          created_at?: string
          description?: string
          divergence_note?: string | null
          divergence_noted_at?: string | null
          divergence_noted_by?: string | null
          id?: string
          plan_id: string
          planned_quantity: number
          product_id?: string | null
          received_quantity?: number | null
          situation?: string
          sku?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          confirmed_quantity?: number | null
          created_at?: string
          description?: string
          divergence_note?: string | null
          divergence_noted_at?: string | null
          divergence_noted_by?: string | null
          id?: string
          plan_id?: string
          planned_quantity?: number
          product_id?: string | null
          received_quantity?: number | null
          situation?: string
          sku?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "full_withdrawal_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "full_withdrawal_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "full_withdrawal_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "full_withdrawal_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      full_withdrawal_plans: {
        Row: {
          cancellation_reason: string | null
          code: string
          company_id: string
          conferred_at: string | null
          cost: number | null
          cost_note: string | null
          created_at: string
          created_by: string | null
          destination_address: string | null
          destination_label: string | null
          expected_delivery_date: string | null
          id: string
          method: string
          ml_confirmed_at: string | null
          ml_reference: string | null
          notes: string | null
          preparing_at: string | null
          reason: string | null
          received_at: string | null
          reserved_at: string | null
          shipped_at: string | null
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          code?: string
          company_id?: string
          conferred_at?: string | null
          cost?: number | null
          cost_note?: string | null
          created_at?: string
          created_by?: string | null
          destination_address?: string | null
          destination_label?: string | null
          expected_delivery_date?: string | null
          id?: string
          method?: string
          ml_confirmed_at?: string | null
          ml_reference?: string | null
          notes?: string | null
          preparing_at?: string | null
          reason?: string | null
          received_at?: string | null
          reserved_at?: string | null
          shipped_at?: string | null
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          code?: string
          company_id?: string
          conferred_at?: string | null
          cost?: number | null
          cost_note?: string | null
          created_at?: string
          created_by?: string | null
          destination_address?: string | null
          destination_label?: string | null
          expected_delivery_date?: string | null
          id?: string
          method?: string
          ml_confirmed_at?: string | null
          ml_reference?: string | null
          notes?: string | null
          preparing_at?: string | null
          reason?: string | null
          received_at?: string | null
          reserved_at?: string | null
          shipped_at?: string | null
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "full_withdrawal_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      import_history: {
        Row: {
          column_mapping: Json | null
          company_id: string
          created_at: string | null
          errors: number | null
          file_content: string | null
          file_name: string
          file_size: number | null
          id: string
          imported_by: string | null
          new_products: number | null
          status: string | null
          total_products: number | null
          undone_at: string | null
          updated_products: number | null
        }
        Insert: {
          column_mapping?: Json | null
          company_id?: string
          created_at?: string | null
          errors?: number | null
          file_content?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          imported_by?: string | null
          new_products?: number | null
          status?: string | null
          total_products?: number | null
          undone_at?: string | null
          updated_products?: number | null
        }
        Update: {
          column_mapping?: Json | null
          company_id?: string
          created_at?: string | null
          errors?: number | null
          file_content?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          imported_by?: string | null
          new_products?: number | null
          status?: string | null
          total_products?: number | null
          undone_at?: string | null
          updated_products?: number | null
        }
        Relationships: []
      }
      import_products_audit: {
        Row: {
          action: string
          company_id: string
          created_at: string | null
          id: string
          import_id: string
          new_data: Json | null
          old_data: Json | null
          product_id: string
          sku: string
        }
        Insert: {
          action: string
          company_id?: string
          created_at?: string | null
          id?: string
          import_id: string
          new_data?: Json | null
          old_data?: Json | null
          product_id: string
          sku: string
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string | null
          id?: string
          import_id?: string
          new_data?: Json | null
          old_data?: Json | null
          product_id?: string
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_products_audit_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "import_history"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          company_id: string
          connection_id: string | null
          context: Json
          created_at: string | null
          first_seen_at: string
          id: string
          kind: string
          last_seen_at: string
          message: string
          occurrences: number
          resolved_at: string | null
          severity: string
          status: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          company_id?: string
          connection_id?: string | null
          context?: Json
          created_at?: string | null
          first_seen_at?: string
          id?: string
          kind: string
          last_seen_at?: string
          message: string
          occurrences?: number
          resolved_at?: string | null
          severity?: string
          status?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          company_id?: string
          connection_id?: string | null
          context?: Json
          created_at?: string | null
          first_seen_at?: string
          id?: string
          kind?: string
          last_seen_at?: string
          message?: string
          occurrences?: number
          resolved_at?: string | null
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_alerts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alerts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          auto_sync_enabled: boolean
          company_id: string
          configuration: Json
          conflict_policy: string
          created_at: string | null
          created_by: string | null
          credential_hint: string | null
          credentials_set_at: string | null
          display_name: string
          external_account_id: string | null
          fiscal_entity_id: string | null
          id: string
          last_error: string | null
          last_error_at: string | null
          last_successful_sync_at: string | null
          last_sync_at: string | null
          provider_key: string
          status: string
          stock_source_of_truth: boolean
          sync_cursor: string | null
          sync_direction: string
          sync_interval_minutes: number | null
          updated_at: string | null
        }
        Insert: {
          auto_sync_enabled?: boolean
          company_id?: string
          configuration?: Json
          conflict_policy?: string
          created_at?: string | null
          created_by?: string | null
          credential_hint?: string | null
          credentials_set_at?: string | null
          display_name: string
          external_account_id?: string | null
          fiscal_entity_id?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_successful_sync_at?: string | null
          last_sync_at?: string | null
          provider_key: string
          status?: string
          stock_source_of_truth?: boolean
          sync_cursor?: string | null
          sync_direction?: string
          sync_interval_minutes?: number | null
          updated_at?: string | null
        }
        Update: {
          auto_sync_enabled?: boolean
          company_id?: string
          configuration?: Json
          conflict_policy?: string
          created_at?: string | null
          created_by?: string | null
          credential_hint?: string | null
          credentials_set_at?: string | null
          display_name?: string
          external_account_id?: string | null
          fiscal_entity_id?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_successful_sync_at?: string | null
          last_sync_at?: string | null
          provider_key?: string
          status?: string
          stock_source_of_truth?: boolean
          sync_cursor?: string | null
          sync_direction?: string
          sync_interval_minutes?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_connections_fiscal_entity_id_fkey"
            columns: ["fiscal_entity_id"]
            isOneToOne: false
            referencedRelation: "fiscal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_connections_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "integration_providers"
            referencedColumns: ["key"]
          },
        ]
      }
      integration_credentials: {
        Row: {
          company_id: string
          connection_id: string
          created_at: string | null
          expires_at: string | null
          masked_hint: string | null
          secret: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          company_id: string
          connection_id: string
          created_at?: string | null
          expires_at?: string | null
          masked_hint?: string | null
          secret: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          connection_id?: string
          created_at?: string | null
          expires_at?: string | null
          masked_hint?: string | null
          secret?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_credentials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_credentials_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_entity_links: {
        Row: {
          company_id: string
          connection_id: string
          created_at: string | null
          entity_type: string
          external_code: string | null
          external_ean: string | null
          external_id: string
          external_name: string | null
          external_payload: Json | null
          external_sku: string | null
          id: string
          internal_id: string | null
          last_synced_at: string | null
          match_source: string | null
          updated_at: string | null
        }
        Insert: {
          company_id?: string
          connection_id: string
          created_at?: string | null
          entity_type: string
          external_code?: string | null
          external_ean?: string | null
          external_id: string
          external_name?: string | null
          external_payload?: Json | null
          external_sku?: string | null
          id?: string
          internal_id?: string | null
          last_synced_at?: string | null
          match_source?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          connection_id?: string
          created_at?: string | null
          entity_type?: string
          external_code?: string | null
          external_ean?: string | null
          external_id?: string
          external_name?: string | null
          external_payload?: Json | null
          external_sku?: string | null
          id?: string
          internal_id?: string | null
          last_synced_at?: string | null
          match_source?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_entity_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_entity_links_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_providers: {
        Row: {
          capabilities: Json
          created_at: string | null
          docs_url: string | null
          key: string
          kind: string
          name: string
          status: string
        }
        Insert: {
          capabilities?: Json
          created_at?: string | null
          docs_url?: string | null
          key: string
          kind: string
          name: string
          status?: string
        }
        Update: {
          capabilities?: Json
          created_at?: string | null
          docs_url?: string | null
          key?: string
          kind?: string
          name?: string
          status?: string
        }
        Relationships: []
      }
      integration_rate_limit_state: {
        Row: {
          connection_id: string
          limit_value: number | null
          observed_at: string
          operation: string
          remaining: number | null
          reset_at: string | null
          retry_after_until: string | null
        }
        Insert: {
          connection_id: string
          limit_value?: number | null
          observed_at?: string
          operation?: string
          remaining?: number | null
          reset_at?: string | null
          retry_after_until?: string | null
        }
        Update: {
          connection_id?: string
          limit_value?: number | null
          observed_at?: string
          operation?: string
          remaining?: number | null
          reset_at?: string | null
          retry_after_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_rate_limit_state_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_stock_adjustments: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attempts: number
          company_id: string
          confirmed_at: string | null
          connection_id: string
          counted_quantity: number
          created_at: string | null
          delta_quantity: number
          error_kind: string | null
          error_message: string | null
          external_product_id: string | null
          external_reference: string | null
          external_warehouse_id: string | null
          id: string
          idempotency_key: string
          job_id: string | null
          movement_reason: string | null
          origin: string
          previous_quantity: number
          product_id: string | null
          reason: string | null
          requested_by: string | null
          sent_at: string | null
          sku: string | null
          source_session_id: string | null
          sync_status: string
          target_warehouse_id: string | null
          updated_at: string | null
          write_kind: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attempts?: number
          company_id?: string
          confirmed_at?: string | null
          connection_id: string
          counted_quantity: number
          created_at?: string | null
          delta_quantity: number
          error_kind?: string | null
          error_message?: string | null
          external_product_id?: string | null
          external_reference?: string | null
          external_warehouse_id?: string | null
          id?: string
          idempotency_key: string
          job_id?: string | null
          movement_reason?: string | null
          origin?: string
          previous_quantity: number
          product_id?: string | null
          reason?: string | null
          requested_by?: string | null
          sent_at?: string | null
          sku?: string | null
          source_session_id?: string | null
          sync_status?: string
          target_warehouse_id?: string | null
          updated_at?: string | null
          write_kind: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attempts?: number
          company_id?: string
          confirmed_at?: string | null
          connection_id?: string
          counted_quantity?: number
          created_at?: string | null
          delta_quantity?: number
          error_kind?: string | null
          error_message?: string | null
          external_product_id?: string | null
          external_reference?: string | null
          external_warehouse_id?: string | null
          id?: string
          idempotency_key?: string
          job_id?: string | null
          movement_reason?: string | null
          origin?: string
          previous_quantity?: number
          product_id?: string | null
          reason?: string | null
          requested_by?: string | null
          sent_at?: string | null
          sku?: string | null
          source_session_id?: string | null
          sync_status?: string
          target_warehouse_id?: string | null
          updated_at?: string | null
          write_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_stock_adjustments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_stock_adjustments_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_stock_adjustments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "integration_sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_stock_adjustments_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "physical_count_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_stock_levels: {
        Row: {
          available_quantity: number | null
          company_id: string
          connection_id: string
          created_at: string | null
          entity_link_id: string
          external_warehouse_id: string
          external_warehouse_name: string | null
          id: string
          observed_at: string
          quantity: number
          reserved_quantity: number | null
          updated_at: string | null
        }
        Insert: {
          available_quantity?: number | null
          company_id?: string
          connection_id: string
          created_at?: string | null
          entity_link_id: string
          external_warehouse_id?: string
          external_warehouse_name?: string | null
          id?: string
          observed_at?: string
          quantity?: number
          reserved_quantity?: number | null
          updated_at?: string | null
        }
        Update: {
          available_quantity?: number | null
          company_id?: string
          connection_id?: string
          created_at?: string | null
          entity_link_id?: string
          external_warehouse_id?: string
          external_warehouse_name?: string | null
          id?: string
          observed_at?: string
          quantity?: number
          reserved_quantity?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_stock_levels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_stock_levels_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_stock_levels_entity_link_id_fkey"
            columns: ["entity_link_id"]
            isOneToOne: false
            referencedRelation: "integration_entity_links"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_conflicts: {
        Row: {
          company_id: string
          connection_id: string
          created_at: string | null
          detected_at: string
          entity_type: string
          external_id: string | null
          external_observed_at: string | null
          external_value: Json
          id: string
          internal_id: string | null
          internal_observed_at: string | null
          internal_value: Json
          job_id: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_value: Json | null
          status: string
          updated_at: string | null
        }
        Insert: {
          company_id?: string
          connection_id: string
          created_at?: string | null
          detected_at?: string
          entity_type: string
          external_id?: string | null
          external_observed_at?: string | null
          external_value: Json
          id?: string
          internal_id?: string | null
          internal_observed_at?: string | null
          internal_value: Json
          job_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_value?: Json | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          connection_id?: string
          created_at?: string | null
          detected_at?: string
          entity_type?: string
          external_id?: string | null
          external_observed_at?: string | null
          external_value?: Json
          id?: string
          internal_id?: string | null
          internal_observed_at?: string | null
          internal_value?: Json
          job_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_value?: Json | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_conflicts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_sync_conflicts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_sync_conflicts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "integration_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_items: {
        Row: {
          attempts: number
          company_id: string
          connection_id: string
          created_at: string | null
          entity_type: string
          error_kind: string | null
          error_message: string | null
          external_id: string | null
          id: string
          internal_id: string | null
          job_id: string
          new_value: Json | null
          operation: string
          previous_value: Json | null
          processed_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          company_id?: string
          connection_id: string
          created_at?: string | null
          entity_type: string
          error_kind?: string | null
          error_message?: string | null
          external_id?: string | null
          id?: string
          internal_id?: string | null
          job_id: string
          new_value?: Json | null
          operation: string
          previous_value?: Json | null
          processed_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          company_id?: string
          connection_id?: string
          created_at?: string | null
          entity_type?: string
          error_kind?: string | null
          error_message?: string | null
          external_id?: string | null
          id?: string
          internal_id?: string | null
          job_id?: string
          new_value?: Json | null
          operation?: string
          previous_value?: Json | null
          processed_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_sync_items_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_sync_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "integration_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_runs: {
        Row: {
          company_id: string
          connection_id: string
          created_at: string | null
          created_count: number
          cursor_after: string | null
          cursor_before: string | null
          direction: string
          duration_ms: number | null
          entity_type: string
          error_message: string | null
          error_summary: string | null
          failed_count: number
          finished_at: string | null
          id: string
          idempotency_key: string
          processed_count: number
          records_total: number | null
          skipped_count: number
          started_at: string
          status: string
          sync_type: string
          trigger_source: string
          triggered_by: string | null
          updated_count: number
        }
        Insert: {
          company_id?: string
          connection_id: string
          created_at?: string | null
          created_count?: number
          cursor_after?: string | null
          cursor_before?: string | null
          direction: string
          duration_ms?: number | null
          entity_type: string
          error_message?: string | null
          error_summary?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          processed_count?: number
          records_total?: number | null
          skipped_count?: number
          started_at?: string
          status?: string
          sync_type?: string
          trigger_source?: string
          triggered_by?: string | null
          updated_count?: number
        }
        Update: {
          company_id?: string
          connection_id?: string
          created_at?: string | null
          created_count?: number
          cursor_after?: string | null
          cursor_before?: string | null
          direction?: string
          duration_ms?: number | null
          entity_type?: string
          error_message?: string | null
          error_summary?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          processed_count?: number
          records_total?: number | null
          skipped_count?: number
          started_at?: string
          status?: string
          sync_type?: string
          trigger_source?: string
          triggered_by?: string | null
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_sync_runs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_webhook_events: {
        Row: {
          attempts: number
          company_id: string | null
          connection_id: string | null
          error_kind: string | null
          error_message: string | null
          event_type: string | null
          external_event_id: string
          id: string
          job_id: string | null
          payload: Json | null
          payload_hash: string | null
          processed_at: string | null
          provider_key: string
          provider_timestamp: string | null
          received_at: string
          signature_header: string | null
          signature_valid: boolean | null
          status: string
        }
        Insert: {
          attempts?: number
          company_id?: string | null
          connection_id?: string | null
          error_kind?: string | null
          error_message?: string | null
          event_type?: string | null
          external_event_id: string
          id?: string
          job_id?: string | null
          payload?: Json | null
          payload_hash?: string | null
          processed_at?: string | null
          provider_key: string
          provider_timestamp?: string | null
          received_at?: string
          signature_header?: string | null
          signature_valid?: boolean | null
          status?: string
        }
        Update: {
          attempts?: number
          company_id?: string | null
          connection_id?: string | null
          error_kind?: string | null
          error_message?: string | null
          event_type?: string | null
          external_event_id?: string
          id?: string
          job_id?: string | null
          payload?: Json | null
          payload_hash?: string | null
          processed_at?: string | null
          provider_key?: string
          provider_timestamp?: string | null
          received_at?: string
          signature_header?: string | null
          signature_valid?: boolean | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_webhook_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_webhook_events_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_webhook_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "integration_sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_webhook_events_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "integration_providers"
            referencedColumns: ["key"]
          },
        ]
      }
      integration_webhook_secrets: {
        Row: {
          company_id: string
          connection_id: string
          created_at: string | null
          external_webhook_id: string | null
          secret: string
          topics: string[]
          updated_at: string | null
        }
        Insert: {
          company_id: string
          connection_id: string
          created_at?: string | null
          external_webhook_id?: string | null
          secret: string
          topics?: string[]
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          connection_id?: string
          created_at?: string | null
          external_webhook_id?: string | null
          secret?: string
          topics?: string[]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_webhook_secrets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_webhook_secrets_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_brand_history: {
        Row: {
          accuracy: number | null
          brand: string
          company_id: string
          created_at: string | null
          divergences: number
          done_sku: number
          id: string
          progress: number
          snapshot_id: string
          status: string
          total_sku: number
        }
        Insert: {
          accuracy?: number | null
          brand: string
          company_id?: string
          created_at?: string | null
          divergences: number
          done_sku: number
          id?: string
          progress: number
          snapshot_id: string
          status: string
          total_sku: number
        }
        Update: {
          accuracy?: number | null
          brand?: string
          company_id?: string
          created_at?: string | null
          divergences?: number
          done_sku?: number
          id?: string
          progress?: number
          snapshot_id?: string
          status?: string
          total_sku?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_brand_history_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "inventory_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_brands: {
        Row: {
          brand: string
          company_id: string
          created_at: string | null
          divergences: number
          done_sku: number
          id: string
          logo_path: string | null
          order_index: number | null
          total_sku: number
          updated_at: string | null
        }
        Insert: {
          brand: string
          company_id?: string
          created_at?: string | null
          divergences?: number
          done_sku?: number
          id?: string
          logo_path?: string | null
          order_index?: number | null
          total_sku: number
          updated_at?: string | null
        }
        Update: {
          brand?: string
          company_id?: string
          created_at?: string | null
          divergences?: number
          done_sku?: number
          id?: string
          logo_path?: string | null
          order_index?: number | null
          total_sku?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      inventory_closing_categories: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          id: string
          key: string
          keywords: string[]
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          company_id?: string
          created_at?: string
          id?: string
          key: string
          keywords?: string[]
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          id?: string
          key?: string
          keywords?: string[]
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory_closing_report_observations: {
        Row: {
          company_id: string
          count_record_id: string
          created_at: string
          id: string
          is_unclassified: boolean
          matched_category_ids: string[]
          observation_text: string
          report_id: string
        }
        Insert: {
          company_id?: string
          count_record_id: string
          created_at?: string
          id?: string
          is_unclassified?: boolean
          matched_category_ids?: string[]
          observation_text: string
          report_id: string
        }
        Update: {
          company_id?: string
          count_record_id?: string
          created_at?: string
          id?: string
          is_unclassified?: boolean
          matched_category_ids?: string[]
          observation_text?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_closing_report_observations_count_record_id_fkey"
            columns: ["count_record_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_closing_report_observations_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "inventory_closing_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_closing_reports: {
        Row: {
          accuracy_final: number | null
          accuracy_initial: number | null
          brand_id: string
          category_counts: Json
          company_id: string
          created_at: string
          cycle_start: string | null
          divergencias_encontradas: number
          divergencias_reais: number
          divergencias_recontadas: number
          generated_at: string
          generated_by: string | null
          id: string
          is_current: boolean
          skus_contados: number
          source_count_record_ids: string[]
          summary_text: string
          total_sku: number
          unclassified_count: number
          version: number
        }
        Insert: {
          accuracy_final?: number | null
          accuracy_initial?: number | null
          brand_id: string
          category_counts?: Json
          company_id?: string
          created_at?: string
          cycle_start?: string | null
          divergencias_encontradas?: number
          divergencias_reais?: number
          divergencias_recontadas?: number
          generated_at?: string
          generated_by?: string | null
          id?: string
          is_current?: boolean
          skus_contados?: number
          source_count_record_ids?: string[]
          summary_text: string
          total_sku?: number
          unclassified_count?: number
          version?: number
        }
        Update: {
          accuracy_final?: number | null
          accuracy_initial?: number | null
          brand_id?: string
          category_counts?: Json
          company_id?: string
          created_at?: string
          cycle_start?: string | null
          divergencias_encontradas?: number
          divergencias_reais?: number
          divergencias_recontadas?: number
          generated_at?: string
          generated_by?: string | null
          id?: string
          is_current?: boolean
          skus_contados?: number
          source_count_record_ids?: string[]
          summary_text?: string
          total_sku?: number
          unclassified_count?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_closing_reports_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "inventory_brands"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_import_items: {
        Row: {
          company_id: string
          count_record_id: string
          created_at: string | null
          diferenca: number | null
          ean: string | null
          id: string
          local: string | null
          product_id: string | null
          produto_nome: string | null
          responsavel: string | null
          saldo_contado: number | null
          saldo_sistema: number | null
          sku: string | null
          status: string | null
        }
        Insert: {
          company_id?: string
          count_record_id: string
          created_at?: string | null
          diferenca?: number | null
          ean?: string | null
          id?: string
          local?: string | null
          product_id?: string | null
          produto_nome?: string | null
          responsavel?: string | null
          saldo_contado?: number | null
          saldo_sistema?: number | null
          sku?: string | null
          status?: string | null
        }
        Update: {
          company_id?: string
          count_record_id?: string
          created_at?: string | null
          diferenca?: number | null
          ean?: string | null
          id?: string
          local?: string | null
          product_id?: string | null
          produto_nome?: string | null
          responsavel?: string | null
          saldo_contado?: number | null
          saldo_sistema?: number | null
          sku?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_import_items_count_record_id_fkey"
            columns: ["count_record_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_import_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_records: {
        Row: {
          accuracy_final: number | null
          accuracy_initial: number | null
          approved_at: string | null
          approved_by: string | null
          brand_id: string
          company_id: string
          count_number: number
          created_at: string | null
          created_by: string | null
          divergencias_encontradas: number
          divergencias_reais: number
          divergencias_recontadas: number
          duration_seconds: number | null
          finished_at: string | null
          id: string
          linked_count_id: string | null
          observacoes: string | null
          operator_1: string | null
          operator_2: string | null
          skus_contados: number
          source: string
          started_at: string | null
          total_sku: number
          valor_financeiro_divergencias: number | null
        }
        Insert: {
          accuracy_final?: number | null
          accuracy_initial?: number | null
          approved_at?: string | null
          approved_by?: string | null
          brand_id: string
          company_id?: string
          count_number?: number
          created_at?: string | null
          created_by?: string | null
          divergencias_encontradas?: number
          divergencias_reais?: number
          divergencias_recontadas?: number
          duration_seconds?: number | null
          finished_at?: string | null
          id?: string
          linked_count_id?: string | null
          observacoes?: string | null
          operator_1?: string | null
          operator_2?: string | null
          skus_contados?: number
          source?: string
          started_at?: string | null
          total_sku?: number
          valor_financeiro_divergencias?: number | null
        }
        Update: {
          accuracy_final?: number | null
          accuracy_initial?: number | null
          approved_at?: string | null
          approved_by?: string | null
          brand_id?: string
          company_id?: string
          count_number?: number
          created_at?: string | null
          created_by?: string | null
          divergencias_encontradas?: number
          divergencias_reais?: number
          divergencias_recontadas?: number
          duration_seconds?: number | null
          finished_at?: string | null
          id?: string
          linked_count_id?: string | null
          observacoes?: string | null
          operator_1?: string | null
          operator_2?: string | null
          skus_contados?: number
          source?: string
          started_at?: string | null
          total_sku?: number
          valor_financeiro_divergencias?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_records_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "inventory_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_records_linked_count_id_fkey"
            columns: ["linked_count_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_records"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_cycles: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          company_id: string
          counting_model: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          counting_model?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          counting_model?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_cycles_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "academy_team_summary_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "inventory_cycles_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_cycles_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "user_productivity_stats_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "inventory_cycles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "academy_team_summary_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "inventory_cycles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_cycles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_productivity_stats_v"
            referencedColumns: ["user_id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          company_id: string
          counted_at: string | null
          counted_by: string | null
          counted_by_name: string | null
          counted_quantity: number | null
          created_at: string
          cycle_id: string
          divergence: boolean | null
          expected_quantity: number | null
          id: string
          line_id: string | null
          line_name: string | null
          location: string | null
          observation: string | null
          product_id: string
          product_name: string
          sku: string
          status: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          brand_name?: string | null
          company_id?: string
          counted_at?: string | null
          counted_by?: string | null
          counted_by_name?: string | null
          counted_quantity?: number | null
          created_at?: string
          cycle_id: string
          divergence?: boolean | null
          expected_quantity?: number | null
          id?: string
          line_id?: string | null
          line_name?: string | null
          location?: string | null
          observation?: string | null
          product_id: string
          product_name: string
          sku: string
          status?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          brand_name?: string | null
          company_id?: string
          counted_at?: string | null
          counted_by?: string | null
          counted_by_name?: string | null
          counted_quantity?: number | null
          created_at?: string
          cycle_id?: string
          divergence?: boolean | null
          expected_quantity?: number | null
          id?: string
          line_id?: string | null
          line_name?: string | null
          location?: string | null
          observation?: string | null
          product_id?: string
          product_name?: string
          sku?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "academy_team_summary_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "inventory_items_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "user_productivity_stats_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "inventory_items_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "inventory_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "product_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_kpi_history: {
        Row: {
          company_id: string
          cor_icone: string | null
          created_at: string | null
          id: string
          snapshot_id: string
          tipo_variacao: string | null
          titulo: string
          unidade: string | null
          valor: string
          variacao: string | null
        }
        Insert: {
          company_id?: string
          cor_icone?: string | null
          created_at?: string | null
          id?: string
          snapshot_id: string
          tipo_variacao?: string | null
          titulo: string
          unidade?: string | null
          valor: string
          variacao?: string | null
        }
        Update: {
          company_id?: string
          cor_icone?: string | null
          created_at?: string | null
          id?: string
          snapshot_id?: string
          tipo_variacao?: string | null
          titulo?: string
          unidade?: string | null
          valor?: string
          variacao?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_kpi_history_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "inventory_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_snapshots: {
        Row: {
          accuracy: number | null
          company_id: string
          created_at: string | null
          end_date: string | null
          id: string
          name: string
          notes: string | null
          progress: number | null
          start_date: string | null
          status: string | null
          total_divergences: number | null
          total_done: number | null
          total_sku: number | null
          updated_at: string | null
        }
        Insert: {
          accuracy?: number | null
          company_id?: string
          created_at?: string | null
          end_date?: string | null
          id?: string
          name?: string
          notes?: string | null
          progress?: number | null
          start_date?: string | null
          status?: string | null
          total_divergences?: number | null
          total_done?: number | null
          total_sku?: number | null
          updated_at?: string | null
        }
        Update: {
          accuracy?: number | null
          company_id?: string
          created_at?: string | null
          end_date?: string | null
          id?: string
          name?: string
          notes?: string | null
          progress?: number | null
          start_date?: string | null
          status?: string | null
          total_divergences?: number | null
          total_done?: number | null
          total_sku?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inventory_top_vendas_history: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          order_index: number | null
          produto: string
          sku: string
          snapshot_id: string
          vendas: string
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          id?: string
          order_index?: number | null
          produto: string
          sku: string
          snapshot_id: string
          vendas: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          order_index?: number | null
          produto?: string
          sku?: string
          snapshot_id?: string
          vendas?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_top_vendas_history_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "inventory_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      label_generation_log: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          label_type: string | null
          quantity: number
          sku: string | null
          user_id: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          id?: string
          label_type?: string | null
          quantity?: number
          sku?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          label_type?: string | null
          quantity?: number
          sku?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          company_id: string | null
          created_at: string
          id: string
          privacy_version: string
          terms_version: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          company_id?: string | null
          created_at?: string
          id?: string
          privacy_version: string
          terms_version: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          company_id?: string | null
          created_at?: string
          id?: string
          privacy_version?: string
          terms_version?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_acceptances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_document_versions: {
        Row: {
          created_at: string
          document_type: string
          effective_date: string
          version: string
        }
        Insert: {
          created_at?: string
          document_type: string
          effective_date: string
          version: string
        }
        Update: {
          created_at?: string
          document_type?: string
          effective_date?: string
          version?: string
        }
        Relationships: []
      }
      library_resources: {
        Row: {
          authors: string[] | null
          category: string
          content_origin: string
          cover_url: string | null
          created_at: string | null
          description: string | null
          external_url: string | null
          format: string | null
          id: string
          is_placeholder: boolean
          language: string | null
          level: string | null
          license_name: string | null
          license_url: string | null
          order_index: number
          page_count: number | null
          published_year: number | null
          publisher: string | null
          rights_note: string | null
          source_url: string | null
          storage_path: string | null
          subcategory: string | null
          subject: string | null
          themes: string[] | null
          title: string
        }
        Insert: {
          authors?: string[] | null
          category: string
          content_origin?: string
          cover_url?: string | null
          created_at?: string | null
          description?: string | null
          external_url?: string | null
          format?: string | null
          id?: string
          is_placeholder?: boolean
          language?: string | null
          level?: string | null
          license_name?: string | null
          license_url?: string | null
          order_index?: number
          page_count?: number | null
          published_year?: number | null
          publisher?: string | null
          rights_note?: string | null
          source_url?: string | null
          storage_path?: string | null
          subcategory?: string | null
          subject?: string | null
          themes?: string[] | null
          title: string
        }
        Update: {
          authors?: string[] | null
          category?: string
          content_origin?: string
          cover_url?: string | null
          created_at?: string | null
          description?: string | null
          external_url?: string | null
          format?: string | null
          id?: string
          is_placeholder?: boolean
          language?: string | null
          level?: string | null
          license_name?: string | null
          license_url?: string | null
          order_index?: number
          page_count?: number | null
          published_year?: number | null
          publisher?: string | null
          rights_note?: string | null
          source_url?: string | null
          storage_path?: string | null
          subcategory?: string | null
          subject?: string | null
          themes?: string[] | null
          title?: string
        }
        Relationships: []
      }
      lot_control_settings: {
        Row: {
          company_id: string
          created_at: string
          expiry_alert_days: number
          expiry_enabled: boolean
          lot_enabled: boolean
          updated_at: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          expiry_alert_days?: number
          expiry_enabled?: boolean
          lot_enabled?: boolean
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          expiry_alert_days?: number
          expiry_enabled?: boolean
          lot_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lot_control_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_count_events: {
        Row: {
          admin_reason: string | null
          company_id: string
          created_at: string | null
          created_by: string | null
          delta: number
          ean: string | null
          id: string
          idempotency_key: string
          invoice_id: string
          is_admin_correction: boolean
          item_id: string
          mode: string
          previous_quantity: number | null
          product_id: string | null
          resulting_quantity: number
          sku: string | null
          source: string
        }
        Insert: {
          admin_reason?: string | null
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          delta: number
          ean?: string | null
          id?: string
          idempotency_key: string
          invoice_id: string
          is_admin_correction?: boolean
          item_id: string
          mode: string
          previous_quantity?: number | null
          product_id?: string | null
          resulting_quantity: number
          sku?: string | null
          source?: string
        }
        Update: {
          admin_reason?: string | null
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          delta?: number
          ean?: string | null
          id?: string
          idempotency_key?: string
          invoice_id?: string
          is_admin_correction?: boolean
          item_id?: string
          mode?: string
          previous_quantity?: number | null
          product_id?: string | null
          resulting_quantity?: number
          sku?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfe_count_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_count_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "nfe_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_count_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "nfe_invoice_items"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_invoice_items: {
        Row: {
          company_id: string
          created_at: string | null
          description: string | null
          expected_quantity: number
          id: string
          invoice_id: string
          line_number: number | null
          link_method: string
          nfe_code: string | null
          nfe_ean: string | null
          nfe_ean_normalized: string | null
          physical_quantity: number | null
          product_id: string | null
          result_status: string | null
          snapshot_ean: string | null
          snapshot_product_name: string | null
          snapshot_sku: string | null
          total_value: number | null
          unit: string | null
          unit_value: number | null
          updated_at: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          description?: string | null
          expected_quantity?: number
          id?: string
          invoice_id: string
          line_number?: number | null
          link_method?: string
          nfe_code?: string | null
          nfe_ean?: string | null
          nfe_ean_normalized?: string | null
          physical_quantity?: number | null
          product_id?: string | null
          result_status?: string | null
          snapshot_ean?: string | null
          snapshot_product_name?: string | null
          snapshot_sku?: string | null
          total_value?: number | null
          unit?: string | null
          unit_value?: number | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          description?: string | null
          expected_quantity?: number
          id?: string
          invoice_id?: string
          line_number?: number | null
          link_method?: string
          nfe_code?: string | null
          nfe_ean?: string | null
          nfe_ean_normalized?: string | null
          physical_quantity?: number | null
          product_id?: string | null
          result_status?: string | null
          snapshot_ean?: string | null
          snapshot_product_name?: string | null
          snapshot_sku?: string | null
          total_value?: number | null
          unit?: string | null
          unit_value?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nfe_invoice_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "nfe_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_invoices: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          finished_at: string | null
          finished_by: string | null
          id: string
          invoice_key: string
          invoice_number: string | null
          invoice_series: string | null
          issue_date: string | null
          raw_xml: string | null
          started_at: string | null
          started_by: string | null
          status: string
          supplier_cnpj: string | null
          supplier_name: string | null
          total_items: number
          updated_at: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          finished_at?: string | null
          finished_by?: string | null
          id?: string
          invoice_key: string
          invoice_number?: string | null
          invoice_series?: string | null
          issue_date?: string | null
          raw_xml?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          supplier_cnpj?: string | null
          supplier_name?: string | null
          total_items?: number
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          finished_at?: string | null
          finished_by?: string | null
          id?: string
          invoice_key?: string
          invoice_number?: string | null
          invoice_series?: string | null
          issue_date?: string | null
          raw_xml?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          supplier_cnpj?: string | null
          supplier_name?: string | null
          total_items?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nfe_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_learned_associations: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string | null
          id: string
          match_type: string
          match_value: string
          product_id: string
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          match_type: string
          match_value: string
          product_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          match_type?: string
          match_value?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfe_learned_associations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_learned_associations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_provider_fetch_locks: {
        Row: {
          company_id: string
          id: string
          invoice_key: string
          last_requested_at: string
        }
        Insert: {
          company_id: string
          id?: string
          invoice_key: string
          last_requested_at?: string
        }
        Update: {
          company_id?: string
          id?: string
          invoice_key?: string
          last_requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfe_provider_fetch_locks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_putaway_assignments: {
        Row: {
          bin_code: string
          boxes: number
          company_id: string
          created_at: string
          created_by: string | null
          expiry_date: string | null
          id: string
          invoice_id: string
          item_id: string
          lot_number: string | null
          movement_id: string | null
          product_id: string
          units: number | null
          units_per_box: number
        }
        Insert: {
          bin_code: string
          boxes: number
          company_id: string
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          invoice_id: string
          item_id: string
          lot_number?: string | null
          movement_id?: string | null
          product_id: string
          units?: number | null
          units_per_box: number
        }
        Update: {
          bin_code?: string
          boxes?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          invoice_id?: string
          item_id?: string
          lot_number?: string | null
          movement_id?: string | null
          product_id?: string
          units?: number | null
          units_per_box?: number
        }
        Relationships: [
          {
            foreignKeyName: "nfe_putaway_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_putaway_assignments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "nfe_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_putaway_assignments_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "nfe_invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_putaway_assignments_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "warehouse_bin_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_putaway_assignments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pdi_plans: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string | null
          employee_user_id: string
          goal_description: string | null
          goal_title: string
          id: string
          status: string
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          employee_user_id: string
          goal_description?: string | null
          goal_title: string
          id?: string
          status?: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          employee_user_id?: string
          goal_description?: string | null
          goal_title?: string
          id?: string
          status?: string
        }
        Relationships: []
      }
      pdi_steps: {
        Row: {
          company_id: string
          completed: boolean
          completed_at: string | null
          course_id: string | null
          id: string
          order_index: number
          pdi_plan_id: string
          title: string
        }
        Insert: {
          company_id?: string
          completed?: boolean
          completed_at?: string | null
          course_id?: string | null
          id?: string
          order_index?: number
          pdi_plan_id: string
          title: string
        }
        Update: {
          company_id?: string
          completed?: boolean
          completed_at?: string | null
          course_id?: string | null
          id?: string
          order_index?: number
          pdi_plan_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdi_steps_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdi_steps_pdi_plan_id_fkey"
            columns: ["pdi_plan_id"]
            isOneToOne: false
            referencedRelation: "pdi_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_count_events: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string | null
          delta: number
          ean: string | null
          found_location: string | null
          id: string
          idempotency_key: string
          item_id: string
          mode: string
          product_id: string | null
          resulting_quantity: number
          session_id: string
          sku: string | null
          source: string
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          delta: number
          ean?: string | null
          found_location?: string | null
          id?: string
          idempotency_key: string
          item_id: string
          mode: string
          product_id?: string | null
          resulting_quantity: number
          session_id: string
          sku?: string | null
          source?: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          delta?: number
          ean?: string | null
          found_location?: string | null
          id?: string
          idempotency_key?: string
          item_id?: string
          mode?: string
          product_id?: string | null
          resulting_quantity?: number
          session_id?: string
          sku?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "physical_count_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "physical_count_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "physical_count_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_count_items: {
        Row: {
          company_id: string
          created_at: string | null
          ean: string | null
          erp_quantity_snapshot: number | null
          erp_source: string
          erp_sync_ref: string | null
          found_elsewhere_quantity: number
          found_location: string | null
          id: string
          location: string | null
          physical_quantity: number | null
          product_id: string
          result_status: string | null
          session_id: string
          sku: string | null
          snapshot_ean: string | null
          snapshot_product_name: string | null
          snapshot_sku: string | null
          updated_at: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          ean?: string | null
          erp_quantity_snapshot?: number | null
          erp_source?: string
          erp_sync_ref?: string | null
          found_elsewhere_quantity?: number
          found_location?: string | null
          id?: string
          location?: string | null
          physical_quantity?: number | null
          product_id: string
          result_status?: string | null
          session_id: string
          sku?: string | null
          snapshot_ean?: string | null
          snapshot_product_name?: string | null
          snapshot_sku?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          ean?: string | null
          erp_quantity_snapshot?: number | null
          erp_source?: string
          erp_sync_ref?: string | null
          found_elsewhere_quantity?: number
          found_location?: string | null
          id?: string
          location?: string | null
          physical_quantity?: number | null
          product_id?: string
          result_status?: string | null
          session_id?: string
          sku?: string | null
          snapshot_ean?: string | null
          snapshot_product_name?: string | null
          snapshot_sku?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "physical_count_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "physical_count_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_count_recount_events: {
        Row: {
          absolute_unit_deviation: number
          acknowledged_at: string | null
          acknowledged_by: string | null
          company_id: string
          counted_items: number
          created_at: string
          divergent_items: number
          id: string
          measured_value: number
          reason: string | null
          recipient_id: string | null
          recount_session_id: string | null
          source_session_id: string
          status: string
          threshold_type: string
          threshold_value: number
        }
        Insert: {
          absolute_unit_deviation?: number
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          company_id?: string
          counted_items?: number
          created_at?: string
          divergent_items?: number
          id?: string
          measured_value: number
          reason?: string | null
          recipient_id?: string | null
          recount_session_id?: string | null
          source_session_id: string
          status: string
          threshold_type: string
          threshold_value: number
        }
        Update: {
          absolute_unit_deviation?: number
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          company_id?: string
          counted_items?: number
          created_at?: string
          divergent_items?: number
          id?: string
          measured_value?: number
          reason?: string | null
          recipient_id?: string | null
          recount_session_id?: string | null
          source_session_id?: string
          status?: string
          threshold_type?: string
          threshold_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "physical_count_recount_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_recount_events_recount_session_id_fkey"
            columns: ["recount_session_id"]
            isOneToOne: false
            referencedRelation: "physical_count_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_recount_events_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "physical_count_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_count_recount_settings: {
        Row: {
          company_id: string
          created_at: string
          enabled: boolean
          notify_user_id: string | null
          threshold_type: string
          threshold_value: number
          updated_at: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          enabled?: boolean
          notify_user_id?: string | null
          threshold_type?: string
          threshold_value?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          enabled?: boolean
          notify_user_id?: string | null
          threshold_type?: string
          threshold_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "physical_count_recount_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_count_sessions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          area: string | null
          company_id: string
          count_number: number
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          finished_at: string | null
          finished_by: string | null
          id: string
          linked_session_id: string | null
          observation: string | null
          responsible_id: string | null
          root_session_id: string | null
          started_at: string | null
          started_by: string | null
          status: string
          street_from: string
          street_to: string
          total_items: number
          updated_at: string | null
          warehouse: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          area?: string | null
          company_id?: string
          count_number?: number
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          finished_at?: string | null
          finished_by?: string | null
          id?: string
          linked_session_id?: string | null
          observation?: string | null
          responsible_id?: string | null
          root_session_id?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          street_from: string
          street_to: string
          total_items?: number
          updated_at?: string | null
          warehouse?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          area?: string | null
          company_id?: string
          count_number?: number
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          finished_at?: string | null
          finished_by?: string | null
          id?: string
          linked_session_id?: string | null
          observation?: string | null
          responsible_id?: string | null
          root_session_id?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          street_from?: string
          street_to?: string
          total_items?: number
          updated_at?: string | null
          warehouse?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "physical_count_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_sessions_linked_session_id_fkey"
            columns: ["linked_session_id"]
            isOneToOne: false
            referencedRelation: "physical_count_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_sessions_root_session_id_fkey"
            columns: ["root_session_id"]
            isOneToOne: false
            referencedRelation: "physical_count_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      picking_allocations: {
        Row: {
          bin_id: string
          boxes: number
          boxes_separadas: number
          company_id: string
          created_at: string
          id: string
          item_id: string
          movement_id: string | null
          reservation_id: string | null
          sequencia: number
          status: string
          updated_at: string
          wave_id: string
        }
        Insert: {
          bin_id: string
          boxes: number
          boxes_separadas?: number
          company_id?: string
          created_at?: string
          id?: string
          item_id: string
          movement_id?: string | null
          reservation_id?: string | null
          sequencia?: number
          status?: string
          updated_at?: string
          wave_id: string
        }
        Update: {
          bin_id?: string
          boxes?: number
          boxes_separadas?: number
          company_id?: string
          created_at?: string
          id?: string
          item_id?: string
          movement_id?: string | null
          reservation_id?: string | null
          sequencia?: number
          status?: string
          updated_at?: string
          wave_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "picking_allocations_bin_id_fkey"
            columns: ["bin_id"]
            isOneToOne: false
            referencedRelation: "warehouse_storage_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_allocations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "picking_wave_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_allocations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "picking_wave_route_v"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "picking_allocations_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "warehouse_bin_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_allocations_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "warehouse_stock_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_allocations_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "picking_waves"
            referencedColumns: ["id"]
          },
        ]
      }
      picking_scan_events: {
        Row: {
          allocation_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          outcome: string
          qty: number | null
          resolved_product_id: string | null
          scanned_bin: string | null
          scanned_code: string | null
          source: string
          wave_id: string
        }
        Insert: {
          allocation_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          outcome: string
          qty?: number | null
          resolved_product_id?: string | null
          scanned_bin?: string | null
          scanned_code?: string | null
          source: string
          wave_id: string
        }
        Update: {
          allocation_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          outcome?: string
          qty?: number | null
          resolved_product_id?: string | null
          scanned_bin?: string | null
          scanned_code?: string | null
          source?: string
          wave_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "picking_scan_events_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "picking_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_scan_events_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "picking_wave_route_v"
            referencedColumns: ["allocation_id"]
          },
          {
            foreignKeyName: "picking_scan_events_resolved_product_id_fkey"
            columns: ["resolved_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_scan_events_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "picking_waves"
            referencedColumns: ["id"]
          },
        ]
      }
      picking_wave_items: {
        Row: {
          boxes_alocadas: number
          boxes_demandadas: number
          boxes_separadas: number
          company_id: string
          created_at: string
          id: string
          product_id: string
          sku: string
          status: string
          updated_at: string
          wave_id: string
        }
        Insert: {
          boxes_alocadas?: number
          boxes_demandadas: number
          boxes_separadas?: number
          company_id?: string
          created_at?: string
          id?: string
          product_id: string
          sku: string
          status?: string
          updated_at?: string
          wave_id: string
        }
        Update: {
          boxes_alocadas?: number
          boxes_demandadas?: number
          boxes_separadas?: number
          company_id?: string
          created_at?: string
          id?: string
          product_id?: string
          sku?: string
          status?: string
          updated_at?: string
          wave_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "picking_wave_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_wave_items_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "picking_waves"
            referencedColumns: ["id"]
          },
        ]
      }
      picking_waves: {
        Row: {
          assigned_to: string | null
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          finished_at: string | null
          id: string
          notes: string | null
          origin: string
          origin_ref: string | null
          reserved_at: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          code: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          notes?: string | null
          origin?: string
          origin_ref?: string | null
          reserved_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          notes?: string | null
          origin?: string
          origin_ref?: string | null
          reserved_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pilar_checklist_progress: {
        Row: {
          checked: boolean
          company_id: string
          id: string
          item_key: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          checked?: boolean
          company_id?: string
          id?: string
          item_key: string
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          checked?: boolean
          company_id?: string
          id?: string
          item_key?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      po_allocations: {
        Row: {
          allocated_quantity: number
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          match_method: string
          nfe_item_id: string
          po_item_id: string
          po_link_id: string
          source: string
          updated_at: string
        }
        Insert: {
          allocated_quantity: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          match_method: string
          nfe_item_id: string
          po_item_id: string
          po_link_id: string
          source?: string
          updated_at?: string
        }
        Update: {
          allocated_quantity?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          match_method?: string
          nfe_item_id?: string
          po_item_id?: string
          po_link_id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_allocations_nfe_item_id_fkey"
            columns: ["nfe_item_id"]
            isOneToOne: false
            referencedRelation: "nfe_invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_allocations_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_allocations_po_link_id_fkey"
            columns: ["po_link_id"]
            isOneToOne: false
            referencedRelation: "po_nfe_links"
            referencedColumns: ["id"]
          },
        ]
      }
      po_deto_para: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          match_type: string
          match_value: string
          origin: string
          product_id: string
          supplier_key: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          match_type: string
          match_value: string
          origin: string
          product_id: string
          supplier_key: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          match_type?: string
          match_value?: string
          origin?: string
          product_id?: string
          supplier_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_deto_para_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_deto_para_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      po_import_batches: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          error_message: string | null
          file_hash: string
          file_name: string
          id: string
          origin: string
          profile_id: string | null
          row_count: number
          status: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          file_hash: string
          file_name: string
          id?: string
          origin: string
          profile_id?: string | null
          row_count?: number
          status?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          file_hash?: string
          file_name?: string
          id?: string
          origin?: string
          profile_id?: string | null
          row_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_import_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_import_batches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "po_import_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      po_import_profiles: {
        Row: {
          column_mapping: Json
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          origin: string
          updated_at: string
        }
        Insert: {
          column_mapping?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          origin: string
          updated_at?: string
        }
        Update: {
          column_mapping?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          origin?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_import_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      po_nfe_links: {
        Row: {
          company_id: string
          id: string
          invoice_id: string
          linked_at: string
          linked_by: string | null
          purchase_order_id: string
          reconciled_at: string | null
          reconciliation_error: string | null
          reconciliation_status: string
          unlink_reason: string | null
          unlinked_at: string | null
          unlinked_by: string | null
        }
        Insert: {
          company_id?: string
          id?: string
          invoice_id: string
          linked_at?: string
          linked_by?: string | null
          purchase_order_id: string
          reconciled_at?: string | null
          reconciliation_error?: string | null
          reconciliation_status?: string
          unlink_reason?: string | null
          unlinked_at?: string | null
          unlinked_by?: string | null
        }
        Update: {
          company_id?: string
          id?: string
          invoice_id?: string
          linked_at?: string
          linked_by?: string | null
          purchase_order_id?: string
          reconciled_at?: string | null
          reconciliation_error?: string | null
          reconciliation_status?: string
          unlink_reason?: string | null
          unlinked_at?: string | null
          unlinked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "po_nfe_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_nfe_links_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "nfe_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_nfe_links_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_abc_xyz_classifications: {
        Row: {
          abc_class: string | null
          abc_xyz_class: string | null
          algorithm_version: string
          classification_date: string
          company_id: string
          created_at: string | null
          demand_coefficient_variation: number | null
          id: string
          period: string
          product_id: string
          quantity_moved: number
          reasons: string[]
          source: string
          unclassified_reason: string | null
          unit_cost_used: number | null
          updated_at: string | null
          value_moved: number
          weeks_with_data: number
          weeks_without_sale: number
          xyz_class: string | null
        }
        Insert: {
          abc_class?: string | null
          abc_xyz_class?: string | null
          algorithm_version?: string
          classification_date?: string
          company_id?: string
          created_at?: string | null
          demand_coefficient_variation?: number | null
          id?: string
          period?: string
          product_id: string
          quantity_moved?: number
          reasons?: string[]
          source?: string
          unclassified_reason?: string | null
          unit_cost_used?: number | null
          updated_at?: string | null
          value_moved?: number
          weeks_with_data?: number
          weeks_without_sale?: number
          xyz_class?: string | null
        }
        Update: {
          abc_class?: string | null
          abc_xyz_class?: string | null
          algorithm_version?: string
          classification_date?: string
          company_id?: string
          created_at?: string | null
          demand_coefficient_variation?: number | null
          id?: string
          period?: string
          product_id?: string
          quantity_moved?: number
          reasons?: string[]
          source?: string
          unclassified_reason?: string | null
          unit_cost_used?: number | null
          updated_at?: string | null
          value_moved?: number
          weeks_with_data?: number
          weeks_without_sale?: number
          xyz_class?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_abc_xyz_classifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_abc_xyz_history: {
        Row: {
          abc_xyz_class: string
          company_id: string
          id: string
          period: string
          product_id: string
          recorded_at: string | null
          value_moved: number
        }
        Insert: {
          abc_xyz_class: string
          company_id?: string
          id?: string
          period?: string
          product_id: string
          recorded_at?: string | null
          value_moved?: number
        }
        Update: {
          abc_xyz_class?: string
          company_id?: string
          id?: string
          period?: string
          product_id?: string
          recorded_at?: string | null
          value_moved?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_abc_xyz_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_brand_associations: {
        Row: {
          brand_id: string | null
          candidate_matches: Json
          company_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          line_id: string | null
          match_status: string
          matched_keyword: string | null
          product_id: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          candidate_matches?: Json
          company_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          line_id?: string | null
          match_status?: string
          matched_keyword?: string | null
          product_id: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          candidate_matches?: Json
          company_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          line_id?: string | null
          match_status?: string
          matched_keyword?: string | null
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_brand_associations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_brand_associations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_brand_associations_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "academy_team_summary_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_brand_associations_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_brand_associations_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "user_productivity_stats_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_brand_associations_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "product_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_brand_associations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_brands: {
        Row: {
          active: boolean
          additional_responsible_ids: string[]
          code: string | null
          company_id: string
          created_at: string
          id: string
          keywords: string[]
          logo_path: string | null
          name: string
          primary_responsible_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          additional_responsible_ids?: string[]
          code?: string | null
          company_id?: string
          created_at?: string
          id?: string
          keywords?: string[]
          logo_path?: string | null
          name: string
          primary_responsible_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          additional_responsible_ids?: string[]
          code?: string | null
          company_id?: string
          created_at?: string
          id?: string
          keywords?: string[]
          logo_path?: string | null
          name?: string
          primary_responsible_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_brands_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_brands_primary_responsible_id_fkey"
            columns: ["primary_responsible_id"]
            isOneToOne: false
            referencedRelation: "academy_team_summary_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_brands_primary_responsible_id_fkey"
            columns: ["primary_responsible_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_brands_primary_responsible_id_fkey"
            columns: ["primary_responsible_id"]
            isOneToOne: false
            referencedRelation: "user_productivity_stats_v"
            referencedColumns: ["user_id"]
          },
        ]
      }
      product_confidence_history: {
        Row: {
          company_id: string
          confidence_score: number
          id: string
          product_id: string
          recorded_at: string | null
          risk_level: string
        }
        Insert: {
          company_id?: string
          confidence_score: number
          id?: string
          product_id: string
          recorded_at?: string | null
          risk_level: string
        }
        Update: {
          company_id?: string
          confidence_score?: number
          id?: string
          product_id?: string
          recorded_at?: string | null
          risk_level?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_confidence_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_confidence_scores: {
        Row: {
          algorithm_version: string
          company_id: string
          confidence_score: number | null
          created_at: string | null
          factors: Json
          has_sufficient_data: boolean
          id: string
          is_manually_scheduled: boolean
          last_algorithm_run: string
          missing_factors: string[]
          next_count_date: string
          priority_score: number | null
          product_id: string
          risk_level: string | null
          scheduled_at: string | null
          scheduled_by: string | null
          top_reasons: string[]
          updated_at: string | null
          why_to_count: string | null
        }
        Insert: {
          algorithm_version?: string
          company_id?: string
          confidence_score?: number | null
          created_at?: string | null
          factors?: Json
          has_sufficient_data?: boolean
          id?: string
          is_manually_scheduled?: boolean
          last_algorithm_run?: string
          missing_factors?: string[]
          next_count_date: string
          priority_score?: number | null
          product_id: string
          risk_level?: string | null
          scheduled_at?: string | null
          scheduled_by?: string | null
          top_reasons?: string[]
          updated_at?: string | null
          why_to_count?: string | null
        }
        Update: {
          algorithm_version?: string
          company_id?: string
          confidence_score?: number | null
          created_at?: string | null
          factors?: Json
          has_sufficient_data?: boolean
          id?: string
          is_manually_scheduled?: boolean
          last_algorithm_run?: string
          missing_factors?: string[]
          next_count_date?: string
          priority_score?: number | null
          product_id?: string
          risk_level?: string | null
          scheduled_at?: string | null
          scheduled_by?: string | null
          top_reasons?: string[]
          updated_at?: string | null
          why_to_count?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_confidence_scores_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_criticality_overrides: {
        Row: {
          company_id: string
          criticality_level: string
          id: string
          product_id: string
          set_by: string | null
          updated_at: string | null
        }
        Insert: {
          company_id?: string
          criticality_level?: string
          id?: string
          product_id: string
          set_by?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          criticality_level?: string
          id?: string
          product_id?: string
          set_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_criticality_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_lines: {
        Row: {
          active: boolean
          additional_responsible_ids: string[]
          brand_id: string
          company_id: string
          created_at: string
          exclude_keywords: string[]
          id: string
          inventory_brand_names: string[]
          keywords: string[]
          match_priority: number
          name: string
          primary_responsible_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          additional_responsible_ids?: string[]
          brand_id: string
          company_id?: string
          created_at?: string
          exclude_keywords?: string[]
          id?: string
          inventory_brand_names?: string[]
          keywords?: string[]
          match_priority?: number
          name: string
          primary_responsible_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          additional_responsible_ids?: string[]
          brand_id?: string
          company_id?: string
          created_at?: string
          exclude_keywords?: string[]
          id?: string
          inventory_brand_names?: string[]
          keywords?: string[]
          match_priority?: number
          name?: string
          primary_responsible_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_lines_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_lines_primary_responsible_id_fkey"
            columns: ["primary_responsible_id"]
            isOneToOne: false
            referencedRelation: "academy_team_summary_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_lines_primary_responsible_id_fkey"
            columns: ["primary_responsible_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_lines_primary_responsible_id_fkey"
            columns: ["primary_responsible_id"]
            isOneToOne: false
            referencedRelation: "user_productivity_stats_v"
            referencedColumns: ["user_id"]
          },
        ]
      }
      product_risk_history: {
        Row: {
          company_id: string
          id: string
          product_id: string
          recorded_at: string | null
          risk_level: string
          risk_score: number
        }
        Insert: {
          company_id?: string
          id?: string
          product_id: string
          recorded_at?: string | null
          risk_level: string
          risk_score: number
        }
        Update: {
          company_id?: string
          id?: string
          product_id?: string
          recorded_at?: string | null
          risk_level?: string
          risk_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_risk_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_risk_scores: {
        Row: {
          algorithm_version: string
          company_id: string
          created_at: string | null
          factors: Json
          has_sufficient_data: boolean
          id: string
          impact: number | null
          last_risk_update: string
          missing_factors: string[]
          probability: number | null
          product_id: string
          risk_level: string | null
          risk_reason: string
          risk_score: number | null
          updated_at: string | null
        }
        Insert: {
          algorithm_version?: string
          company_id?: string
          created_at?: string | null
          factors?: Json
          has_sufficient_data?: boolean
          id?: string
          impact?: number | null
          last_risk_update?: string
          missing_factors?: string[]
          probability?: number | null
          product_id: string
          risk_level?: string | null
          risk_reason?: string
          risk_score?: number | null
          updated_at?: string | null
        }
        Update: {
          algorithm_version?: string
          company_id?: string
          created_at?: string | null
          factors?: Json
          has_sufficient_data?: boolean
          id?: string
          impact?: number | null
          last_risk_update?: string
          missing_factors?: string[]
          probability?: number | null
          product_id?: string
          risk_level?: string | null
          risk_reason?: string
          risk_score?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_risk_scores_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          company_id: string
          created_at: string | null
          ean: string | null
          frozen_at: string | null
          frozen_by: string | null
          frozen_reason: string | null
          id: string
          location: string | null
          name: string
          price: number | null
          sku: string
          stock_quantity: number
          updated_at: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          ean?: string | null
          frozen_at?: string | null
          frozen_by?: string | null
          frozen_reason?: string | null
          id?: string
          location?: string | null
          name: string
          price?: number | null
          sku: string
          stock_quantity?: number
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          ean?: string | null
          frozen_at?: string | null
          frozen_by?: string | null
          frozen_reason?: string | null
          id?: string
          location?: string | null
          name?: string
          price?: number | null
          sku?: string
          stock_quantity?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          company_id: string | null
          created_at: string | null
          email: string | null
          id: string
          must_change_password: boolean
          name: string | null
          role: string
          updated_at: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          must_change_password?: boolean
          name?: string | null
          role?: string
          updated_at?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          must_change_password?: boolean
          name?: string | null
          role?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          company_id: string
          created_at: string
          description: string
          ean: string | null
          ean_normalized: string | null
          id: string
          line_number: number
          origin_code: string | null
          product_id: string | null
          purchase_order_id: string
          quantity: number
          total_value: number | null
          unit: string | null
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          description?: string
          ean?: string | null
          ean_normalized?: string | null
          id?: string
          line_number?: number
          origin_code?: string | null
          product_id?: string | null
          purchase_order_id: string
          quantity?: number
          total_value?: number | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string
          ean?: string | null
          ean_normalized?: string | null
          id?: string
          line_number?: number
          origin_code?: string | null
          product_id?: string | null
          purchase_order_id?: string
          quantity?: number
          total_value?: number | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          attachment_name: string | null
          attachment_path: string | null
          closed_at: string | null
          closed_by: string | null
          closed_reason: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          import_batch_id: string | null
          issue_date: string | null
          notes: string | null
          origin: string
          po_number: string
          status: string
          supplier_cnpj: string | null
          supplier_name: string
          updated_at: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_path?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_reason?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          import_batch_id?: string | null
          issue_date?: string | null
          notes?: string | null
          origin?: string
          po_number: string
          status?: string
          supplier_cnpj?: string | null
          supplier_name: string
          updated_at?: string
        }
        Update: {
          attachment_name?: string | null
          attachment_path?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_reason?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          import_batch_id?: string | null
          issue_date?: string | null
          notes?: string | null
          origin?: string
          po_number?: string
          status?: string
          supplier_cnpj?: string | null
          supplier_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_import_batch_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "po_import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      rca_case_actions: {
        Row: {
          action_type: string
          case_id: string
          company_id: string
          created_at: string | null
          created_by: string | null
          effectiveness_criteria: string | null
          expected_result: string | null
          id: string
          observation_window_days: number | null
          observed_result: string | null
          task_id: string | null
          verification_result: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          action_type: string
          case_id: string
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          effectiveness_criteria?: string | null
          expected_result?: string | null
          id?: string
          observation_window_days?: number | null
          observed_result?: string | null
          task_id?: string | null
          verification_result?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          action_type?: string
          case_id?: string
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          effectiveness_criteria?: string | null
          expected_result?: string | null
          id?: string
          observation_window_days?: number | null
          observed_result?: string | null
          task_id?: string | null
          verification_result?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rca_case_actions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "rca_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rca_case_actions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      rca_case_counters: {
        Row: {
          case_year: number
          company_id: string
          last_number: number
        }
        Insert: {
          case_year: number
          company_id?: string
          last_number?: number
        }
        Update: {
          case_year?: number
          company_id?: string
          last_number?: number
        }
        Relationships: []
      }
      rca_case_divergence_links: {
        Row: {
          case_id: string
          company_id: string
          id: string
          linked_at: string | null
          linked_by: string | null
          rca_record_id: string
        }
        Insert: {
          case_id: string
          company_id?: string
          id?: string
          linked_at?: string | null
          linked_by?: string | null
          rca_record_id: string
        }
        Update: {
          case_id?: string
          company_id?: string
          id?: string
          linked_at?: string | null
          linked_by?: string | null
          rca_record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rca_case_divergence_links_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "rca_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rca_case_divergence_links_rca_record_id_fkey"
            columns: ["rca_record_id"]
            isOneToOne: false
            referencedRelation: "rca_records"
            referencedColumns: ["id"]
          },
        ]
      }
      rca_case_why_steps: {
        Row: {
          answer: string
          author_email: string | null
          author_id: string | null
          case_id: string
          company_id: string
          created_at: string | null
          id: string
          order_index: number
          parent_step_id: string | null
          question: string
          role: string
          updated_at: string | null
        }
        Insert: {
          answer: string
          author_email?: string | null
          author_id?: string | null
          case_id: string
          company_id?: string
          created_at?: string | null
          id?: string
          order_index: number
          parent_step_id?: string | null
          question?: string
          role?: string
          updated_at?: string | null
        }
        Update: {
          answer?: string
          author_email?: string | null
          author_id?: string | null
          case_id?: string
          company_id?: string
          created_at?: string | null
          id?: string
          order_index?: number
          parent_step_id?: string | null
          question?: string
          role?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rca_case_why_steps_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "rca_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rca_case_why_steps_parent_step_id_fkey"
            columns: ["parent_step_id"]
            isOneToOne: false
            referencedRelation: "rca_case_why_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      rca_cases: {
        Row: {
          case_number: number
          case_year: number
          cause_category: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_by: string
          due_at: string | null
          escalation_reasons: string[]
          financial_impact: number | null
          id: string
          opened_at: string | null
          owner_id: string | null
          problem_expected_pattern: string | null
          problem_impact_qty: number | null
          problem_observed_result: string | null
          problem_what: string
          problem_when: string | null
          problem_where: string | null
          process_area: string
          root_cause_confirmed_at: string | null
          root_cause_confirmed_by: string | null
          root_cause_justification: string | null
          root_cause_status: string | null
          root_cause_text: string | null
          severity: string
          status: string
          subcause_code: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          case_number: number
          case_year: number
          cause_category?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          created_by: string
          due_at?: string | null
          escalation_reasons?: string[]
          financial_impact?: number | null
          id?: string
          opened_at?: string | null
          owner_id?: string | null
          problem_expected_pattern?: string | null
          problem_impact_qty?: number | null
          problem_observed_result?: string | null
          problem_what: string
          problem_when?: string | null
          problem_where?: string | null
          process_area: string
          root_cause_confirmed_at?: string | null
          root_cause_confirmed_by?: string | null
          root_cause_justification?: string | null
          root_cause_status?: string | null
          root_cause_text?: string | null
          severity: string
          status?: string
          subcause_code?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          case_number?: number
          case_year?: number
          cause_category?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          created_by?: string
          due_at?: string | null
          escalation_reasons?: string[]
          financial_impact?: number | null
          id?: string
          opened_at?: string | null
          owner_id?: string | null
          problem_expected_pattern?: string | null
          problem_impact_qty?: number | null
          problem_observed_result?: string | null
          problem_what?: string
          problem_when?: string | null
          problem_where?: string | null
          process_area?: string
          root_cause_confirmed_at?: string | null
          root_cause_confirmed_by?: string | null
          root_cause_justification?: string | null
          root_cause_status?: string | null
          root_cause_text?: string | null
          severity?: string
          status?: string
          subcause_code?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      rca_cause_categories: {
        Row: {
          code: string
          company_id: string
          created_at: string | null
          id: string
          is_active: boolean
          is_default: boolean
          label: string
        }
        Insert: {
          code: string
          company_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          label: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          label?: string
        }
        Relationships: []
      }
      rca_cause_subcauses: {
        Row: {
          category_code: string
          code: string
          company_id: string
          created_at: string | null
          id: string
          is_active: boolean
          is_default: boolean
          label: string
        }
        Insert: {
          category_code: string
          code: string
          company_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          label: string
        }
        Update: {
          category_code?: string
          code?: string
          company_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          label?: string
        }
        Relationships: []
      }
      rca_evidence: {
        Row: {
          company_id: string
          created_at: string | null
          evidence_type: string
          file_name: string | null
          file_path: string | null
          id: string
          note: string | null
          rca_case_id: string | null
          rca_record_id: string | null
          source_record_id: string | null
          source_table: string | null
          uploaded_by: string | null
          why_step_id: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          evidence_type?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          note?: string | null
          rca_case_id?: string | null
          rca_record_id?: string | null
          source_record_id?: string | null
          source_table?: string | null
          uploaded_by?: string | null
          why_step_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          evidence_type?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          note?: string | null
          rca_case_id?: string | null
          rca_record_id?: string | null
          source_record_id?: string | null
          source_table?: string | null
          uploaded_by?: string | null
          why_step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rca_evidence_rca_case_id_fkey"
            columns: ["rca_case_id"]
            isOneToOne: false
            referencedRelation: "rca_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rca_evidence_rca_record_id_fkey"
            columns: ["rca_record_id"]
            isOneToOne: false
            referencedRelation: "rca_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rca_evidence_why_step_id_fkey"
            columns: ["why_step_id"]
            isOneToOne: false
            referencedRelation: "rca_case_why_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      rca_five_whys_answers: {
        Row: {
          answer: string
          answered_by: string | null
          answered_by_email: string | null
          company_id: string
          created_at: string | null
          id: string
          level: number
          question: string
          session_id: string
        }
        Insert: {
          answer: string
          answered_by?: string | null
          answered_by_email?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          level: number
          question?: string
          session_id: string
        }
        Update: {
          answer?: string
          answered_by?: string | null
          answered_by_email?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          level?: number
          question?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rca_five_whys_answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "rca_five_whys_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      rca_five_whys_sessions: {
        Row: {
          company_id: string
          completed_at: string | null
          completed_by: string | null
          id: string
          occurrence_count: number
          opened_at: string | null
          root_cause_summary: string | null
          status: string
          trigger_key: string
          trigger_rca_record_id: string | null
          trigger_type: string
          window_days: number
        }
        Insert: {
          company_id?: string
          completed_at?: string | null
          completed_by?: string | null
          id?: string
          occurrence_count?: number
          opened_at?: string | null
          root_cause_summary?: string | null
          status?: string
          trigger_key: string
          trigger_rca_record_id?: string | null
          trigger_type: string
          window_days?: number
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          completed_by?: string | null
          id?: string
          occurrence_count?: number
          opened_at?: string | null
          root_cause_summary?: string | null
          status?: string
          trigger_key?: string
          trigger_rca_record_id?: string | null
          trigger_type?: string
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "rca_five_whys_sessions_trigger_rca_record_id_fkey"
            columns: ["trigger_rca_record_id"]
            isOneToOne: false
            referencedRelation: "rca_records"
            referencedColumns: ["id"]
          },
        ]
      }
      rca_records: {
        Row: {
          cause_category: string | null
          classification_status: string
          classified_by: string | null
          classified_by_email: string | null
          company_id: string
          containment_needed: boolean
          created_at: string | null
          custom_cause_label: string | null
          divergence_qty: number
          financial_impact: number | null
          id: string
          known_recurrence: boolean
          location: string | null
          manual_escalation: boolean
          notes: string | null
          occurred_at: string
          operator_name: string | null
          operator_user_id: string | null
          process_area: string | null
          product_id: string | null
          product_name: string | null
          rca_case_id: string | null
          severity: string
          sku: string | null
          source_item_id: string
          source_module: string
          subcause_code: string | null
          supplier_cnpj: string | null
          supplier_name: string | null
        }
        Insert: {
          cause_category?: string | null
          classification_status?: string
          classified_by?: string | null
          classified_by_email?: string | null
          company_id?: string
          containment_needed?: boolean
          created_at?: string | null
          custom_cause_label?: string | null
          divergence_qty?: number
          financial_impact?: number | null
          id?: string
          known_recurrence?: boolean
          location?: string | null
          manual_escalation?: boolean
          notes?: string | null
          occurred_at?: string
          operator_name?: string | null
          operator_user_id?: string | null
          process_area?: string | null
          product_id?: string | null
          product_name?: string | null
          rca_case_id?: string | null
          severity?: string
          sku?: string | null
          source_item_id: string
          source_module: string
          subcause_code?: string | null
          supplier_cnpj?: string | null
          supplier_name?: string | null
        }
        Update: {
          cause_category?: string | null
          classification_status?: string
          classified_by?: string | null
          classified_by_email?: string | null
          company_id?: string
          containment_needed?: boolean
          created_at?: string | null
          custom_cause_label?: string | null
          divergence_qty?: number
          financial_impact?: number | null
          id?: string
          known_recurrence?: boolean
          location?: string | null
          manual_escalation?: boolean
          notes?: string | null
          occurred_at?: string
          operator_name?: string | null
          operator_user_id?: string | null
          process_area?: string | null
          product_id?: string | null
          product_name?: string | null
          rca_case_id?: string | null
          severity?: string
          sku?: string | null
          source_item_id?: string
          source_module?: string
          subcause_code?: string | null
          supplier_cnpj?: string | null
          supplier_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rca_records_case_fk"
            columns: ["rca_case_id"]
            isOneToOne: false
            referencedRelation: "rca_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rca_records_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      rca_settings: {
        Row: {
          company_id: string
          financial_impact_threshold: number | null
          recurrence_threshold_count: number
          recurrence_window_days: number
          updated_at: string | null
        }
        Insert: {
          company_id?: string
          financial_impact_threshold?: number | null
          recurrence_threshold_count?: number
          recurrence_window_days?: number
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          financial_impact_threshold?: number | null
          recurrence_threshold_count?: number
          recurrence_window_days?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      return_approval_requests: {
        Row: {
          approval_type: string
          company_id: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          id: string
          notes: string | null
          requested_at: string
          requested_by: string | null
          return_item_id: string
          status: string
        }
        Insert: {
          approval_type: string
          company_id?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          notes?: string | null
          requested_at?: string
          requested_by?: string | null
          return_item_id: string
          status?: string
        }
        Update: {
          approval_type?: string
          company_id?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          notes?: string | null
          requested_at?: string
          requested_by?: string | null
          return_item_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_approval_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_approval_requests_return_item_id_fkey"
            columns: ["return_item_id"]
            isOneToOne: false
            referencedRelation: "return_items"
            referencedColumns: ["id"]
          },
        ]
      }
      return_approval_settings: {
        Row: {
          company_id: string
          high_value_threshold: number | null
          require_approval_checklist_exception: boolean
          require_approval_destination_change: boolean
          require_approval_discard: boolean
          require_approval_high_value: boolean
          require_approval_restock: boolean
          require_approval_serial_mismatch: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          high_value_threshold?: number | null
          require_approval_checklist_exception?: boolean
          require_approval_destination_change?: boolean
          require_approval_discard?: boolean
          require_approval_high_value?: boolean
          require_approval_restock?: boolean
          require_approval_serial_mismatch?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          high_value_threshold?: number | null
          require_approval_checklist_exception?: boolean
          require_approval_destination_change?: boolean
          require_approval_discard?: boolean
          require_approval_high_value?: boolean
          require_approval_restock?: boolean
          require_approval_serial_mismatch?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_approval_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      return_attachments: {
        Row: {
          company_id: string
          created_at: string
          file_name: string
          file_path: string
          id: string
          return_id: string
          return_item_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          return_id: string
          return_item_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          return_id?: string
          return_item_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_attachments_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_attachments_return_item_id_fkey"
            columns: ["return_item_id"]
            isOneToOne: false
            referencedRelation: "return_items"
            referencedColumns: ["id"]
          },
        ]
      }
      return_checklist_template_items: {
        Row: {
          company_id: string
          created_at: string
          id: string
          label: string
          options: Json | null
          order_index: number
          required: boolean
          response_type: string
          template_id: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          id?: string
          label: string
          options?: Json | null
          order_index?: number
          required?: boolean
          response_type: string
          template_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          label?: string
          options?: Json | null
          order_index?: number
          required?: boolean
          response_type?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_checklist_template_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_checklist_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "return_checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      return_checklist_templates: {
        Row: {
          active: boolean
          category: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          inspection_type: string | null
          max_value: number | null
          min_value: number | null
          name: string
          product_id: string | null
          reason: string | null
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          category?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          inspection_type?: string | null
          max_value?: number | null
          min_value?: number | null
          name: string
          product_id?: string | null
          reason?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          category?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          inspection_type?: string | null
          max_value?: number | null
          min_value?: number | null
          name?: string
          product_id?: string | null
          reason?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "return_checklist_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_checklist_templates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      return_condition_grades: {
        Row: {
          active: boolean
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          criteria: string[] | null
          description: string | null
          id: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          criteria?: string[] | null
          description?: string | null
          id?: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          criteria?: string[] | null
          description?: string | null
          id?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_condition_grades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      return_destination_rules: {
        Row: {
          active: boolean
          category: string | null
          company_id: string
          condition_grade_id: string | null
          created_at: string
          created_by: string | null
          defect_reported: string | null
          id: string
          max_value: number | null
          min_value: number | null
          priority: number
          reason: string | null
          requires_accessories: boolean | null
          requires_warranty: boolean | null
          suggested_destination: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          company_id?: string
          condition_grade_id?: string | null
          created_at?: string
          created_by?: string | null
          defect_reported?: string | null
          id?: string
          max_value?: number | null
          min_value?: number | null
          priority?: number
          reason?: string | null
          requires_accessories?: boolean | null
          requires_warranty?: boolean | null
          suggested_destination: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          company_id?: string
          condition_grade_id?: string | null
          created_at?: string
          created_by?: string | null
          defect_reported?: string | null
          id?: string
          max_value?: number | null
          min_value?: number | null
          priority?: number
          reason?: string | null
          requires_accessories?: boolean | null
          requires_warranty?: boolean | null
          suggested_destination?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_destination_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_destination_rules_condition_grade_id_fkey"
            columns: ["condition_grade_id"]
            isOneToOne: false
            referencedRelation: "return_condition_grades"
            referencedColumns: ["id"]
          },
        ]
      }
      return_item_checklist_responses: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          photo_path: string | null
          return_item_id: string
          template_item_id: string
          value_boolean: boolean | null
          value_number: number | null
          value_select: string | null
          value_text: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          photo_path?: string | null
          return_item_id: string
          template_item_id: string
          value_boolean?: boolean | null
          value_number?: number | null
          value_select?: string | null
          value_text?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          photo_path?: string | null
          return_item_id?: string
          template_item_id?: string
          value_boolean?: boolean | null
          value_number?: number | null
          value_select?: string | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_item_checklist_responses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_item_checklist_responses_return_item_id_fkey"
            columns: ["return_item_id"]
            isOneToOne: false
            referencedRelation: "return_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_item_checklist_responses_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "return_checklist_template_items"
            referencedColumns: ["id"]
          },
        ]
      }
      return_items: {
        Row: {
          accessories_received: string | null
          checklist_accessories_complete: boolean | null
          checklist_apparently_functional: boolean | null
          checklist_correct_product: boolean | null
          checklist_no_visible_damage: boolean | null
          checklist_packaging_intact: boolean | null
          checklist_serial_matches: boolean | null
          checklist_signs_of_use: boolean | null
          checklist_template_id: string | null
          checklist_template_version: number | null
          classification: string | null
          company_id: string
          condition_grade_id: string | null
          created_at: string
          current_location: string
          description: string
          destination: string | null
          destination_decided_at: string | null
          destination_decided_by: string | null
          destination_reason: string | null
          destination_status: string
          ean: string | null
          erp_sync_adjustment_id: string | null
          expected_quantity: number | null
          id: string
          inspected_at: string | null
          inspected_by: string | null
          item_notes: string | null
          line_number: number
          lot_number: string | null
          original_packaging: boolean | null
          product_id: string | null
          received_quantity: number
          return_id: string
          serial_number: string | null
          sku: string | null
          suggested_destination: string | null
          suggested_destination_rule_id: string | null
          updated_at: string
        }
        Insert: {
          accessories_received?: string | null
          checklist_accessories_complete?: boolean | null
          checklist_apparently_functional?: boolean | null
          checklist_correct_product?: boolean | null
          checklist_no_visible_damage?: boolean | null
          checklist_packaging_intact?: boolean | null
          checklist_serial_matches?: boolean | null
          checklist_signs_of_use?: boolean | null
          checklist_template_id?: string | null
          checklist_template_version?: number | null
          classification?: string | null
          company_id?: string
          condition_grade_id?: string | null
          created_at?: string
          current_location?: string
          description?: string
          destination?: string | null
          destination_decided_at?: string | null
          destination_decided_by?: string | null
          destination_reason?: string | null
          destination_status?: string
          ean?: string | null
          erp_sync_adjustment_id?: string | null
          expected_quantity?: number | null
          id?: string
          inspected_at?: string | null
          inspected_by?: string | null
          item_notes?: string | null
          line_number?: number
          lot_number?: string | null
          original_packaging?: boolean | null
          product_id?: string | null
          received_quantity?: number
          return_id: string
          serial_number?: string | null
          sku?: string | null
          suggested_destination?: string | null
          suggested_destination_rule_id?: string | null
          updated_at?: string
        }
        Update: {
          accessories_received?: string | null
          checklist_accessories_complete?: boolean | null
          checklist_apparently_functional?: boolean | null
          checklist_correct_product?: boolean | null
          checklist_no_visible_damage?: boolean | null
          checklist_packaging_intact?: boolean | null
          checklist_serial_matches?: boolean | null
          checklist_signs_of_use?: boolean | null
          checklist_template_id?: string | null
          checklist_template_version?: number | null
          classification?: string | null
          company_id?: string
          condition_grade_id?: string | null
          created_at?: string
          current_location?: string
          description?: string
          destination?: string | null
          destination_decided_at?: string | null
          destination_decided_by?: string | null
          destination_reason?: string | null
          destination_status?: string
          ean?: string | null
          erp_sync_adjustment_id?: string | null
          expected_quantity?: number | null
          id?: string
          inspected_at?: string | null
          inspected_by?: string | null
          item_notes?: string | null
          line_number?: number
          lot_number?: string | null
          original_packaging?: boolean | null
          product_id?: string | null
          received_quantity?: number
          return_id?: string
          serial_number?: string | null
          sku?: string | null
          suggested_destination?: string | null
          suggested_destination_rule_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_items_checklist_template_id_fkey"
            columns: ["checklist_template_id"]
            isOneToOne: false
            referencedRelation: "return_checklist_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_condition_grade_fk"
            columns: ["condition_grade_id"]
            isOneToOne: false
            referencedRelation: "return_condition_grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_erp_sync_adjustment_id_fkey"
            columns: ["erp_sync_adjustment_id"]
            isOneToOne: false
            referencedRelation: "integration_stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_suggested_destination_rule_fk"
            columns: ["suggested_destination_rule_id"]
            isOneToOne: false
            referencedRelation: "return_destination_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      return_quarantine_holds: {
        Row: {
          block_reason: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          location: string | null
          pending_notes: string | null
          released_at: string | null
          released_by: string | null
          released_reason: string | null
          responsible: string | null
          return_item_id: string
          review_deadline: string | null
        }
        Insert: {
          block_reason: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          pending_notes?: string | null
          released_at?: string | null
          released_by?: string | null
          released_reason?: string | null
          responsible?: string | null
          return_item_id: string
          review_deadline?: string | null
        }
        Update: {
          block_reason?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          pending_notes?: string | null
          released_at?: string | null
          released_by?: string | null
          released_reason?: string | null
          responsible?: string | null
          return_item_id?: string
          review_deadline?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_quarantine_holds_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_quarantine_holds_return_item_id_fkey"
            columns: ["return_item_id"]
            isOneToOne: false
            referencedRelation: "return_items"
            referencedColumns: ["id"]
          },
        ]
      }
      return_service_orders: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          deadline: string | null
          defect_identified: string | null
          estimated_cost: number | null
          external_provider: string | null
          id: string
          location_internal: string | null
          parts_services_expected: string | null
          responsible: string | null
          result_notes: string | null
          return_item_id: string
          service_type: string
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          updated_at: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          defect_identified?: string | null
          estimated_cost?: number | null
          external_provider?: string | null
          id?: string
          location_internal?: string | null
          parts_services_expected?: string | null
          responsible?: string | null
          result_notes?: string | null
          return_item_id: string
          service_type: string
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          defect_identified?: string | null
          estimated_cost?: number | null
          external_provider?: string | null
          id?: string
          location_internal?: string | null
          parts_services_expected?: string | null
          responsible?: string | null
          result_notes?: string | null
          return_item_id?: string
          service_type?: string
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_service_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_service_orders_return_item_id_fkey"
            columns: ["return_item_id"]
            isOneToOne: false
            referencedRelation: "return_items"
            referencedColumns: ["id"]
          },
        ]
      }
      return_stock_movements: {
        Row: {
          company_id: string
          created_at: string
          destination_location: string
          id: string
          is_transitional: boolean
          lot_number: string | null
          movement_type: string
          origin_location: string
          performed_by: string | null
          product_id: string | null
          quantity: number
          reason: string | null
          return_id: string
          return_item_id: string
          serial_number: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string
          destination_location: string
          id?: string
          is_transitional?: boolean
          lot_number?: string | null
          movement_type: string
          origin_location: string
          performed_by?: string | null
          product_id?: string | null
          quantity: number
          reason?: string | null
          return_id: string
          return_item_id: string
          serial_number?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          destination_location?: string
          id?: string
          is_transitional?: boolean
          lot_number?: string | null
          movement_type?: string
          origin_location?: string
          performed_by?: string | null
          product_id?: string | null
          quantity?: number
          reason?: string | null
          return_id?: string
          return_item_id?: string
          serial_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_stock_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_stock_movements_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_stock_movements_return_item_id_fkey"
            columns: ["return_item_id"]
            isOneToOne: false
            referencedRelation: "return_items"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          cancellation_reason: string | null
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          customer_name: string | null
          expected_quantity: number | null
          id: string
          linked_nfe_invoice_id: string | null
          linked_purchase_order_id: string | null
          linked_sale_id: string | null
          notes: string | null
          origin: string | null
          origin_channel_connection_id: string | null
          origin_source: string | null
          reason: string | null
          received_at: string
          received_by: string | null
          reference_value: string | null
          return_nfe_invoice_key: string | null
          return_nfe_raw_xml: string | null
          return_nfe_xml_hash: string | null
          source_type: string
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          unresolved: boolean
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          expected_quantity?: number | null
          id?: string
          linked_nfe_invoice_id?: string | null
          linked_purchase_order_id?: string | null
          linked_sale_id?: string | null
          notes?: string | null
          origin?: string | null
          origin_channel_connection_id?: string | null
          origin_source?: string | null
          reason?: string | null
          received_at?: string
          received_by?: string | null
          reference_value?: string | null
          return_nfe_invoice_key?: string | null
          return_nfe_raw_xml?: string | null
          return_nfe_xml_hash?: string | null
          source_type: string
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          unresolved?: boolean
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          expected_quantity?: number | null
          id?: string
          linked_nfe_invoice_id?: string | null
          linked_purchase_order_id?: string | null
          linked_sale_id?: string | null
          notes?: string | null
          origin?: string | null
          origin_channel_connection_id?: string | null
          origin_source?: string | null
          reason?: string | null
          received_at?: string
          received_by?: string | null
          reference_value?: string | null
          return_nfe_invoice_key?: string | null
          return_nfe_raw_xml?: string | null
          return_nfe_xml_hash?: string | null
          source_type?: string
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          unresolved?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "returns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_linked_nfe_invoice_id_fkey"
            columns: ["linked_nfe_invoice_id"]
            isOneToOne: false
            referencedRelation: "nfe_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_linked_purchase_order_id_fkey"
            columns: ["linked_purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_linked_sale_id_fkey"
            columns: ["linked_sale_id"]
            isOneToOne: false
            referencedRelation: "sales_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_origin_channel_connection_id_fkey"
            columns: ["origin_channel_connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_import_batches: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          error_message: string | null
          file_hash: string
          file_name: string
          id: string
          imported_count: number
          origin: string
          profile_id: string | null
          row_count: number
          status: string
          unmatched_count: number
        }
        Insert: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          file_hash: string
          file_name: string
          id?: string
          imported_count?: number
          origin: string
          profile_id?: string | null
          row_count?: number
          status?: string
          unmatched_count?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          file_hash?: string
          file_name?: string
          id?: string
          imported_count?: number
          origin?: string
          profile_id?: string | null
          row_count?: number
          status?: string
          unmatched_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_import_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "academy_team_summary_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sales_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_productivity_stats_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sales_import_batches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "sales_import_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_import_profiles: {
        Row: {
          column_mapping: Json
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          origin: string
          updated_at: string
        }
        Insert: {
          column_mapping?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          origin: string
          updated_at?: string
        }
        Update: {
          column_mapping?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          origin?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_import_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_import_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "academy_team_summary_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sales_import_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_import_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_productivity_stats_v"
            referencedColumns: ["user_id"]
          },
        ]
      }
      sales_records: {
        Row: {
          batch_id: string
          company_id: string
          created_at: string
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          sale_date: string
          sku: string | null
          total_value: number
          unit_price: number | null
        }
        Insert: {
          batch_id: string
          company_id?: string
          created_at?: string
          id?: string
          product_id?: string | null
          product_name: string
          quantity?: number
          sale_date: string
          sku?: string | null
          total_value?: number
          unit_price?: number | null
        }
        Update: {
          batch_id?: string
          company_id?: string
          created_at?: string
          id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          sale_date?: string
          sku?: string | null
          total_value?: number
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_records_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "sales_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_records_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      security_logs: {
        Row: {
          company_id: string
          created_at: string | null
          description: string | null
          event_type: string
          id: string
          ip_address: string | null
          metadata: Json | null
          severity: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          description?: string | null
          event_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          severity: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          description?: string | null
          event_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          severity?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      support_notifications: {
        Row: {
          audience: string
          created_at: string
          id: string
          kind: string
          message: string
          read_at: string | null
          ticket_id: string | null
          user_id: string
        }
        Insert: {
          audience: string
          created_at?: string
          id?: string
          kind: string
          message: string
          read_at?: string | null
          ticket_id?: string | null
          user_id: string
        }
        Update: {
          audience?: string
          created_at?: string
          id?: string
          kind?: string
          message?: string
          read_at?: string | null
          ticket_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_notifications_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_staff: {
        Row: {
          created_at: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      support_ticket_messages: {
        Row: {
          attachments: string[]
          author_id: string
          body: string
          created_at: string
          id: string
          ticket_id: string
        }
        Insert: {
          attachments?: string[]
          author_id: string
          body: string
          created_at?: string
          id?: string
          ticket_id: string
        }
        Update: {
          attachments?: string[]
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          category: string
          channel: string
          company_id: string
          context: Json
          created_at: string
          created_by: string
          first_response_at: string | null
          id: string
          priority: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          category: string
          channel: string
          company_id: string
          context?: Json
          created_at?: string
          created_by: string
          first_response_at?: string | null
          id?: string
          priority?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          category?: string
          channel?: string
          company_id?: string
          context?: Json
          created_at?: string
          created_by?: string
          first_response_at?: string | null
          id?: string
          priority?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activity_logs: {
        Row: {
          action: string
          company_id: string
          created_at: string
          details: Json
          id: string
          task_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          company_id: string
          created_at?: string
          details?: Json
          id?: string
          task_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string
          details?: Json
          id?: string
          task_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_logs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          archived_at: string | null
          assigned_at: string
          assigned_by: string | null
          block_note: string | null
          block_reason: string | null
          blocked_at: string | null
          blocked_by: string | null
          company_id: string
          completed_at: string | null
          expected_resolver_user_id: string | null
          id: string
          paused_at: string | null
          started_at: string | null
          status: string
          task_id: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          assigned_at?: string
          assigned_by?: string | null
          block_note?: string | null
          block_reason?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          company_id: string
          completed_at?: string | null
          expected_resolver_user_id?: string | null
          id?: string
          paused_at?: string | null
          started_at?: string | null
          status?: string
          task_id: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          assigned_at?: string
          assigned_by?: string | null
          block_note?: string | null
          block_reason?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          company_id?: string
          completed_at?: string | null
          expected_resolver_user_id?: string | null
          id?: string
          paused_at?: string | null
          started_at?: string | null
          status?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          company_id: string
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          storage_path: string
          task_id: string
          uploaded_by: string
        }
        Insert: {
          company_id: string
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path: string
          task_id: string
          uploaded_by: string
        }
        Update: {
          company_id?: string
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          task_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklist_items: {
        Row: {
          company_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          is_done: boolean
          label: string
          position: number
          task_id: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          is_done?: boolean
          label: string
          position?: number
          task_id: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          is_done?: boolean
          label?: string
          position?: number
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          body: string
          company_id: string
          created_at: string
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_module_settings: {
        Row: {
          company_id: string
          due_soon_threshold_minutes: number
          pause_note_required: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          due_soon_threshold_minutes?: number
          pause_note_required?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          due_soon_threshold_minutes?: number
          pause_note_required?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_module_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      task_notifications: {
        Row: {
          company_id: string
          created_at: string
          id: string
          message: string
          read_at: string | null
          reference_date: string | null
          task_id: string | null
          title: string | null
          type: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          message: string
          read_at?: string | null
          reference_date?: string | null
          task_id?: string | null
          title?: string | null
          type: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          message?: string
          read_at?: string | null
          reference_date?: string | null
          task_id?: string | null
          title?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          allowed_block_reasons: string[] | null
          checklist_template: Json
          created_at: string
          default_duration_minutes: number | null
          default_priority: string
          evidence_required: boolean
          id: string
          is_active: boolean
          key: string
          name: string
          operation_type: string
          payload_schema: Json
          requires_validation: boolean
          tool_key: string | null
          version: number
        }
        Insert: {
          allowed_block_reasons?: string[] | null
          checklist_template?: Json
          created_at?: string
          default_duration_minutes?: number | null
          default_priority?: string
          evidence_required?: boolean
          id?: string
          is_active?: boolean
          key: string
          name: string
          operation_type: string
          payload_schema?: Json
          requires_validation?: boolean
          tool_key?: string | null
          version?: number
        }
        Update: {
          allowed_block_reasons?: string[] | null
          checklist_template?: Json
          created_at?: string
          default_duration_minutes?: number | null
          default_priority?: string
          evidence_required?: boolean
          id?: string
          is_active?: boolean
          key?: string
          name?: string
          operation_type?: string
          payload_schema?: Json
          requires_validation?: boolean
          tool_key?: string | null
          version?: number
        }
        Relationships: []
      }
      task_time_segments: {
        Row: {
          assignee_id: string
          company_id: string
          ended_at: string | null
          id: string
          segment_type: string
          started_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          assignee_id: string
          company_id: string
          ended_at?: string | null
          id?: string
          segment_type: string
          started_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          assignee_id?: string
          company_id?: string
          ended_at?: string | null
          id?: string
          segment_type?: string
          started_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_time_segments_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "task_assignees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_time_segments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_time_segments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          area: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category: string | null
          company_id: string
          completion_note: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          due_time: string | null
          estimated_duration_minutes: number | null
          executed_quantity: number | null
          id: string
          location_from: string | null
          location_to: string | null
          payload: Json
          planned_quantity: number | null
          priority: string
          quantity_unit: string | null
          reopened_count: number
          requires_validation: boolean
          result: Json
          sku_or_line: string | null
          status: string
          template_key: string | null
          template_version: number | null
          title: string
          tool_key: string | null
          type: string
          updated_at: string
        }
        Insert: {
          area?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string | null
          company_id: string
          completion_note?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          estimated_duration_minutes?: number | null
          executed_quantity?: number | null
          id?: string
          location_from?: string | null
          location_to?: string | null
          payload?: Json
          planned_quantity?: number | null
          priority?: string
          quantity_unit?: string | null
          reopened_count?: number
          requires_validation?: boolean
          result?: Json
          sku_or_line?: string | null
          status?: string
          template_key?: string | null
          template_version?: number | null
          title: string
          tool_key?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          area?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string | null
          company_id?: string
          completion_note?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          estimated_duration_minutes?: number | null
          executed_quantity?: number | null
          id?: string
          location_from?: string | null
          location_to?: string | null
          payload?: Json
          planned_quantity?: number | null
          priority?: string
          quantity_unit?: string | null
          reopened_count?: number
          requires_validation?: boolean
          result?: Json
          sku_or_line?: string | null
          status?: string
          template_key?: string | null
          template_version?: number | null
          title?: string
          tool_key?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      top_vendas: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          order_index: number | null
          produto: string
          sku: string
          updated_at: string | null
          vendas: string
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          id?: string
          order_index?: number | null
          produto: string
          sku: string
          updated_at?: string | null
          vendas: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          order_index?: number | null
          produto?: string
          sku?: string
          updated_at?: string | null
          vendas?: string
        }
        Relationships: []
      }
      user_achievements: {
        Row: {
          achievement_definition_id: string
          company_id: string
          id: string
          progress_value: number
          unlocked: boolean
          unlocked_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          achievement_definition_id: string
          company_id?: string
          id?: string
          progress_value?: number
          unlocked?: boolean
          unlocked_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          achievement_definition_id?: string
          company_id?: string
          id?: string
          progress_value?: number
          unlocked?: boolean
          unlocked_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_definition_id_fkey"
            columns: ["achievement_definition_id"]
            isOneToOne: false
            referencedRelation: "achievement_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_shortcuts: {
        Row: {
          company_id: string
          created_at: string
          id: string
          order_index: number
          route_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          id?: string
          order_index?: number
          route_key: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          order_index?: number
          route_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_shortcuts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_shortcuts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "academy_team_summary_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_shortcuts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_shortcuts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_productivity_stats_v"
            referencedColumns: ["user_id"]
          },
        ]
      }
      warehouse_bin_movements: {
        Row: {
          boxes: number
          company_id: string
          created_at: string
          created_by: string | null
          from_bin_id: string | null
          id: string
          movement_reason: string
          movement_type: string
          product_id: string
          reason: string | null
          to_bin_id: string | null
          units_per_box: number
        }
        Insert: {
          boxes: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          from_bin_id?: string | null
          id?: string
          movement_reason: string
          movement_type: string
          product_id: string
          reason?: string | null
          to_bin_id?: string | null
          units_per_box: number
        }
        Update: {
          boxes?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          from_bin_id?: string | null
          id?: string
          movement_reason?: string
          movement_type?: string
          product_id?: string
          reason?: string | null
          to_bin_id?: string | null
          units_per_box?: number
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_bin_movements_from_bin_id_fkey"
            columns: ["from_bin_id"]
            isOneToOne: false
            referencedRelation: "warehouse_storage_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_bin_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_bin_movements_to_bin_id_fkey"
            columns: ["to_bin_id"]
            isOneToOne: false
            referencedRelation: "warehouse_storage_bins"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_bin_stock: {
        Row: {
          bin_id: string
          boxes: number
          company_id: string
          first_stored_at: string
          id: string
          product_id: string
          units: number | null
          units_per_box: number
          updated_at: string
        }
        Insert: {
          bin_id: string
          boxes: number
          company_id?: string
          first_stored_at?: string
          id?: string
          product_id: string
          units?: number | null
          units_per_box: number
          updated_at?: string
        }
        Update: {
          bin_id?: string
          boxes?: number
          company_id?: string
          first_stored_at?: string
          id?: string
          product_id?: string
          units?: number | null
          units_per_box?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_bin_stock_bin_id_fkey"
            columns: ["bin_id"]
            isOneToOne: false
            referencedRelation: "warehouse_storage_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_bin_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_builder_objects: {
        Row: {
          andar: number
          company_id: string
          cor: string
          created_at: string
          estante: string
          id: string
          rotacao_y: number
          tipo: string
          updated_at: string
          x: number
          z: number
        }
        Insert: {
          andar?: number
          company_id?: string
          cor?: string
          created_at?: string
          estante?: string
          id?: string
          rotacao_y?: number
          tipo: string
          updated_at?: string
          x: number
          z: number
        }
        Update: {
          andar?: number
          company_id?: string
          cor?: string
          created_at?: string
          estante?: string
          id?: string
          rotacao_y?: number
          tipo?: string
          updated_at?: string
          x?: number
          z?: number
        }
        Relationships: []
      }
      warehouse_cells: {
        Row: {
          andar: number
          capacity: number | null
          cell_type: string
          company_id: string
          id: string
          is_active: boolean
          layout_id: string
          location_code: string | null
          predio: string
          x: number
          y: number
        }
        Insert: {
          andar?: number
          capacity?: number | null
          cell_type?: string
          company_id?: string
          id?: string
          is_active?: boolean
          layout_id: string
          location_code?: string | null
          predio?: string
          x: number
          y: number
        }
        Update: {
          andar?: number
          capacity?: number | null
          cell_type?: string
          company_id?: string
          id?: string
          is_active?: boolean
          layout_id?: string
          location_code?: string | null
          predio?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_cells_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "warehouse_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_layouts: {
        Row: {
          andar: number
          background_image_path: string | null
          background_offset_x: number
          background_offset_y: number
          background_opacity: number
          background_scale: number
          cell_size_meters: number
          company_id: string
          created_at: string | null
          grid_height: number
          grid_width: number
          id: string
          is_active: boolean
          name: string
          published_at: string | null
          scale_confirmed: boolean
          status: string
          updated_at: string | null
          version: number
        }
        Insert: {
          andar?: number
          background_image_path?: string | null
          background_offset_x?: number
          background_offset_y?: number
          background_opacity?: number
          background_scale?: number
          cell_size_meters?: number
          company_id?: string
          created_at?: string | null
          grid_height: number
          grid_width: number
          id?: string
          is_active?: boolean
          name?: string
          published_at?: string | null
          scale_confirmed?: boolean
          status?: string
          updated_at?: string | null
          version?: number
        }
        Update: {
          andar?: number
          background_image_path?: string | null
          background_offset_x?: number
          background_offset_y?: number
          background_opacity?: number
          background_scale?: number
          cell_size_meters?: number
          company_id?: string
          created_at?: string | null
          grid_height?: number
          grid_width?: number
          id?: string
          is_active?: boolean
          name?: string
          published_at?: string | null
          scale_confirmed?: boolean
          status?: string
          updated_at?: string | null
          version?: number
        }
        Relationships: []
      }
      warehouse_optimization_history: {
        Row: {
          company_id: string
          event: string
          id: string
          layout_id: string
          meters_saved: number
          recommendation_id: string | null
          recorded_at: string | null
        }
        Insert: {
          company_id?: string
          event: string
          id?: string
          layout_id: string
          meters_saved?: number
          recommendation_id?: string | null
          recorded_at?: string | null
        }
        Update: {
          company_id?: string
          event?: string
          id?: string
          layout_id?: string
          meters_saved?: number
          recommendation_id?: string | null
          recorded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_optimization_history_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "warehouse_layouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_optimization_history_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "warehouse_slotting_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_plan_sections: {
        Row: {
          andar: number
          company_id: string
          comprimento: number
          comprimento_da_fileira: number
          corredor_inicio: number
          corredor_longitudinal: number
          created_at: string
          distribuicao: string
          fileiras: number
          id: string
          nome: string
          rotulos: string[]
          updated_at: string
          z_inicio: number
        }
        Insert: {
          andar?: number
          company_id?: string
          comprimento: number
          comprimento_da_fileira: number
          corredor_inicio?: number
          corredor_longitudinal?: number
          created_at?: string
          distribuicao?: string
          fileiras: number
          id?: string
          nome: string
          rotulos?: string[]
          updated_at?: string
          z_inicio: number
        }
        Update: {
          andar?: number
          company_id?: string
          comprimento?: number
          comprimento_da_fileira?: number
          corredor_inicio?: number
          corredor_longitudinal?: number
          created_at?: string
          distribuicao?: string
          fileiras?: number
          id?: string
          nome?: string
          rotulos?: string[]
          updated_at?: string
          z_inicio?: number
        }
        Relationships: []
      }
      warehouse_slotting_recommendations: {
        Row: {
          company_id: string
          created_at: string | null
          current_location: string | null
          decided_at: string | null
          decided_by: string | null
          estimated_meters_saved: number
          estimated_productivity_gain_pct: number
          estimated_time_saved_seconds: number
          id: string
          layout_id: string
          product_id: string | null
          reason: string
          recommendation_type: string
          status: string
          suggested_location: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          current_location?: string | null
          decided_at?: string | null
          decided_by?: string | null
          estimated_meters_saved?: number
          estimated_productivity_gain_pct?: number
          estimated_time_saved_seconds?: number
          id?: string
          layout_id: string
          product_id?: string | null
          reason?: string
          recommendation_type: string
          status?: string
          suggested_location?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          current_location?: string | null
          decided_at?: string | null
          decided_by?: string | null
          estimated_meters_saved?: number
          estimated_productivity_gain_pct?: number
          estimated_time_saved_seconds?: number
          id?: string
          layout_id?: string
          product_id?: string | null
          reason?: string
          recommendation_type?: string
          status?: string
          suggested_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_slotting_recommendations_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "warehouse_layouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_slotting_recommendations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_stock_reservations: {
        Row: {
          bin_id: string
          boxes: number
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          owner_id: string
          owner_kind: string
          owner_ref: string | null
          product_id: string
          settled_at: string | null
          settled_by: string | null
          status: string
          units_per_box: number
        }
        Insert: {
          bin_id: string
          boxes: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          owner_id: string
          owner_kind: string
          owner_ref?: string | null
          product_id: string
          settled_at?: string | null
          settled_by?: string | null
          status?: string
          units_per_box: number
        }
        Update: {
          bin_id?: string
          boxes?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          owner_id?: string
          owner_kind?: string
          owner_ref?: string | null
          product_id?: string
          settled_at?: string | null
          settled_by?: string | null
          status?: string
          units_per_box?: number
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_stock_reservations_bin_id_fkey"
            columns: ["bin_id"]
            isOneToOne: false
            referencedRelation: "warehouse_storage_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_stock_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_storage_bins: {
        Row: {
          andar: number
          bin_type: string
          blocked: boolean
          blocked_reason: string | null
          capacity_boxes: number | null
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          predio: string
          updated_at: string
        }
        Insert: {
          andar?: number
          bin_type?: string
          blocked?: boolean
          blocked_reason?: string | null
          capacity_boxes?: number | null
          code: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          predio?: string
          updated_at?: string
        }
        Update: {
          andar?: number
          bin_type?: string
          blocked?: boolean
          blocked_reason?: string | null
          capacity_boxes?: number | null
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          predio?: string
          updated_at?: string
        }
        Relationships: []
      }
      warehouse_zones: {
        Row: {
          code: string
          company_id: string
          created_at: string | null
          id: string
          kind: string
          layout_id: string
          max_x: number
          max_y: number
          min_x: number
          min_y: number
          name: string
          updated_at: string | null
        }
        Insert: {
          code: string
          company_id?: string
          created_at?: string | null
          id?: string
          kind?: string
          layout_id: string
          max_x: number
          max_y: number
          min_x: number
          min_y: number
          name: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string | null
          id?: string
          kind?: string
          layout_id?: string
          max_x?: number
          max_y?: number
          min_x?: number
          min_y?: number
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_zones_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "warehouse_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      abc_xyz_company_summary_v: {
        Row: {
          abc_xyz_class: string | null
          company_id: string | null
          sku_count: number | null
          total_value_moved: number | null
        }
        Relationships: []
      }
      academy_team_summary_v: {
        Row: {
          certificates_count: number | null
          company_id: string | null
          courses_completed: number | null
          hours_studied: number | null
          last_activity_at: string | null
          name: string | null
          never_accessed: boolean | null
          role: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_track_progress_v: {
        Row: {
          company_id: string | null
          courses_completed: number | null
          courses_total: number | null
          has_certificate: boolean | null
          hours_studied: number | null
          pct_complete: number | null
          track_id: string | null
          track_title: string | null
          user_id: string | null
        }
        Relationships: []
      }
      cbc_company_summary_v: {
        Row: {
          avg_confidence: number | null
          bom_count: number | null
          company_id: string | null
          critico_count: number | null
          distinct_locations: number | null
          due_this_week_count: number | null
          excelente_count: number | null
          insufficient_count: number | null
          medio_count: number | null
          overdue_count: number | null
          scheduled_this_week_count: number | null
          total_scored: number | null
        }
        Relationships: []
      }
      inventory_cycle_line_summary_v: {
        Row: {
          brand_id: string | null
          company_id: string | null
          cycle_id: string | null
          divergences: number | null
          done_sku: number | null
          group_key: string | null
          group_label: string | null
          line_id: string | null
          total_sku: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "inventory_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "product_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_count_final_result_v: {
        Row: {
          any_round_approved: boolean | null
          company_id: string | null
          count_1: number | null
          count_2: number | null
          count_3: number | null
          ean: string | null
          erp_quantity_snapshot: number | null
          location: string | null
          product_id: string | null
          root_session_id: string | null
          sku: string | null
        }
        Relationships: [
          {
            foreignKeyName: "physical_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_sessions_root_session_id_fkey"
            columns: ["root_session_id"]
            isOneToOne: false
            referencedRelation: "physical_count_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      picking_wave_route_v: {
        Row: {
          allocation_id: string | null
          allocation_status: string | null
          bin_blocked: boolean | null
          bin_code: string | null
          boxes: number | null
          boxes_restantes: number | null
          boxes_separadas: number | null
          company_id: string | null
          ean: string | null
          first_stored_at: string | null
          item_id: string | null
          product_id: string | null
          product_name: string | null
          sequencia: number | null
          sku: string | null
          units_per_box: number | null
          wave_code: string | null
          wave_id: string | null
          wave_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "picking_allocations_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "picking_waves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_wave_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_company_summary_v: {
        Row: {
          alto_count: number | null
          avg_risk: number | null
          baixo_count: number | null
          company_id: string | null
          critico_count: number | null
          insufficient_count: number | null
          medio_count: number | null
          total_scored: number | null
        }
        Relationships: []
      }
      user_productivity_stats_v: {
        Row: {
          acuracidade_media: number | null
          company_id: string | null
          contagens: number | null
          divergencias_encontradas: number | null
          divergencias_reais: number | null
          etiquetas_geradas: number | null
          fulls_realizados: number | null
          itens_separados: number | null
          name: string | null
          recontagens: number | null
          role: string | null
          skus_contados: number | null
          tempo_medio_segundos: number | null
          ultima_atividade: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      wms_bin_availability_v: {
        Row: {
          bin_blocked: boolean | null
          bin_code: string | null
          bin_id: string | null
          bin_is_active: boolean | null
          bin_type: string | null
          boxes_disponivel: number | null
          boxes_fisico: number | null
          boxes_reservado: number | null
          company_id: string | null
          first_stored_at: string | null
          product_id: string | null
          sku: string | null
          units_disponivel: number | null
          units_fisico: number | null
          units_per_box: number | null
          units_reservado: number | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_bin_stock_bin_id_fkey"
            columns: ["bin_id"]
            isOneToOne: false
            referencedRelation: "warehouse_storage_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_bin_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      wms_product_availability_v: {
        Row: {
          boxes_disponivel: number | null
          boxes_fisico: number | null
          boxes_reservado: number | null
          company_id: string | null
          enderecos: number | null
          product_id: string | null
          sku: string | null
          units_disponivel: number | null
          units_fisico: number | null
          units_reservado: number | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_bin_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      wms_product_stock_v: {
        Row: {
          bin_blocked: boolean | null
          bin_code: string | null
          boxes: number | null
          company_id: string | null
          first_stored_at: string | null
          product_id: string | null
          product_name: string | null
          sku: string | null
          units: number | null
          units_per_box: number | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_bin_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_pending_invitations: {
        Args: never
        Returns: {
          out_activated: boolean
          out_company_id: string
          out_company_slug: string
        }[]
      }
      admin_get_session_ips: {
        Args: { p_session_ids: string[] }
        Returns: {
          ip_address: string
          session_id: string
        }[]
      }
      admin_list_company_sessions: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_role?: string
          p_search?: string
          p_status?: string
        }
        Returns: {
          created_at: string
          ip_address: string
          is_current: boolean
          is_multi_company: boolean
          not_after: string
          refreshed_at: string
          session_id: string
          total_count: number
          user_agent: string
          user_email: string
          user_id: string
          user_name: string
          user_role: string
        }[]
      }
      admin_reset_inventory: {
        Args: { p_name: string; p_notes: string; p_reason: string }
        Returns: string
      }
      admin_revoke_session: {
        Args: { p_reason?: string; p_session_id: string }
        Returns: undefined
      }
      admin_revoke_user_sessions: {
        Args: { p_reason?: string; p_user_id: string }
        Returns: number
      }
      api_key_consume_rate_limit: {
        Args: {
          p_api_key_id: string
          p_limit?: number
          p_window_seconds?: number
        }
        Returns: boolean
      }
      api_key_create: {
        Args: { p_description?: string; p_expires_at?: string; p_name: string }
        Returns: {
          created_at: string
          expires_at: string
          id: string
          key_prefix: string
          plaintext_key: string
        }[]
      }
      api_key_delete: { Args: { p_id: string }; Returns: undefined }
      api_key_revoke: { Args: { p_id: string }; Returns: undefined }
      automation_accept_webhook: {
        Args: {
          p_automation_id: string
          p_company_id: string
          p_payload: Json
          p_payload_hash: string
        }
        Returns: {
          delivery_status: string
          event_id: string
        }[]
      }
      automation_action_create_recount: {
        Args: {
          p_company_id: string
          p_parent_session_id: string
          p_responsible_id?: string
        }
        Returns: string
      }
      automation_bump_execution_counters: {
        Args: { p_automation_id: string; p_executed_at: string }
        Returns: undefined
      }
      automation_claim_events: {
        Args: { p_company_id: string; p_limit?: number }
        Returns: {
          company_id: string
          created_at: string
          depth: number
          event_type: string
          id: string
          origin_automation_id: string
          origin_execution_id: string
          payload: Json
          resume_actions: Json
          resume_automation_id: string
          resume_execution_id: string
          resume_node_id: string
          source_id: string
          source_table: string
        }[]
      }
      automation_companies_with_pending_events: {
        Args: { p_limit?: number }
        Returns: {
          company_id: string
          pending_count: number
        }[]
      }
      automation_create_wait: {
        Args: {
          p_automation_id: string
          p_company_id: string
          p_depth: number
          p_event_type: string
          p_execution_id: string
          p_payload: Json
          p_resume_actions: Json
          p_resume_node_id: string
          p_timeout_minutes: number
        }
        Returns: string
      }
      automation_create_webhook_secret: {
        Args: { p_automation_id: string }
        Returns: string
      }
      automation_dispatch_pending: { Args: never; Returns: number }
      automation_emit_due_schedules: { Args: never; Returns: number }
      automation_emit_event: {
        Args: {
          p_company_id: string
          p_depth?: number
          p_event_type: string
          p_origin_automation_id?: string
          p_origin_execution_id?: string
          p_payload: Json
          p_source_id?: string
          p_source_table?: string
        }
        Returns: string
      }
      automation_expire_waits: { Args: never; Returns: number }
      automation_has_webhook_secret: {
        Args: { p_automation_id: string }
        Returns: boolean
      }
      automation_next_schedule_run: {
        Args: {
          p_from?: string
          p_hour: number
          p_kind: string
          p_minute: number
          p_minutes: number
          p_timezone: string
          p_weekday: number
        }
        Returns: string
      }
      automation_prune_history: { Args: { p_days?: number }; Returns: number }
      automation_reap_stuck_events: {
        Args: { p_older_than_minutes?: number }
        Returns: number
      }
      automation_reject_webhook: {
        Args: {
          p_automation_id: string
          p_company_id: string
          p_payload_hash: string
          p_reason: string
        }
        Returns: undefined
      }
      automation_resolve_webhook: {
        Args: { p_automation_id: string }
        Returns: {
          automation_id: string
          company_id: string
          is_active: boolean
          secret: string
        }[]
      }
      automation_resume_wait: {
        Args: { p_external_payload?: Json; p_token: string }
        Returns: {
          event_id: string
          reason: string
          resumed: boolean
        }[]
      }
      automation_schedule_resume: {
        Args: {
          p_automation_id: string
          p_company_id: string
          p_delay_minutes: number
          p_depth: number
          p_event_type: string
          p_execution_id: string
          p_payload: Json
          p_resume_actions: Json
          p_resume_node_id: string
        }
        Returns: string
      }
      automation_verify_cron_secret: {
        Args: { p_candidate: string }
        Returns: boolean
      }
      company_webhook_allowed_events: { Args: never; Returns: string[] }
      company_webhook_claim_due_deliveries: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          company_id: string
          created_at: string
          delivered_at: string | null
          duration_ms: number | null
          error_message: string | null
          event_type: string
          http_status: number | null
          id: string
          next_attempt_at: string
          payload: Json
          status: string
          webhook_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "company_webhook_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      company_webhook_claim_test_delivery: {
        Args: { p_delivery_id: string }
        Returns: {
          attempt_count: number
          company_id: string
          created_at: string
          delivered_at: string | null
          duration_ms: number | null
          error_message: string | null
          event_type: string
          http_status: number | null
          id: string
          next_attempt_at: string
          payload: Json
          status: string
          webhook_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "company_webhook_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      company_webhook_create: {
        Args: { p_events: string[]; p_name: string; p_url: string }
        Returns: {
          id: string
          secret: string
        }[]
      }
      company_webhook_delete: { Args: { p_id: string }; Returns: undefined }
      company_webhook_dispatch_pending: { Args: never; Returns: number }
      company_webhook_enqueue_event: {
        Args: { p_company_id: string; p_event_type: string; p_payload: Json }
        Returns: undefined
      }
      company_webhook_record_attempt: {
        Args: {
          p_delivery_id: string
          p_duration_ms?: number
          p_error: string
          p_http_status: number
          p_retryable?: boolean
          p_success: boolean
        }
        Returns: undefined
      }
      company_webhook_rotate_secret: { Args: { p_id: string }; Returns: string }
      company_webhook_send_test: { Args: { p_id: string }; Returns: string }
      company_webhook_set_active: {
        Args: { p_id: string; p_is_active: boolean }
        Returns: undefined
      }
      company_webhook_update: {
        Args: {
          p_events: string[]
          p_id: string
          p_is_active: boolean
          p_name: string
          p_url: string
        }
        Returns: undefined
      }
      company_webhook_verify_cron_secret: {
        Args: { p_candidate: string }
        Returns: boolean
      }
      create_additional_company: {
        Args: { p_company_name: string }
        Returns: {
          out_company_id: string
          out_company_slug: string
        }[]
      }
      create_company_for_current_user: {
        Args: { company_name: string }
        Returns: string
      }
      create_company_invitation: {
        Args: { p_email: string; p_name?: string; p_role: string }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          company_id: string
          created_at: string
          email: string
          email_normalized: string
          expires_at: string
          id: string
          invited_by: string | null
          invited_name: string | null
          role: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "company_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_company_onboarding: {
        Args: { p_company_name: string; p_user_name?: string }
        Returns: {
          out_company_id: string
          out_company_slug: string
        }[]
      }
      cycle_program_generate_reminders: { Args: never; Returns: undefined }
      cycle_program_notifications_mark_read: {
        Args: { p_ids: string[] }
        Returns: number
      }
      fiscal_entities_archive: {
        Args: { p_entity_id: string }
        Returns: {
          cnpj: string
          company_id: string
          created_at: string
          created_by: string | null
          data_incomplete: boolean
          id: string
          is_default: boolean
          legal_name: string
          state_registration: string | null
          status: string
          trade_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "fiscal_entities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fiscal_entities_create: {
        Args: {
          p_cnpj?: string
          p_legal_name: string
          p_set_default?: boolean
          p_state_registration?: string
          p_trade_name?: string
        }
        Returns: {
          cnpj: string
          company_id: string
          created_at: string
          created_by: string | null
          data_incomplete: boolean
          id: string
          is_default: boolean
          legal_name: string
          state_registration: string | null
          status: string
          trade_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "fiscal_entities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fiscal_entities_find_by_cnpj: {
        Args: { p_cnpj: string; p_company_id: string }
        Returns: {
          cnpj: string
          company_id: string
          created_at: string
          created_by: string | null
          data_incomplete: boolean
          id: string
          is_default: boolean
          legal_name: string
          state_registration: string | null
          status: string
          trade_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "fiscal_entities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fiscal_entities_restore: {
        Args: { p_entity_id: string }
        Returns: {
          cnpj: string
          company_id: string
          created_at: string
          created_by: string | null
          data_incomplete: boolean
          id: string
          is_default: boolean
          legal_name: string
          state_registration: string | null
          status: string
          trade_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "fiscal_entities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fiscal_entities_set_default: {
        Args: { p_entity_id: string }
        Returns: {
          cnpj: string
          company_id: string
          created_at: string
          created_by: string | null
          data_incomplete: boolean
          id: string
          is_default: boolean
          legal_name: string
          state_registration: string | null
          status: string
          trade_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "fiscal_entities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fiscal_entities_update: {
        Args: {
          p_cnpj?: string
          p_confirm_cnpj_change?: boolean
          p_entity_id: string
          p_legal_name: string
          p_state_registration?: string
          p_trade_name?: string
        }
        Returns: {
          cnpj: string
          company_id: string
          created_at: string
          created_by: string | null
          data_incomplete: boolean
          id: string
          is_default: boolean
          legal_name: string
          state_registration: string | null
          status: string
          trade_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "fiscal_entities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      full_withdrawal_advance_status: {
        Args: { p_note?: string; p_plan_id: string; p_to_status: string }
        Returns: {
          cancellation_reason: string | null
          code: string
          company_id: string
          conferred_at: string | null
          cost: number | null
          cost_note: string | null
          created_at: string
          created_by: string | null
          destination_address: string | null
          destination_label: string | null
          expected_delivery_date: string | null
          id: string
          method: string
          ml_confirmed_at: string | null
          ml_reference: string | null
          notes: string | null
          preparing_at: string | null
          reason: string | null
          received_at: string | null
          reserved_at: string | null
          shipped_at: string | null
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "full_withdrawal_plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      full_withdrawal_conference_item: {
        Args: {
          p_item_id: string
          p_note?: string
          p_received_quantity: number
        }
        Returns: {
          company_id: string
          confirmed_quantity: number | null
          created_at: string
          description: string
          divergence_note: string | null
          divergence_noted_at: string | null
          divergence_noted_by: string | null
          id: string
          plan_id: string
          planned_quantity: number
          product_id: string | null
          received_quantity: number | null
          situation: string
          sku: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "full_withdrawal_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      full_withdrawal_justify_divergence: {
        Args: { p_item_id: string; p_note: string }
        Returns: {
          company_id: string
          confirmed_quantity: number | null
          created_at: string
          description: string
          divergence_note: string | null
          divergence_noted_at: string | null
          divergence_noted_by: string | null
          id: string
          plan_id: string
          planned_quantity: number
          product_id: string | null
          received_quantity: number | null
          situation: string
          sku: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "full_withdrawal_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      full_withdrawal_link_ml: {
        Args: {
          p_cost?: number
          p_expected_delivery_date?: string
          p_ml_reference: string
          p_plan_id: string
        }
        Returns: {
          cancellation_reason: string | null
          code: string
          company_id: string
          conferred_at: string | null
          cost: number | null
          cost_note: string | null
          created_at: string
          created_by: string | null
          destination_address: string | null
          destination_label: string | null
          expected_delivery_date: string | null
          id: string
          method: string
          ml_confirmed_at: string | null
          ml_reference: string | null
          notes: string | null
          preparing_at: string | null
          reason: string | null
          received_at: string | null
          reserved_at: string | null
          shipped_at: string | null
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "full_withdrawal_plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_my_company_id: { Args: never; Returns: string }
      get_my_role: { Args: never; Returns: string }
      get_or_create_daily_invite_code: {
        Args: never
        Returns: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          valid_date: string
        }
        SetofOptions: {
          from: "*"
          to: "company_invite_codes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      integration_claim_due_jobs: {
        Args: { p_limit?: number }
        Returns: {
          company_id: string
          connection_id: string
          created_at: string | null
          created_count: number
          cursor_after: string | null
          cursor_before: string | null
          direction: string
          duration_ms: number | null
          entity_type: string
          error_message: string | null
          error_summary: string | null
          failed_count: number
          finished_at: string | null
          id: string
          idempotency_key: string
          processed_count: number
          records_total: number | null
          skipped_count: number
          started_at: string
          status: string
          sync_type: string
          trigger_source: string
          triggered_by: string | null
          updated_count: number
        }[]
        SetofOptions: {
          from: "*"
          to: "integration_sync_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      integration_clear_credential: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
      integration_enqueue_due_syncs: { Args: never; Returns: number }
      integration_intelligence_snapshot: {
        Args: { p_connection_id?: string }
        Returns: Json
      }
      integration_negative_stock_detail: {
        Args: { p_connection_id?: string; p_limit?: number }
        Returns: {
          connection_id: string
          ean: string
          entity_link_id: string
          external_id: string
          internal_product_id: string
          observed_at: string
          product_name: string
          sku: string
          total_quantity: number
          worst_warehouse: string
          worst_warehouse_quantity: number
        }[]
      }
      integration_raise_alert: {
        Args: {
          p_company_id: string
          p_connection_id: string
          p_context?: Json
          p_kind: string
          p_message: string
          p_severity: string
        }
        Returns: undefined
      }
      integration_reap_stuck_jobs: {
        Args: { p_stale_minutes?: number }
        Returns: number
      }
      integration_resolve_alert: {
        Args: { p_connection_id: string; p_kind: string }
        Returns: undefined
      }
      integration_set_credential: {
        Args: {
          p_connection_id: string
          p_expires_at?: string
          p_hint?: string
          p_secret: string
        }
        Returns: undefined
      }
      integration_set_webhook_secret: {
        Args: { p_connection_id: string; p_secret: string; p_topics?: string[] }
        Returns: undefined
      }
      is_support_staff: { Args: never; Returns: boolean }
      is_valid_cnpj: { Args: { p_cnpj: string }; Returns: boolean }
      join_company_by_invite_code: {
        Args: { p_code: string }
        Returns: {
          out_activated: boolean
          out_company_id: string
          out_company_slug: string
        }[]
      }
      legal_record_acceptance: {
        Args: { p_privacy_version: string; p_terms_version: string }
        Returns: string
      }
      link_user_to_company: {
        Args: { target_company_id: string }
        Returns: undefined
      }
      nfe_admin_archive_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: undefined
      }
      nfe_admin_correct_count: {
        Args: { p_item_id: string; p_quantity: number; p_reason: string }
        Returns: number
      }
      nfe_admin_hard_delete_draft_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: undefined
      }
      nfe_admin_restore_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: undefined
      }
      nfe_claim_key_fetch: { Args: { p_invoice_key: string }; Returns: boolean }
      nfe_finalize_conference: {
        Args: { p_invoice_id: string }
        Returns: string
      }
      nfe_putaway_item: {
        Args: {
          p_bin_code: string
          p_boxes: number
          p_expiry_date?: string
          p_item_id: string
          p_lot_number?: string
          p_units_per_box: number
        }
        Returns: string
      }
      nfe_register_count: {
        Args: {
          p_ean?: string
          p_idempotency_key: string
          p_item_id: string
          p_mode: string
          p_quantity: number
          p_sku?: string
          p_source: string
        }
        Returns: number
      }
      nfe_reopen_conference: {
        Args: { p_invoice_id: string }
        Returns: undefined
      }
      nfe_start_conference: {
        Args: { p_invoice_id: string }
        Returns: undefined
      }
      owner_revoke_company_sessions: {
        Args: { p_confirmation: string; p_reason?: string }
        Returns: {
          revoked_count: number
          skipped_count: number
        }[]
      }
      pc_acknowledge_recount_event: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      pc_admin_delete_session: {
        Args: { p_reason: string; p_session_id: string }
        Returns: undefined
      }
      pc_admin_hard_delete_draft_session: {
        Args: { p_reason: string; p_session_id: string }
        Returns: undefined
      }
      pc_admin_restore_session: {
        Args: { p_reason: string; p_session_id: string }
        Returns: undefined
      }
      pc_admin_update_session: {
        Args: {
          p_area: string
          p_observation: string
          p_session_id: string
          p_warehouse: string
        }
        Returns: undefined
      }
      pc_approve_session: { Args: { p_session_id: string }; Returns: undefined }
      pc_create_recount_session: {
        Args: { p_parent_session_id: string; p_responsible_id?: string }
        Returns: string
      }
      pc_create_session: {
        Args: {
          p_area: string
          p_observation: string
          p_product_ids: string[]
          p_responsible_id: string
          p_street_from: string
          p_street_to: string
          p_warehouse: string
        }
        Returns: string
      }
      pc_evaluate_auto_recount: {
        Args: { p_session_id: string }
        Returns: string
      }
      pc_finalize_session: { Args: { p_session_id: string }; Returns: string }
      pc_flag_found_elsewhere: {
        Args: {
          p_found_location: string
          p_idempotency_key: string
          p_item_id: string
          p_quantity: number
        }
        Returns: undefined
      }
      pc_measure_session_divergence: {
        Args: { p_session_id: string }
        Returns: {
          absolute_unit_deviation: number
          counted_items: number
          divergent_items: number
          erp_total: number
          physical_total: number
        }[]
      }
      pc_record_erp_sync_event: {
        Args: {
          p_adjustment: number
          p_error_message: string
          p_final_quantity: number
          p_idempotency_key: string
          p_item_id: string
          p_pending: boolean
          p_previous_quantity: number
          p_product_id: string
          p_provider: string
          p_request_payload: Json
          p_response_payload: Json
          p_session_id: string
          p_sku: string
          p_success: boolean
        }
        Returns: string
      }
      pc_register_count: {
        Args: {
          p_idempotency_key: string
          p_item_id: string
          p_mode: string
          p_quantity: number
          p_source: string
        }
        Returns: number
      }
      pc_reopen_session: { Args: { p_session_id: string }; Returns: undefined }
      pc_start_session: { Args: { p_session_id: string }; Returns: undefined }
      picking_alocar_item: { Args: { p_item_id: string }; Returns: number }
      picking_resequenciar: {
        Args: { p_serpentina?: boolean; p_wave_id: string }
        Returns: number
      }
      picking_resolve_product: { Args: { p_code: string }; Returns: Json }
      picking_wave_add_item: {
        Args: { p_boxes: number; p_product_id: string; p_wave_id: string }
        Returns: string
      }
      picking_wave_cancel: {
        Args: { p_reason?: string; p_wave_id: string }
        Returns: Json
      }
      picking_wave_create: {
        Args: { p_notes?: string; p_origin?: string; p_origin_ref?: string }
        Returns: string
      }
      picking_wave_finish: { Args: { p_wave_id: string }; Returns: Json }
      picking_wave_pick: {
        Args: {
          p_allocation_id: string
          p_boxes: number
          p_idempotency_key: string
          p_scanned_bin: string
          p_scanned_code: string
          p_source: string
        }
        Returns: Json
      }
      picking_wave_remove_item: {
        Args: { p_item_id: string }
        Returns: boolean
      }
      picking_wave_reserve: {
        Args: { p_serpentina?: boolean; p_wave_id: string }
        Returns: Json
      }
      prune_processed_webhook_payloads: {
        Args: { p_retain_days?: number }
        Returns: number
      }
      rca_next_case_number: {
        Args: { p_company_id: string; p_year: number }
        Returns: number
      }
      return_items_batch_apply: {
        Args: { p_action: string; p_item_ids: string[]; p_params?: Json }
        Returns: number
      }
      return_items_decide_approval: {
        Args: { p_approved: boolean; p_reason?: string; p_request_id: string }
        Returns: {
          approval_type: string
          company_id: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          id: string
          notes: string | null
          requested_at: string
          requested_by: string | null
          return_item_id: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "return_approval_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_items_decide_destination: {
        Args: {
          p_connection_id?: string
          p_destination: string
          p_item_id: string
          p_reason?: string
          p_sync_to_erp?: boolean
        }
        Returns: {
          accessories_received: string | null
          checklist_accessories_complete: boolean | null
          checklist_apparently_functional: boolean | null
          checklist_correct_product: boolean | null
          checklist_no_visible_damage: boolean | null
          checklist_packaging_intact: boolean | null
          checklist_serial_matches: boolean | null
          checklist_signs_of_use: boolean | null
          checklist_template_id: string | null
          checklist_template_version: number | null
          classification: string | null
          company_id: string
          condition_grade_id: string | null
          created_at: string
          current_location: string
          description: string
          destination: string | null
          destination_decided_at: string | null
          destination_decided_by: string | null
          destination_reason: string | null
          destination_status: string
          ean: string | null
          erp_sync_adjustment_id: string | null
          expected_quantity: number | null
          id: string
          inspected_at: string | null
          inspected_by: string | null
          item_notes: string | null
          line_number: number
          lot_number: string | null
          original_packaging: boolean | null
          product_id: string | null
          received_quantity: number
          return_id: string
          serial_number: string | null
          sku: string | null
          suggested_destination: string | null
          suggested_destination_rule_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "return_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_items_release_quarantine: {
        Args: { p_hold_id: string; p_reason?: string }
        Returns: {
          block_reason: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          location: string | null
          pending_notes: string | null
          released_at: string | null
          released_by: string | null
          released_reason: string | null
          responsible: string | null
          return_item_id: string
          review_deadline: string | null
        }
        SetofOptions: {
          from: "*"
          to: "return_quarantine_holds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_items_request_approval: {
        Args: { p_approval_type: string; p_item_id: string; p_notes?: string }
        Returns: {
          approval_type: string
          company_id: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          id: string
          notes: string | null
          requested_at: string
          requested_by: string | null
          return_item_id: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "return_approval_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_items_set_inspection:
        | {
            Args: {
              p_checklist_accessories_complete: boolean
              p_checklist_apparently_functional: boolean
              p_checklist_correct_product: boolean
              p_checklist_no_visible_damage: boolean
              p_checklist_packaging_intact: boolean
              p_checklist_serial_matches: boolean
              p_checklist_signs_of_use: boolean
              p_classification: string
              p_item_id: string
              p_reason?: string
            }
            Returns: {
              accessories_received: string | null
              checklist_accessories_complete: boolean | null
              checklist_apparently_functional: boolean | null
              checklist_correct_product: boolean | null
              checklist_no_visible_damage: boolean | null
              checklist_packaging_intact: boolean | null
              checklist_serial_matches: boolean | null
              checklist_signs_of_use: boolean | null
              checklist_template_id: string | null
              checklist_template_version: number | null
              classification: string | null
              company_id: string
              condition_grade_id: string | null
              created_at: string
              current_location: string
              description: string
              destination: string | null
              destination_decided_at: string | null
              destination_decided_by: string | null
              destination_reason: string | null
              destination_status: string
              ean: string | null
              erp_sync_adjustment_id: string | null
              expected_quantity: number | null
              id: string
              inspected_at: string | null
              inspected_by: string | null
              item_notes: string | null
              line_number: number
              lot_number: string | null
              original_packaging: boolean | null
              product_id: string | null
              received_quantity: number
              return_id: string
              serial_number: string | null
              sku: string | null
              suggested_destination: string | null
              suggested_destination_rule_id: string | null
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "return_items"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_checklist_accessories_complete: boolean
              p_checklist_apparently_functional: boolean
              p_checklist_correct_product: boolean
              p_checklist_no_visible_damage: boolean
              p_checklist_packaging_intact: boolean
              p_checklist_serial_matches: boolean
              p_checklist_signs_of_use: boolean
              p_classification: string
              p_condition_grade_id?: string
              p_item_id: string
              p_reason?: string
            }
            Returns: {
              accessories_received: string | null
              checklist_accessories_complete: boolean | null
              checklist_apparently_functional: boolean | null
              checklist_correct_product: boolean | null
              checklist_no_visible_damage: boolean | null
              checklist_packaging_intact: boolean | null
              checklist_serial_matches: boolean | null
              checklist_signs_of_use: boolean | null
              checklist_template_id: string | null
              checklist_template_version: number | null
              classification: string | null
              company_id: string
              condition_grade_id: string | null
              created_at: string
              current_location: string
              description: string
              destination: string | null
              destination_decided_at: string | null
              destination_decided_by: string | null
              destination_reason: string | null
              destination_status: string
              ean: string | null
              erp_sync_adjustment_id: string | null
              expected_quantity: number | null
              id: string
              inspected_at: string | null
              inspected_by: string | null
              item_notes: string | null
              line_number: number
              lot_number: string | null
              original_packaging: boolean | null
              product_id: string | null
              received_quantity: number
              return_id: string
              serial_number: string | null
              sku: string | null
              suggested_destination: string | null
              suggested_destination_rule_id: string | null
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "return_items"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      return_service_orders_transition_status: {
        Args: { p_order_id: string; p_reason?: string; p_to_status: string }
        Returns: {
          company_id: string
          created_at: string
          created_by: string | null
          deadline: string | null
          defect_identified: string | null
          estimated_cost: number | null
          external_provider: string | null
          id: string
          location_internal: string | null
          parts_services_expected: string | null
          responsible: string | null
          result_notes: string | null
          return_item_id: string
          service_type: string
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "return_service_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      returns_create_from_nfe_xml: {
        Args: {
          p_customer_name?: string
          p_invoice_key: string
          p_items?: Json
          p_origin?: string
          p_origin_channel_connection_id?: string
          p_origin_source?: string
          p_original_nfe_invoice_id?: string
          p_raw_xml: string
          p_reason?: string
          p_xml_hash: string
        }
        Returns: {
          cancellation_reason: string | null
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          customer_name: string | null
          expected_quantity: number | null
          id: string
          linked_nfe_invoice_id: string | null
          linked_purchase_order_id: string | null
          linked_sale_id: string | null
          notes: string | null
          origin: string | null
          origin_channel_connection_id: string | null
          origin_source: string | null
          reason: string | null
          received_at: string
          received_by: string | null
          reference_value: string | null
          return_nfe_invoice_key: string | null
          return_nfe_raw_xml: string | null
          return_nfe_xml_hash: string | null
          source_type: string
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          unresolved: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "returns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      returns_transition_status: {
        Args: { p_reason?: string; p_return_id: string; p_to_status: string }
        Returns: {
          cancellation_reason: string | null
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          customer_name: string | null
          expected_quantity: number | null
          id: string
          linked_nfe_invoice_id: string | null
          linked_purchase_order_id: string | null
          linked_sale_id: string | null
          notes: string | null
          origin: string | null
          origin_channel_connection_id: string | null
          origin_source: string | null
          reason: string | null
          received_at: string
          received_by: string | null
          reference_value: string | null
          return_nfe_invoice_key: string | null
          return_nfe_raw_xml: string | null
          return_nfe_xml_hash: string | null
          source_type: string
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          unresolved: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "returns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      support_my_role_on: { Args: { p_ticket_id: string }; Returns: string }
      support_notifications_mark_read: {
        Args: { p_ids: string[] }
        Returns: number
      }
      support_notify: {
        Args: {
          p_audience: string
          p_kind: string
          p_message: string
          p_ticket_id: string
        }
        Returns: undefined
      }
      support_ticket_open: {
        Args: {
          p_attachments?: string[]
          p_body: string
          p_category: string
          p_channel: string
          p_context?: Json
          p_priority?: string
          p_subject: string
        }
        Returns: {
          category: string
          channel: string
          company_id: string
          context: Json
          created_at: string
          created_by: string
          first_response_at: string | null
          id: string
          priority: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "support_tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      support_ticket_reply: {
        Args: { p_attachments?: string[]; p_body: string; p_ticket_id: string }
        Returns: {
          attachments: string[]
          author_id: string
          body: string
          created_at: string
          id: string
          ticket_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_ticket_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      support_ticket_set_status: {
        Args: { p_status: string; p_ticket_id: string }
        Returns: {
          category: string
          channel: string
          company_id: string
          context: Json
          created_at: string
          created_by: string
          first_response_at: string | null
          id: string
          priority: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "support_tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      switch_active_company: {
        Args: { target_company_id: string }
        Returns: undefined
      }
      task_archive_my_assignment: {
        Args: { p_task_id: string }
        Returns: undefined
      }
      task_archive_my_done_eligible: { Args: never; Returns: number }
      task_block_my_status: {
        Args: {
          p_expected_resolver?: string
          p_note?: string
          p_reason: string
          p_task_id: string
        }
        Returns: undefined
      }
      task_bulk_assign: {
        Args: { p_assignee_ids: string[]; p_task_ids: string[] }
        Returns: undefined
      }
      task_cancel: {
        Args: { p_reason: string; p_task_id: string }
        Returns: undefined
      }
      task_close_open_time_segment: {
        Args: { p_assignee_id: string }
        Returns: undefined
      }
      task_create: {
        Args: {
          p_assignee_ids: string[]
          p_category: string
          p_checklist: string[]
          p_description: string
          p_due_date: string
          p_due_time: string
          p_priority: string
          p_title: string
          p_type: string
        }
        Returns: string
      }
      task_generate_due_soon_notifications: { Args: never; Returns: undefined }
      task_generate_overdue_notifications: { Args: never; Returns: undefined }
      task_is_visible_to_me: { Args: { p_task_id: string }; Returns: boolean }
      task_module_settings_upsert: {
        Args: {
          p_due_soon_threshold_minutes: number
          p_pause_note_required: boolean
        }
        Returns: undefined
      }
      task_open_time_segment: {
        Args: {
          p_assignee_id: string
          p_company_id: string
          p_segment_type: string
          p_task_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      task_pause_my_status: {
        Args: { p_note?: string; p_task_id: string }
        Returns: undefined
      }
      task_reopen: {
        Args: { p_reason: string; p_target_status?: string; p_task_id: string }
        Returns: undefined
      }
      task_restore_my_assignment: {
        Args: { p_task_id: string }
        Returns: undefined
      }
      task_resume_my_status: { Args: { p_task_id: string }; Returns: undefined }
      task_set_my_status: {
        Args: { p_status: string; p_task_id: string }
        Returns: undefined
      }
      task_set_priority: {
        Args: { p_priority: string; p_task_id: string }
        Returns: undefined
      }
      task_toggle_checklist_item: {
        Args: { p_is_done: boolean; p_item_id: string }
        Returns: undefined
      }
      task_unblock_status: {
        Args: { p_resume?: boolean; p_task_id: string; p_user_id?: string }
        Returns: undefined
      }
      task_update: {
        Args: {
          p_assignee_ids?: string[]
          p_category: string
          p_description: string
          p_due_date: string
          p_due_time: string
          p_priority: string
          p_task_id: string
          p_title: string
        }
        Returns: undefined
      }
      task_validate: {
        Args: { p_note?: string; p_task_id: string }
        Returns: undefined
      }
      update_member_role: {
        Args: { new_role: string; target_user_id: string }
        Returns: undefined
      }
      wms_bin_pick: {
        Args: {
          p_bin_code: string
          p_boxes: number
          p_product_id: string
          p_reason?: string
        }
        Returns: string
      }
      wms_bin_putaway: {
        Args: {
          p_bin_code: string
          p_boxes: number
          p_product_id: string
          p_reason?: string
          p_units_per_box: number
        }
        Returns: string
      }
      wms_bin_route_key: {
        Args: { p_code: string; p_serpentina?: boolean }
        Returns: string
      }
      wms_bin_transfer: {
        Args: {
          p_boxes: number
          p_from_bin_code: string
          p_product_id: string
          p_reason?: string
          p_to_bin_code: string
        }
        Returns: string
      }
      wms_expire_reservations: { Args: never; Returns: number }
      wms_pick_for_wave: {
        Args: {
          p_bin_code: string
          p_boxes: number
          p_owner_id: string
          p_owner_kind: string
          p_product_id: string
          p_reason?: string
        }
        Returns: string
      }
      wms_release_reservation: {
        Args: { p_owner_id: string; p_owner_kind: string; p_reason?: string }
        Returns: number
      }
      wms_release_reservation_line: {
        Args: { p_reason?: string; p_reservation_id: string }
        Returns: boolean
      }
      wms_require_operator: { Args: never; Returns: string }
      wms_reserve_stock: {
        Args: {
          p_bin_code: string
          p_boxes: number
          p_expires_at?: string
          p_owner_id: string
          p_owner_kind: string
          p_owner_ref?: string
          p_product_id: string
        }
        Returns: string
      }
      wms_resolve_bin: {
        Args: {
          p_code: string
          p_company: string
          p_require_unblocked: boolean
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
