// Generated from the isolated database after applying all migrations.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      account_deletion_requests: {
        Row: {
          affected_data_classes: string[]
          blocker_code: string | null
          completed_at: string | null
          id: string
          job_id: string | null
          next_action: string
          outcome: string
          policy_decisions_pending: string[]
          requested_at: string
          responsible_owner: string | null
          review_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          affected_data_classes?: string[]
          blocker_code?: string | null
          completed_at?: string | null
          id?: string
          job_id?: string | null
          next_action: string
          outcome: string
          policy_decisions_pending?: string[]
          requested_at?: string
          responsible_owner?: string | null
          review_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          affected_data_classes?: string[]
          blocker_code?: string | null
          completed_at?: string | null
          id?: string
          job_id?: string | null
          next_action?: string
          outcome?: string
          policy_decisions_pending?: string[]
          requested_at?: string
          responsible_owner?: string | null
          review_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "remediation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      account_emails: {
        Row: {
          created_at: string
          email: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      account_export_parts: {
        Row: {
          byte_count: number
          content_type: string
          created_at: string
          object_path: string
          page_number: number
          request_id: string
          row_count: number
          section_key: string
          sha256: string
        }
        Insert: {
          byte_count: number
          content_type?: string
          created_at?: string
          object_path: string
          page_number: number
          request_id: string
          row_count: number
          section_key: string
          sha256: string
        }
        Update: {
          byte_count?: number
          content_type?: string
          created_at?: string
          object_path?: string
          page_number?: number
          request_id?: string
          row_count?: number
          section_key?: string
          sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_export_parts_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "account_export_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      account_export_requests: {
        Row: {
          completed_at: string | null
          contract_version: string
          current_cursor: string | null
          current_offset: number
          current_section: number
          cutoff_at: string
          expires_at: string
          id: string
          last_error: string | null
          last_purge_attempt_at: string | null
          manifest: Json | null
          manifest_path: string | null
          purged_at: string | null
          requested_at: string
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          contract_version: string
          current_cursor?: string | null
          current_offset?: number
          current_section?: number
          cutoff_at?: string
          expires_at?: string
          id?: string
          last_error?: string | null
          last_purge_attempt_at?: string | null
          manifest?: Json | null
          manifest_path?: string | null
          purged_at?: string | null
          requested_at?: string
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          contract_version?: string
          current_cursor?: string | null
          current_offset?: number
          current_section?: number
          cutoff_at?: string
          expires_at?: string
          id?: string
          last_error?: string | null
          last_purge_attempt_at?: string | null
          manifest?: Json | null
          manifest_path?: string | null
          purged_at?: string | null
          requested_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      activity_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          post_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          post_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "activity_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_images: {
        Row: {
          alt: string | null
          created_at: string
          id: string
          position: number
          post_id: string
          url: string
        }
        Insert: {
          alt?: string | null
          created_at?: string
          id?: string
          position?: number
          post_id: string
          url: string
        }
        Update: {
          alt?: string | null
          created_at?: string
          id?: string
          position?: number
          post_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_images_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "activity_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_post_listings: {
        Row: {
          created_at: string
          listing_id: string
          position: number
          post_id: string
        }
        Insert: {
          created_at?: string
          listing_id: string
          position?: number
          post_id: string
        }
        Update: {
          created_at?: string
          listing_id?: string
          position?: number
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_post_listings_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_post_listings_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "activity_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_posts: {
        Row: {
          author_id: string
          body: Json
          car_id: string | null
          created_at: string
          draft_archived_at: string | null
          draft_key: string | null
          id: string
          intro: string | null
          publish_operation_id: string | null
          published_at: string | null
          search_text: string | null
          title: string | null
          updated_at: string
          video_url: string | null
        }
        Insert: {
          author_id: string
          body?: Json
          car_id?: string | null
          created_at?: string
          draft_archived_at?: string | null
          draft_key?: string | null
          id?: string
          intro?: string | null
          publish_operation_id?: string | null
          published_at?: string | null
          search_text?: string | null
          title?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          author_id?: string
          body?: Json
          car_id?: string | null
          created_at?: string
          draft_archived_at?: string | null
          draft_key?: string | null
          id?: string
          intro?: string | null
          publish_operation_id?: string | null
          published_at?: string | null
          search_text?: string | null
          title?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_posts_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_reactions: {
        Row: {
          created_at: string
          emoji: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "activity_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_alert_outbox: {
        Row: {
          amount_cents: number | null
          attempts: number
          created_at: string
          dedup_key: string | null
          delivered_at: string | null
          detail: string | null
          id: string
          kind: string
          last_error: string | null
          next_attempt_at: string
          order_id: string | null
          payload: Json
          status: string
          title: string
        }
        Insert: {
          amount_cents?: number | null
          attempts?: number
          created_at?: string
          dedup_key?: string | null
          delivered_at?: string | null
          detail?: string | null
          id?: string
          kind: string
          last_error?: string | null
          next_attempt_at?: string
          order_id?: string | null
          payload?: Json
          status?: string
          title: string
        }
        Update: {
          amount_cents?: number | null
          attempts?: number
          created_at?: string
          dedup_key?: string | null
          delivered_at?: string | null
          detail?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          next_attempt_at?: string
          order_id?: string | null
          payload?: Json
          status?: string
          title?: string
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: number
          metadata: Json
          order_id: string | null
          reason: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: never
          metadata?: Json
          order_id?: string | null
          reason: string
          subject_id: string
          subject_type: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: never
          metadata?: Json
          order_id?: string | null
          reason?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_users: {
        Row: {
          created_at: string
          mfa_confirmed_at: string | null
          mfa_confirmed_by: string | null
          mfa_factor_id: string | null
          note: string | null
          role: string
          sessions_valid_after: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          mfa_confirmed_at?: string | null
          mfa_confirmed_by?: string | null
          mfa_factor_id?: string | null
          note?: string | null
          role?: string
          sessions_valid_after?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          mfa_confirmed_at?: string | null
          mfa_confirmed_by?: string | null
          mfa_factor_id?: string | null
          note?: string | null
          role?: string
          sessions_valid_after?: string | null
          user_id?: string
        }
        Relationships: []
      }
      agent_approvals: {
        Row: {
          amount_cents: number | null
          created_at: string
          decided_at: string | null
          id: string
          kind: string
          offer_id: string | null
          owner_id: string
          reason: string | null
          round_no: number | null
          status: string
          task_id: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          decided_at?: string | null
          id?: string
          kind: string
          offer_id?: string | null
          owner_id: string
          reason?: string | null
          round_no?: number | null
          status?: string
          task_id: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          decided_at?: string | null
          id?: string
          kind?: string
          offer_id?: string | null
          owner_id?: string
          reason?: string | null
          round_no?: number | null
          status?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_approvals_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_approvals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_approvals_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_beta_steps: {
        Row: {
          changed_at: string
          changed_by: string | null
          open: boolean
          reason: string | null
          step: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          open?: boolean
          reason?: string | null
          step: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          open?: boolean
          reason?: string | null
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_beta_steps_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_chat_requests: {
        Row: {
          created_at: string
          member_message_id: string | null
          owner_id: string
          reply_message_id: string | null
          request_id: string
        }
        Insert: {
          created_at?: string
          member_message_id?: string | null
          owner_id: string
          reply_message_id?: string | null
          request_id: string
        }
        Update: {
          created_at?: string
          member_message_id?: string | null
          owner_id?: string
          reply_message_id?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_chat_requests_member_message_id_fkey"
            columns: ["member_message_id"]
            isOneToOne: false
            referencedRelation: "agent_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_chat_requests_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_chat_requests_reply_message_id_fkey"
            columns: ["reply_message_id"]
            isOneToOne: false
            referencedRelation: "agent_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_controls: {
        Row: {
          cleared_at: string | null
          cleared_by: string | null
          id: string
          reason: string
          scope: string
          set_at: string
          set_by: string | null
          subject_id: string | null
        }
        Insert: {
          cleared_at?: string | null
          cleared_by?: string | null
          id?: string
          reason: string
          scope: string
          set_at?: string
          set_by?: string | null
          subject_id?: string | null
        }
        Update: {
          cleared_at?: string | null
          cleared_by?: string | null
          id?: string
          reason?: string
          scope?: string
          set_at?: string
          set_by?: string | null
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_controls_cleared_by_fkey"
            columns: ["cleared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_controls_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_events: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string | null
          initiated_by: string | null
          inputs: Json
          job_id: string | null
          kind: string
          mandate_id: string | null
          mandate_version: number | null
          owner_id: string
          result: Json
          task_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key?: string | null
          initiated_by?: string | null
          inputs?: Json
          job_id?: string | null
          kind: string
          mandate_id?: string | null
          mandate_version?: number | null
          owner_id: string
          result?: Json
          task_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string | null
          initiated_by?: string | null
          inputs?: Json
          job_id?: string | null
          kind?: string
          mandate_id?: string | null
          mandate_version?: number | null
          owner_id?: string
          result?: Json
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "agent_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "agent_mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_jobs: {
        Row: {
          attempts: number
          available_at: string
          created_at: string
          dedup_key: string
          expected_action: string
          finished_at: string | null
          id: string
          kind: string
          last_error: string | null
          lease_expires_at: string | null
          lease_id: string | null
          listing_id: string
          max_attempts: number
          offer_id: string | null
          round_no: number | null
          status: string
          task_id: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          created_at?: string
          dedup_key: string
          expected_action: string
          finished_at?: string | null
          id?: string
          kind: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_id?: string | null
          listing_id: string
          max_attempts?: number
          offer_id?: string | null
          round_no?: number | null
          status?: string
          task_id: string
        }
        Update: {
          attempts?: number
          available_at?: string
          created_at?: string
          dedup_key?: string
          expected_action?: string
          finished_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_id?: string | null
          listing_id?: string
          max_attempts?: number
          offer_id?: string | null
          round_no?: number | null
          status?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_jobs_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_mandate_versions: {
        Row: {
          ceiling_basis: string | null
          ceiling_cents: number | null
          created_at: string
          expires_at: string | null
          mandate_id: string
          minimum_cents: number | null
          owner_id: string
          status: string
          style: string
          target_cents: number | null
          version: number
        }
        Insert: {
          ceiling_basis?: string | null
          ceiling_cents?: number | null
          created_at?: string
          expires_at?: string | null
          mandate_id: string
          minimum_cents?: number | null
          owner_id: string
          status: string
          style: string
          target_cents?: number | null
          version: number
        }
        Update: {
          ceiling_basis?: string | null
          ceiling_cents?: number | null
          created_at?: string
          expires_at?: string | null
          mandate_id?: string
          minimum_cents?: number | null
          owner_id?: string
          status?: string
          style?: string
          target_cents?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_mandate_versions_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "agent_mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_mandate_versions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_mandates: {
        Row: {
          binding_acknowledged_at: string | null
          ceiling_basis: string | null
          ceiling_cents: number | null
          created_at: string
          ended_at: string | null
          expires_at: string | null
          id: string
          listing_id: string
          minimum_cents: number | null
          owner_id: string
          scope: string
          status: string
          style: string
          target_cents: number | null
          updated_at: string
          version: number
        }
        Insert: {
          binding_acknowledged_at?: string | null
          ceiling_basis?: string | null
          ceiling_cents?: number | null
          created_at?: string
          ended_at?: string | null
          expires_at?: string | null
          id?: string
          listing_id: string
          minimum_cents?: number | null
          owner_id: string
          scope: string
          status?: string
          style?: string
          target_cents?: number | null
          updated_at?: string
          version?: number
        }
        Update: {
          binding_acknowledged_at?: string | null
          ceiling_basis?: string | null
          ceiling_cents?: number | null
          created_at?: string
          ended_at?: string | null
          expires_at?: string | null
          id?: string
          listing_id?: string
          minimum_cents?: number | null
          owner_id?: string
          scope?: string
          status?: string
          style?: string
          target_cents?: number | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_mandates_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_mandates_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          body: string
          cards: Json
          conversation_id: string
          created_at: string
          id: string
          images: string[]
          owner_id: string
          role: string
          task_id: string | null
        }
        Insert: {
          body: string
          cards?: Json
          conversation_id: string
          created_at?: string
          id?: string
          images?: string[]
          owner_id: string
          role: string
          task_id?: string | null
        }
        Update: {
          body?: string
          cards?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          images?: string[]
          owner_id?: string
          role?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_metrics_daily: {
        Row: {
          computed_at: string
          day: string
          measure: string
          sample: number
          scope: string
          value: number | null
        }
        Insert: {
          computed_at?: string
          day: string
          measure: string
          sample: number
          scope: string
          value?: number | null
        }
        Update: {
          computed_at?: string
          day?: string
          measure?: string
          sample?: number
          scope?: string
          value?: number | null
        }
        Relationships: []
      }
      agent_spend_holds: {
        Row: {
          amount_usd: number
          created_at: string
          feature: string
          id: string
          owner_id: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          feature: string
          id?: string
          owner_id: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          feature?: string
          id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_spend_holds_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_spend_limits: {
        Row: {
          changed_at: string
          changed_by: string | null
          global_daily_usd: number
          per_member_daily_usd: number
          singleton: boolean
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          global_daily_usd?: number
          per_member_daily_usd?: number
          singleton?: boolean
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          global_daily_usd?: number
          per_member_daily_usd?: number
          singleton?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "agent_spend_limits_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tasks: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          listing_id: string | null
          mandate_id: string | null
          objective: string
          offer_id: string | null
          outcome: string | null
          owner_id: string
          scope: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          listing_id?: string | null
          mandate_id?: string | null
          objective: string
          offer_id?: string | null
          outcome?: string | null
          owner_id: string
          scope: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          listing_id?: string | null
          mandate_id?: string | null
          objective?: string
          offer_id?: string | null
          outcome?: string | null
          owner_id?: string
          scope?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tasks_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tasks_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "agent_mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tasks_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tasks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_telemetry: {
        Row: {
          code: string | null
          created_at: string
          id: number
          job_id: string | null
          kind: string
          owner_id: string | null
          task_id: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: never
          job_id?: string | null
          kind: string
          owner_id?: string | null
          task_id?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: never
          job_id?: string | null
          kind?: string
          owner_id?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_telemetry_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "agent_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_telemetry_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_telemetry_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_usage: {
        Row: {
          cost_usd: number | null
          created_at: string
          feature: string
          id: number
          input_tokens: number
          model: string
          output_tokens: number
          owner_id: string | null
          task_id: string | null
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          feature: string
          id?: never
          input_tokens: number
          model: string
          output_tokens: number
          owner_id?: string | null
          task_id?: string | null
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          feature?: string
          id?: never
          input_tokens?: number
          model?: string
          output_tokens?: number
          owner_id?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_usage_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_usage_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_consents: {
        Row: {
          allowed: boolean
          expires_at: string
          user_id: string
          version: string
        }
        Insert: {
          allowed?: boolean
          expires_at?: string
          user_id: string
          version?: string
        }
        Update: {
          allowed?: boolean
          expires_at?: string
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_access_config: {
        Row: {
          enforced: boolean
          singleton: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enforced: boolean
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enforced?: boolean
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      beta_invitations: {
        Row: {
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
          created_by: string | null
          email_normalized: string
          expires_at: string
          id: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          roles: string[]
          token_hash: string
        }
        Insert: {
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string | null
          email_normalized: string
          expires_at: string
          id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          roles?: string[]
          token_hash: string
        }
        Update: {
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string | null
          email_normalized?: string
          expires_at?: string
          id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          roles?: string[]
          token_hash?: string
        }
        Relationships: []
      }
      beta_memberships: {
        Row: {
          email_normalized: string
          invitation_id: string
          joined_at: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          roles: string[]
          user_id: string
        }
        Insert: {
          email_normalized: string
          invitation_id: string
          joined_at?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          roles: string[]
          user_id: string
        }
        Update: {
          email_normalized?: string
          invitation_id?: string
          joined_at?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          roles?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_memberships_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: true
            referencedRelation: "beta_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      capture_checks: {
        Row: {
          next_attempt_at: string
          reference: string
        }
        Insert: {
          next_attempt_at?: string
          reference: string
        }
        Update: {
          next_attempt_at?: string
          reference?: string
        }
        Relationships: []
      }
      car_hotspots: {
        Row: {
          car_id: string
          created_at: string
          id: string
          image_url: string
          label: string
          mod_item_id: string | null
          x: number
          y: number
        }
        Insert: {
          car_id: string
          created_at?: string
          id?: string
          image_url: string
          label: string
          mod_item_id?: string | null
          x: number
          y: number
        }
        Update: {
          car_id?: string
          created_at?: string
          id?: string
          image_url?: string
          label?: string
          mod_item_id?: string | null
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "car_hotspots_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_hotspots_mod_item_id_fkey"
            columns: ["mod_item_id"]
            isOneToOne: false
            referencedRelation: "mod_items"
            referencedColumns: ["id"]
          },
        ]
      }
      car_images: {
        Row: {
          alt: string | null
          car_id: string
          created_at: string
          id: string
          position: number
          url: string
        }
        Insert: {
          alt?: string | null
          car_id: string
          created_at?: string
          id?: string
          position?: number
          url: string
        }
        Update: {
          alt?: string | null
          car_id?: string
          created_at?: string
          id?: string
          position?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_images_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      cars: {
        Row: {
          about: string | null
          body_class: string | null
          catalog_make_id: number | null
          catalog_model_id: number | null
          color: string | null
          cover_focal_x: number | null
          cover_focal_y: number | null
          cover_image_url: string | null
          created_at: string
          drivetrain: string | null
          engine: string | null
          generation_id: number | null
          generation_source: string | null
          id: string
          identity_source: string | null
          is_public: boolean
          make: string | null
          make_key: string | null
          model: string | null
          model_key: string | null
          name: string
          owner_id: string
          slug: string
          tags: string[]
          trim: string | null
          updated_at: string
          vin: string | null
          vin_decoded_at: string | null
          year: number | null
        }
        Insert: {
          about?: string | null
          body_class?: string | null
          catalog_make_id?: number | null
          catalog_model_id?: number | null
          color?: string | null
          cover_focal_x?: number | null
          cover_focal_y?: number | null
          cover_image_url?: string | null
          created_at?: string
          drivetrain?: string | null
          engine?: string | null
          generation_id?: number | null
          generation_source?: string | null
          id?: string
          identity_source?: string | null
          is_public?: boolean
          make?: string | null
          make_key?: string | null
          model?: string | null
          model_key?: string | null
          name: string
          owner_id: string
          slug: string
          tags?: string[]
          trim?: string | null
          updated_at?: string
          vin?: string | null
          vin_decoded_at?: string | null
          year?: number | null
        }
        Update: {
          about?: string | null
          body_class?: string | null
          catalog_make_id?: number | null
          catalog_model_id?: number | null
          color?: string | null
          cover_focal_x?: number | null
          cover_focal_y?: number | null
          cover_image_url?: string | null
          created_at?: string
          drivetrain?: string | null
          engine?: string | null
          generation_id?: number | null
          generation_source?: string | null
          id?: string
          identity_source?: string | null
          is_public?: boolean
          make?: string | null
          make_key?: string | null
          model?: string | null
          model_key?: string | null
          name?: string
          owner_id?: string
          slug?: string
          tags?: string[]
          trim?: string | null
          updated_at?: string
          vin?: string | null
          vin_decoded_at?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cars_catalog_make_id_fkey"
            columns: ["catalog_make_id"]
            isOneToOne: false
            referencedRelation: "catalog_makes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cars_catalog_model_id_fkey"
            columns: ["catalog_model_id"]
            isOneToOne: false
            referencedRelation: "catalog_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cars_generation_id_fkey"
            columns: ["generation_id"]
            isOneToOne: false
            referencedRelation: "vehicle_generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cars_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_makes: {
        Row: {
          created_at: string
          id: number
          name: string
          popularity_decile: number | null
          slug: string | null
          source: string
          source_version: string | null
          updated_at: string
          vdb_id: string | null
          vpic_make_id: number | null
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          popularity_decile?: number | null
          slug?: string | null
          source?: string
          source_version?: string | null
          updated_at?: string
          vdb_id?: string | null
          vpic_make_id?: number | null
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          popularity_decile?: number | null
          slug?: string | null
          source?: string
          source_version?: string | null
          updated_at?: string
          vdb_id?: string | null
          vpic_make_id?: number | null
        }
        Relationships: []
      }
      catalog_models: {
        Row: {
          aliases: string[] | null
          created_at: string
          id: number
          make_id: number
          name: string
          popularity_decile: number | null
          source: string
          source_version: string | null
          updated_at: string
          vdb_id: string | null
        }
        Insert: {
          aliases?: string[] | null
          created_at?: string
          id?: never
          make_id: number
          name: string
          popularity_decile?: number | null
          source?: string
          source_version?: string | null
          updated_at?: string
          vdb_id?: string | null
        }
        Update: {
          aliases?: string[] | null
          created_at?: string
          id?: never
          make_id?: number
          name?: string
          popularity_decile?: number | null
          source?: string
          source_version?: string | null
          updated_at?: string
          vdb_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_models_make_id_fkey"
            columns: ["make_id"]
            isOneToOne: false
            referencedRelation: "catalog_makes"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_unreads: {
        Row: {
          conversation_id: string
          unread_count: number
          user_id: string
        }
        Insert: {
          conversation_id: string
          unread_count?: number
          user_id: string
        }
        Update: {
          conversation_id?: string
          unread_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_unreads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_unreads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          last_message_id: string | null
          last_message_preview: string | null
          participant_a: string
          participant_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_id?: string | null
          last_message_preview?: string | null
          participant_a: string
          participant_b: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_id?: string | null
          last_message_preview?: string | null
          participant_a?: string
          participant_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_participant_a_fkey"
            columns: ["participant_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_participant_b_fkey"
            columns: ["participant_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_storage_tasks: {
        Row: {
          bucket: string
          folder: boolean
          job_id: string
          page_offset: number
          path: string
          status: string
        }
        Insert: {
          bucket: string
          folder: boolean
          job_id: string
          page_offset?: number
          path: string
          status?: string
        }
        Update: {
          bucket?: string
          folder?: boolean
          job_id?: string
          page_offset?: number
          path?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "deletion_storage_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "remediation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_auto_confirmations: {
        Row: {
          after_days: number
          confirm_at: string
          confirmed_at: string | null
          email_attempts: number
          email_last_error: string | null
          emailed_at: string | null
          last_error: string | null
          order_id: string
          reminded_at: string
        }
        Insert: {
          after_days: number
          confirm_at: string
          confirmed_at?: string | null
          email_attempts?: number
          email_last_error?: string | null
          emailed_at?: string | null
          last_error?: string | null
          order_id: string
          reminded_at?: string
        }
        Update: {
          after_days?: number
          confirm_at?: string
          confirmed_at?: string | null
          email_attempts?: number
          email_last_error?: string | null
          emailed_at?: string | null
          last_error?: string | null
          order_id?: string
          reminded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_auto_confirmations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dispute_evidence: {
        Row: {
          created_at: string
          id: string
          note: string | null
          order_id: string
          storage_path: string | null
          uploader_id: string | null
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          order_id: string
          storage_path?: string | null
          uploader_id?: string | null
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string
          storage_path?: string | null
          uploader_id?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispute_evidence_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_evidence_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      explore_builder_rankings: {
        Row: {
          car_count: number
          profile_id: string
          rank: number
          update_count: number
        }
        Insert: {
          car_count: number
          profile_id: string
          rank: number
          update_count: number
        }
        Update: {
          car_count?: number
          profile_id?: string
          rank?: number
          update_count?: number
        }
        Relationships: []
      }
      explore_trending_models: {
        Row: {
          builds: number
          catalog_make_id: number | null
          catalog_model_id: number | null
          make: string
          model: string
          rank: number
          updates: number
        }
        Insert: {
          builds: number
          catalog_make_id?: number | null
          catalog_model_id?: number | null
          make: string
          model: string
          rank: number
          updates: number
        }
        Update: {
          builds?: number
          catalog_make_id?: number | null
          catalog_model_id?: number | null
          make?: string
          model?: string
          rank?: number
          updates?: number
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          follower_id: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      ledger_reconciliation_runs: {
        Row: {
          checked: Json
          detail: string | null
          discrepancies: number
          finished_at: string | null
          id: string
          started_at: string
          status: string
          window_end: string
          window_start: string
        }
        Insert: {
          checked?: Json
          detail?: string | null
          discrepancies?: number
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          window_end: string
          window_start: string
        }
        Update: {
          checked?: Json
          detail?: string | null
          discrepancies?: number
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      likes: {
        Row: {
          created_at: string
          target_id: string
          target_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          target_id: string
          target_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          target_id?: string
          target_type?: string
          user_id?: string
        }
        Relationships: []
      }
      listing_fitments: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          make: string
          model: string
          year_end: number | null
          year_start: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          make: string
          model: string
          year_end?: number | null
          year_start?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          make?: string
          model?: string
          year_end?: number | null
          year_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_fitments_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_images: {
        Row: {
          alt: string | null
          created_at: string
          id: string
          listing_id: string
          position: number
          url: string
        }
        Insert: {
          alt?: string | null
          created_at?: string
          id?: string
          listing_id: string
          position?: number
          url: string
        }
        Update: {
          alt?: string | null
          created_at?: string
          id?: string
          listing_id?: string
          position?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_images_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_imports: {
        Row: {
          attempts: number
          canonical_url: string | null
          completed_at: string | null
          consumed_at: string | null
          created_at: string
          error_code: string | null
          error_detail: string | null
          expires_at: string
          extracted: Json | null
          id: string
          imported_images: Json | null
          lease_expires_at: string | null
          listing_id: string | null
          normalized_source: Json | null
          selected_item: number | null
          source_adapter: string | null
          source_domain: string | null
          source_mode: string
          source_url: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          canonical_url?: string | null
          completed_at?: string | null
          consumed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          expires_at?: string
          extracted?: Json | null
          id?: string
          imported_images?: Json | null
          lease_expires_at?: string | null
          listing_id?: string | null
          normalized_source?: Json | null
          selected_item?: number | null
          source_adapter?: string | null
          source_domain?: string | null
          source_mode: string
          source_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          canonical_url?: string | null
          completed_at?: string | null
          consumed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          expires_at?: string
          extracted?: Json | null
          id?: string
          imported_images?: Json | null
          lease_expires_at?: string | null
          listing_id?: string | null
          normalized_source?: Json | null
          selected_item?: number | null
          source_adapter?: string | null
          source_domain?: string | null
          source_mode?: string
          source_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_imports_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_imports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_part_numbers: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          number: string
          number_compact: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          number: string
          number_compact?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          number?: string
          number_compact?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_part_numbers_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_private_terms: {
        Row: {
          listing_id: string
          offer_floor_cents: number | null
          seller_id: string
          updated_at: string
        }
        Insert: {
          listing_id: string
          offer_floor_cents?: number | null
          seller_id: string
          updated_at?: string
        }
        Update: {
          listing_id?: string
          offer_floor_cents?: number | null
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_private_terms_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_private_terms_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_questions: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          listing_id: string
          parent_id: string | null
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          listing_id: string
          parent_id?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          listing_id?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_questions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_questions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_questions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "listing_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_vehicle_fit: {
        Row: {
          all_years: boolean
          car_owner_id: string | null
          car_public: boolean
          listing_id: string
          make_key: string
          model_key: string
          price_cents: number
          published_at: string
          seller_id: string
          stated_also: boolean
          via: string
          years: unknown
        }
        Insert: {
          all_years?: boolean
          car_owner_id?: string | null
          car_public?: boolean
          listing_id: string
          make_key: string
          model_key: string
          price_cents: number
          published_at: string
          seller_id: string
          stated_also?: boolean
          via: string
          years?: unknown
        }
        Update: {
          all_years?: boolean
          car_owner_id?: string | null
          car_public?: boolean
          listing_id?: string
          make_key?: string
          model_key?: string
          price_cents?: number
          published_at?: string
          seller_id?: string
          stated_also?: boolean
          via?: string
          years?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "listing_vehicle_fit_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_view_arrivals: {
        Row: {
          arrival: string
          day: string
          listing_id: string
          views: number
        }
        Insert: {
          arrival: string
          day: string
          listing_id: string
          views?: number
        }
        Update: {
          arrival?: string
          day?: string
          listing_id?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "listing_view_arrivals_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          allows_collection: boolean
          brand: string | null
          brand_key: string | null
          category: string
          compatibility_notes: string | null
          condition: string | null
          condition_checklist: Json | null
          created_at: string
          currency: string
          description: string | null
          grade: string | null
          height_in: number | null
          id: string
          length_in: number | null
          location: string | null
          part_miles: number | null
          part_miles_unit: string | null
          part_number: string | null
          part_number_compact: string | null
          price_cents: number
          published_at: string | null
          published_xact: number | null
          removed_at: string | null
          removed_reason: string | null
          reserved_until: string | null
          seller_id: string
          shipping_cents: number
          shipping_mode: string
          show_offer_floor: boolean
          sold_at: string | null
          source_car_id: string | null
          status: string
          subcategory: string | null
          title: string
          updated_at: string
          view_count: number
          weight_oz: number | null
          width_in: number | null
        }
        Insert: {
          allows_collection?: boolean
          brand?: string | null
          brand_key?: string | null
          category: string
          compatibility_notes?: string | null
          condition?: string | null
          condition_checklist?: Json | null
          created_at?: string
          currency?: string
          description?: string | null
          grade?: string | null
          height_in?: number | null
          id?: string
          length_in?: number | null
          location?: string | null
          part_miles?: number | null
          part_miles_unit?: string | null
          part_number?: string | null
          part_number_compact?: string | null
          price_cents: number
          published_at?: string | null
          published_xact?: number | null
          removed_at?: string | null
          removed_reason?: string | null
          reserved_until?: string | null
          seller_id: string
          shipping_cents?: number
          shipping_mode?: string
          show_offer_floor?: boolean
          sold_at?: string | null
          source_car_id?: string | null
          status?: string
          subcategory?: string | null
          title: string
          updated_at?: string
          view_count?: number
          weight_oz?: number | null
          width_in?: number | null
        }
        Update: {
          allows_collection?: boolean
          brand?: string | null
          brand_key?: string | null
          category?: string
          compatibility_notes?: string | null
          condition?: string | null
          condition_checklist?: Json | null
          created_at?: string
          currency?: string
          description?: string | null
          grade?: string | null
          height_in?: number | null
          id?: string
          length_in?: number | null
          location?: string | null
          part_miles?: number | null
          part_miles_unit?: string | null
          part_number?: string | null
          part_number_compact?: string | null
          price_cents?: number
          published_at?: string | null
          published_xact?: number | null
          removed_at?: string | null
          removed_reason?: string | null
          reserved_until?: string | null
          seller_id?: string
          shipping_cents?: number
          shipping_mode?: string
          show_offer_floor?: boolean
          sold_at?: string | null
          source_car_id?: string | null
          status?: string
          subcategory?: string | null
          title?: string
          updated_at?: string
          view_count?: number
          weight_oz?: number | null
          width_in?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_source_car_id_fkey"
            columns: ["source_car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_facet_counts: {
        Row: {
          facet: string
          key: string
          subkey: string
          total: number
        }
        Insert: {
          facet: string
          key: string
          subkey?: string
          total: number
        }
        Update: {
          facet?: string
          key?: string
          subkey?: string
          total?: number
        }
        Relationships: []
      }
      media_cleanup_queue: {
        Row: {
          attempts: number
          bucket: string
          enqueued_at: string
          generation: string
          last_error: string | null
          next_attempt_at: string
          owner_id: string
          path: string
          reason: string
        }
        Insert: {
          attempts?: number
          bucket: string
          enqueued_at?: string
          generation?: string
          last_error?: string | null
          next_attempt_at?: string
          owner_id: string
          path: string
          reason: string
        }
        Update: {
          attempts?: number
          bucket?: string
          enqueued_at?: string
          generation?: string
          last_error?: string | null
          next_attempt_at?: string
          owner_id?: string
          path?: string
          reason?: string
        }
        Relationships: []
      }
      member_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: string[]
          body: string
          conversation_id: string | null
          created_at: string
          id: string
          kind: string
          listing_id: string | null
          offer_id: string | null
          order_id: string | null
          read_at: string | null
          recipient_id: string
          sender_id: string
        }
        Insert: {
          attachments?: string[]
          body: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          listing_id?: string | null
          offer_id?: string | null
          order_id?: string | null
          read_at?: string | null
          recipient_id: string
          sender_id: string
        }
        Update: {
          attachments?: string[]
          body?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          listing_id?: string | null
          offer_id?: string | null
          order_id?: string | null
          read_at?: string | null
          recipient_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mod_items: {
        Row: {
          brand: string | null
          brand_key: string | null
          car_id: string
          category: string | null
          confidence: number | null
          created_at: string
          group_label: string
          id: string
          image_url: string | null
          linked_listing_id: string | null
          origin: string
          part_number: string | null
          part_number_compact: string | null
          position: number
          product: string | null
          product_url: string | null
          raw_text: string | null
          ref_price_cents: number | null
          ref_price_currency: string | null
          removed_at: string | null
          source_domain: string | null
          source_order_item_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          brand?: string | null
          brand_key?: string | null
          car_id: string
          category?: string | null
          confidence?: number | null
          created_at?: string
          group_label?: string
          id?: string
          image_url?: string | null
          linked_listing_id?: string | null
          origin?: string
          part_number?: string | null
          part_number_compact?: string | null
          position?: number
          product?: string | null
          product_url?: string | null
          raw_text?: string | null
          ref_price_cents?: number | null
          ref_price_currency?: string | null
          removed_at?: string | null
          source_domain?: string | null
          source_order_item_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          brand?: string | null
          brand_key?: string | null
          car_id?: string
          category?: string | null
          confidence?: number | null
          created_at?: string
          group_label?: string
          id?: string
          image_url?: string | null
          linked_listing_id?: string | null
          origin?: string
          part_number?: string | null
          part_number_compact?: string | null
          position?: number
          product?: string | null
          product_url?: string | null
          raw_text?: string | null
          ref_price_cents?: number | null
          ref_price_currency?: string | null
          removed_at?: string | null
          source_domain?: string | null
          source_order_item_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mod_items_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mod_items_linked_listing_id_fkey"
            columns: ["linked_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mod_items_source_order_item_id_fkey"
            columns: ["source_order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string | null
          created_at: string
          href: string | null
          id: string
          kind: string
          read_at: string | null
          section: string
          target_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          href?: string | null
          id?: string
          kind: string
          read_at?: string | null
          section: string
          target_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          href?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          section?: string
          target_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_round_terms: {
        Row: {
          buyer_ceiling_cents: number | null
          created_at: string
          effective_floor_cents: number | null
          round_id: string
        }
        Insert: {
          buyer_ceiling_cents?: number | null
          created_at?: string
          effective_floor_cents?: number | null
          round_id: string
        }
        Update: {
          buyer_ceiling_cents?: number | null
          created_at?: string
          effective_floor_cents?: number | null
          round_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_round_terms_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: true
            referencedRelation: "offer_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_rounds: {
        Row: {
          actor_job_id: string | null
          actor_member_id: string | null
          actor_role: string
          actor_task_id: string | null
          amount_cents: number | null
          buyer_id: string
          created_at: string
          expires_at: string | null
          id: string
          idempotency_key: string | null
          kind: string
          listing_id: string
          mandate_version: number | null
          offer_id: string
          round_no: number
        }
        Insert: {
          actor_job_id?: string | null
          actor_member_id?: string | null
          actor_role: string
          actor_task_id?: string | null
          amount_cents?: number | null
          buyer_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          kind: string
          listing_id: string
          mandate_version?: number | null
          offer_id: string
          round_no: number
        }
        Update: {
          actor_job_id?: string | null
          actor_member_id?: string | null
          actor_role?: string
          actor_task_id?: string | null
          amount_cents?: number | null
          buyer_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: string
          listing_id?: string
          mandate_version?: number | null
          offer_id?: string
          round_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "offer_rounds_actor_job_id_fkey"
            columns: ["actor_job_id"]
            isOneToOne: false
            referencedRelation: "agent_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_rounds_actor_member_id_fkey"
            columns: ["actor_member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_rounds_actor_task_id_fkey"
            columns: ["actor_task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_rounds_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_rounds_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_rounds_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          amount_cents: number
          buyer_id: string
          counter_amount_cents: number | null
          countered_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          last_round_id: string | null
          listing_id: string
          responded_at: string | null
          round_count: number
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          buyer_id: string
          counter_amount_cents?: number | null
          countered_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_round_id?: string | null
          listing_id: string
          responded_at?: string | null
          round_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          buyer_id?: string
          counter_amount_cents?: number | null
          countered_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_round_id?: string | null
          listing_id?: string
          responded_at?: string | null
          round_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_last_round_id_fkey"
            columns: ["last_round_id"]
            isOneToOne: false
            referencedRelation: "offer_rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_cases: {
        Row: {
          assigned_to: string | null
          id: string
          kind: string
          labels: string[]
          opened_at: string
          order_id: string | null
          priority: string
          report_id: string | null
          resolved_at: string | null
          status: string
          summary: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          id?: string
          kind: string
          labels?: string[]
          opened_at?: string
          order_id?: string | null
          priority?: string
          report_id?: string | null
          resolved_at?: string | null
          status?: string
          summary?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          id?: string
          kind?: string
          labels?: string[]
          opened_at?: string
          order_id?: string | null
          priority?: string
          report_id?: string | null
          resolved_at?: string | null
          status?: string
          summary?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_cases_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_cases_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_snapshot_images: {
        Row: {
          alt: string | null
          created_at: string
          id: string
          order_item_id: string
          position: number
          url: string
        }
        Insert: {
          alt?: string | null
          created_at?: string
          id?: string
          order_item_id: string
          position?: number
          url: string
        }
        Update: {
          alt?: string | null
          created_at?: string
          id?: string
          order_item_id?: string
          position?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_snapshot_images_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          commercial_snapshot: Json
          condition_snapshot: Json | null
          id: string
          listing_id: string | null
          order_id: string
          price_cents: number
          quantity: number
          shipping_cents: number
          snapshot_version: number
          title: string | null
        }
        Insert: {
          commercial_snapshot: Json
          condition_snapshot?: Json | null
          id?: string
          listing_id?: string | null
          order_id: string
          price_cents: number
          quantity?: number
          shipping_cents?: number
          snapshot_version?: number
          title?: string | null
        }
        Update: {
          commercial_snapshot?: Json
          condition_snapshot?: Json | null
          id?: string
          listing_id?: string | null
          order_id?: string
          price_cents?: number
          quantity?: number
          shipping_cents?: number
          snapshot_version?: number
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          accepted_checkout_shipping: Json | null
          analytics_consent_version: string | null
          buyer_id: string | null
          buyer_label: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          carrier: string | null
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          currency: string
          delivered_at: string | null
          dispute_category: string | null
          dispute_escalated_at: string | null
          dispute_escalated_by: string | null
          dispute_outcome: string | null
          dispute_reason: string | null
          dispute_resolved_at: string | null
          dispute_sla_alerted_at: string | null
          disputed_at: string | null
          disputed_by: string | null
          id: string
          is_collection: boolean
          origin_offer_id: string | null
          pickup_ready_at: string | null
          platform_fee_cents: number
          platform_fee_refunded_cents: number
          pre_dispute_status: string | null
          refund_offer_cents: number | null
          refund_offered_at: string | null
          refunded_at: string | null
          refunded_cents: number
          seller_cancellation_relisted_at: string | null
          seller_id: string | null
          seller_label: string | null
          ship_city: string | null
          ship_country: string | null
          ship_line1: string | null
          ship_line2: string | null
          ship_name: string | null
          ship_phone: string | null
          ship_postcode: string | null
          ship_state: string | null
          shipped_at: string | null
          shipping_cents: number
          shipping_quote: Json | null
          status: string
          stripe_dispute_id: string | null
          subtotal_cents: number
          total_cents: number
          tracking_number: string | null
          transfer_reference: string | null
          transferred_at: string | null
          updated_at: string
        }
        Insert: {
          accepted_checkout_shipping?: Json | null
          analytics_consent_version?: string | null
          buyer_id?: string | null
          buyer_label?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          carrier?: string | null
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          currency?: string
          delivered_at?: string | null
          dispute_category?: string | null
          dispute_escalated_at?: string | null
          dispute_escalated_by?: string | null
          dispute_outcome?: string | null
          dispute_reason?: string | null
          dispute_resolved_at?: string | null
          dispute_sla_alerted_at?: string | null
          disputed_at?: string | null
          disputed_by?: string | null
          id?: string
          is_collection?: boolean
          origin_offer_id?: string | null
          pickup_ready_at?: string | null
          platform_fee_cents?: number
          platform_fee_refunded_cents?: number
          pre_dispute_status?: string | null
          refund_offer_cents?: number | null
          refund_offered_at?: string | null
          refunded_at?: string | null
          refunded_cents?: number
          seller_cancellation_relisted_at?: string | null
          seller_id?: string | null
          seller_label?: string | null
          ship_city?: string | null
          ship_country?: string | null
          ship_line1?: string | null
          ship_line2?: string | null
          ship_name?: string | null
          ship_phone?: string | null
          ship_postcode?: string | null
          ship_state?: string | null
          shipped_at?: string | null
          shipping_cents?: number
          shipping_quote?: Json | null
          status?: string
          stripe_dispute_id?: string | null
          subtotal_cents?: number
          total_cents?: number
          tracking_number?: string | null
          transfer_reference?: string | null
          transferred_at?: string | null
          updated_at?: string
        }
        Update: {
          accepted_checkout_shipping?: Json | null
          analytics_consent_version?: string | null
          buyer_id?: string | null
          buyer_label?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          carrier?: string | null
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          currency?: string
          delivered_at?: string | null
          dispute_category?: string | null
          dispute_escalated_at?: string | null
          dispute_escalated_by?: string | null
          dispute_outcome?: string | null
          dispute_reason?: string | null
          dispute_resolved_at?: string | null
          dispute_sla_alerted_at?: string | null
          disputed_at?: string | null
          disputed_by?: string | null
          id?: string
          is_collection?: boolean
          origin_offer_id?: string | null
          pickup_ready_at?: string | null
          platform_fee_cents?: number
          platform_fee_refunded_cents?: number
          pre_dispute_status?: string | null
          refund_offer_cents?: number | null
          refund_offered_at?: string | null
          refunded_at?: string | null
          refunded_cents?: number
          seller_cancellation_relisted_at?: string | null
          seller_id?: string | null
          seller_label?: string | null
          ship_city?: string | null
          ship_country?: string | null
          ship_line1?: string | null
          ship_line2?: string | null
          ship_name?: string | null
          ship_phone?: string | null
          ship_postcode?: string | null
          ship_state?: string | null
          shipped_at?: string | null
          shipping_cents?: number
          shipping_quote?: Json | null
          status?: string
          stripe_dispute_id?: string | null
          subtotal_cents?: number
          total_cents?: number
          tracking_number?: string | null
          transfer_reference?: string | null
          transferred_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_dispute_escalated_by_fkey"
            columns: ["dispute_escalated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_disputed_by_fkey"
            columns: ["disputed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_origin_offer_id_fkey"
            columns: ["origin_offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_label_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          label: Json | null
          provider: string
          rated: Json
          shipment_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          label?: Json | null
          provider: string
          rated: Json
          shipment_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          label?: Json | null
          provider?: string
          rated?: Json
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_label_requests_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_label_void_requests: {
        Row: {
          amount_cents: number
          attempts: number
          claim_expires_at: string | null
          claim_owner: string | null
          completed_at: string | null
          created_at: string
          currency: string
          last_error: string | null
          order_id: string
          provider: string
          provider_observed_at: string | null
          provider_shipment_reference: string
          provider_state: string | null
          rejected_at: string | null
          seller_id: string
          shipment_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          attempts?: number
          claim_expires_at?: string | null
          claim_owner?: string | null
          completed_at?: string | null
          created_at?: string
          currency: string
          last_error?: string | null
          order_id: string
          provider: string
          provider_observed_at?: string | null
          provider_shipment_reference: string
          provider_state?: string | null
          rejected_at?: string | null
          seller_id: string
          shipment_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          attempts?: number
          claim_expires_at?: string | null
          claim_owner?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          last_error?: string | null
          order_id?: string
          provider?: string
          provider_observed_at?: string | null
          provider_shipment_reference?: string
          provider_state?: string | null
          rejected_at?: string | null
          seller_id?: string
          shipment_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_label_void_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_label_void_requests_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_label_void_requests_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      part_number_links: {
        Row: {
          confidence: number | null
          created_at: string
          created_by: string | null
          from_brand_key: string | null
          from_compact: string
          id: string
          kind: string
          source: string
          source_ref: string | null
          to_brand_key: string | null
          to_compact: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          from_brand_key?: string | null
          from_compact: string
          id?: string
          kind: string
          source?: string
          source_ref?: string | null
          to_brand_key?: string | null
          to_compact: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          from_brand_key?: string | null
          from_compact?: string
          id?: string
          kind?: string
          source?: string
          source_ref?: string | null
          to_brand_key?: string | null
          to_compact?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "part_number_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_number_links_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_recoveries: {
        Row: {
          amount_cents: number | null
          created_at: string
          detail: string | null
          id: string
          kind: string
          last_seen_at: string
          order_id: string | null
          recovery_key: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          detail?: string | null
          id?: string
          kind: string
          last_seen_at?: string
          order_id?: string | null
          recovery_key?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
          last_seen_at?: string
          order_id?: string | null
          recovery_key?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_recoveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_recoveries_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_requests: {
        Row: {
          correlation_id: string
          created_at: string
          next_reconcile_at: string
          operation_key: string
          provider_reference: string | null
          provider_rejected_at: string | null
          provider_rejection: string | null
          request: Json
        }
        Insert: {
          correlation_id?: string
          created_at?: string
          next_reconcile_at?: string
          operation_key: string
          provider_reference?: string | null
          provider_rejected_at?: string | null
          provider_rejection?: string | null
          request: Json
        }
        Update: {
          correlation_id?: string
          created_at?: string
          next_reconcile_at?: string
          operation_key?: string
          provider_reference?: string | null
          provider_rejected_at?: string | null
          provider_rejection?: string | null
          request?: Json
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          idempotency_key: string | null
          order_id: string
          provider: string
          provider_reference: string | null
          raw: Json | null
          refunded_cents: number
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          order_id: string
          provider?: string
          provider_reference?: string | null
          raw?: Json | null
          refunded_cents?: number
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          order_id?: string
          provider?: string
          provider_reference?: string | null
          raw?: Json | null
          refunded_cents?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_confirmations: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          order_id: string
          redeemed_at: string | null
          redeemed_by: string | null
          token_hash: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          order_id: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          token_hash: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          order_id?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_confirmations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_confirmations_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_fitments: {
        Row: {
          brake_packages: string[] | null
          catalog_model_id: number
          created_at: string
          created_by: string | null
          engine_codes: string[] | null
          gearbox_codes: string[] | null
          generation_id: number | null
          id: string
          notes: string | null
          product_id: string
          relationship: string
          source: string
          source_ref: string | null
          stated_on: string
          updated_at: string
          verification: string
          verified_at: string | null
          verified_by: string | null
          year_end: number | null
          year_start: number | null
        }
        Insert: {
          brake_packages?: string[] | null
          catalog_model_id: number
          created_at?: string
          created_by?: string | null
          engine_codes?: string[] | null
          gearbox_codes?: string[] | null
          generation_id?: number | null
          id?: string
          notes?: string | null
          product_id: string
          relationship: string
          source: string
          source_ref?: string | null
          stated_on?: string
          updated_at?: string
          verification?: string
          verified_at?: string | null
          verified_by?: string | null
          year_end?: number | null
          year_start?: number | null
        }
        Update: {
          brake_packages?: string[] | null
          catalog_model_id?: number
          created_at?: string
          created_by?: string | null
          engine_codes?: string[] | null
          gearbox_codes?: string[] | null
          generation_id?: number | null
          id?: string
          notes?: string | null
          product_id?: string
          relationship?: string
          source?: string
          source_ref?: string | null
          stated_on?: string
          updated_at?: string
          verification?: string
          verified_at?: string | null
          verified_by?: string | null
          year_end?: number | null
          year_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_fitments_catalog_model_id_fkey"
            columns: ["catalog_model_id"]
            isOneToOne: false
            referencedRelation: "catalog_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_generation_id_catalog_model_id_fkey"
            columns: ["generation_id", "catalog_model_id"]
            isOneToOne: false
            referencedRelation: "vehicle_generations"
            referencedColumns: ["id", "model_id"]
          },
          {
            foreignKeyName: "product_fitments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_grow_queue: {
        Row: {
          id: number
          listing_id: string | null
          mod_item_id: string | null
          queued_at: string
        }
        Insert: {
          id?: never
          listing_id?: string | null
          mod_item_id?: string | null
          queued_at?: string
        }
        Update: {
          id?: never
          listing_id?: string | null
          mod_item_id?: string | null
          queued_at?: string
        }
        Relationships: []
      }
      product_grow_runs: {
        Row: {
          id: number
          ran_at: string
          result: Json
        }
        Insert: {
          id?: never
          ran_at?: string
          result: Json
        }
        Update: {
          id?: never
          ran_at?: string
          result?: Json
        }
        Relationships: []
      }
      product_identity_reviews: {
        Row: {
          brand_keys: string[]
          created_at: string
          dedup_key: string
          detail: Json
          id: string
          kind: string
          link_id: string | null
          listing_id: string | null
          mod_item_id: string | null
          number_compact: string | null
          product_ids: string[]
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          brand_keys?: string[]
          created_at?: string
          dedup_key: string
          detail?: Json
          id?: string
          kind: string
          link_id?: string | null
          listing_id?: string | null
          mod_item_id?: string | null
          number_compact?: string | null
          product_ids?: string[]
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          brand_keys?: string[]
          created_at?: string
          dedup_key?: string
          detail?: Json
          id?: string
          kind?: string
          link_id?: string | null
          listing_id?: string | null
          mod_item_id?: string | null
          number_compact?: string | null
          product_ids?: string[]
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_identity_reviews_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "part_number_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_identity_reviews_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_identity_reviews_mod_item_id_fkey"
            columns: ["mod_item_id"]
            isOneToOne: false
            referencedRelation: "mod_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_identity_reviews_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_part_numbers: {
        Row: {
          basis: string
          brand_key: string
          created_at: string
          link_id: string | null
          number: string | null
          number_compact: string
          product_id: string
          verified_by: string | null
        }
        Insert: {
          basis: string
          brand_key: string
          created_at?: string
          link_id?: string | null
          number?: string | null
          number_compact: string
          product_id: string
          verified_by?: string | null
        }
        Update: {
          basis?: string
          brand_key?: string
          created_at?: string
          link_id?: string | null
          number?: string | null
          number_compact?: string
          product_id?: string
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_part_numbers_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "part_number_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_part_numbers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_part_numbers_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand: string
          brand_key: string
          category: string | null
          created_at: string
          created_from: string
          id: string
          merged_into: string | null
          name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          brand: string
          brand_key: string
          category?: string | null
          created_at?: string
          created_from: string
          id?: string
          merged_into?: string | null
          name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          brand?: string
          brand_key?: string
          category?: string | null
          created_at?: string
          created_from?: string
          id?: string
          merged_into?: string | null
          name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          agent_mode: string
          avatar_url: string | null
          bio: string | null
          country: string | null
          created_at: string
          default_offer_floor_pct: number | null
          display_name: string | null
          headline: string | null
          id: string
          import_attested_at: string | null
          links: Json
          location: string | null
          main_car_id: string | null
          notification_prefs: Json
          payouts_enabled: boolean
          profile_type: string
          region: string | null
          store_note: string | null
          stripe_account_id: string | null
          stripe_customer_id: string | null
          suspended_at: string | null
          suspended_reason: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          agent_mode?: string
          avatar_url?: string | null
          bio?: string | null
          country?: string | null
          created_at?: string
          default_offer_floor_pct?: number | null
          display_name?: string | null
          headline?: string | null
          id: string
          import_attested_at?: string | null
          links?: Json
          location?: string | null
          main_car_id?: string | null
          notification_prefs?: Json
          payouts_enabled?: boolean
          profile_type?: string
          region?: string | null
          store_note?: string | null
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          agent_mode?: string
          avatar_url?: string | null
          bio?: string | null
          country?: string | null
          created_at?: string
          default_offer_floor_pct?: number | null
          display_name?: string | null
          headline?: string | null
          id?: string
          import_attested_at?: string | null
          links?: Json
          location?: string | null
          main_car_id?: string | null
          notification_prefs?: Json
          payouts_enabled?: boolean
          profile_type?: string
          region?: string | null
          store_note?: string | null
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_main_car_id_fkey"
            columns: ["main_car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_attempts: {
        Row: {
          buyer_id: string | null
          checkout_context: Json | null
          checkout_request_key: string | null
          created_at: string
          idempotency_key: string
          request_fingerprint: Json | null
          result: Json
        }
        Insert: {
          buyer_id?: string | null
          checkout_context?: Json | null
          checkout_request_key?: string | null
          created_at?: string
          idempotency_key: string
          request_fingerprint?: Json | null
          result: Json
        }
        Update: {
          buyer_id?: string | null
          checkout_context?: Json | null
          checkout_request_key?: string | null
          created_at?: string
          idempotency_key?: string
          request_fingerprint?: Json | null
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "purchase_attempts_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start?: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      refund_lifecycle_adjustments: {
        Row: {
          created_at: string
          event_id: string
          failure_balance_transaction: string | null
          fee_restore_cents: number
          id: string
          kind: string
          refund_amount_cents: number
          refund_operation_id: string
          refund_reference: string
          seller_recredit_cents: number | null
        }
        Insert: {
          created_at?: string
          event_id: string
          failure_balance_transaction?: string | null
          fee_restore_cents: number
          id?: string
          kind: string
          refund_amount_cents: number
          refund_operation_id: string
          refund_reference: string
          seller_recredit_cents?: number | null
        }
        Update: {
          created_at?: string
          event_id?: string
          failure_balance_transaction?: string | null
          fee_restore_cents?: number
          id?: string
          kind?: string
          refund_amount_cents?: number
          refund_operation_id?: string
          refund_reference?: string
          seller_recredit_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "refund_lifecycle_adjustments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "refund_provider_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "refund_lifecycle_adjustments_refund_operation_id_fkey"
            columns: ["refund_operation_id"]
            isOneToOne: false
            referencedRelation: "refund_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_operations: {
        Row: {
          actor_role: string
          amount_cents: number
          attempts: number
          created_at: string
          currency: string
          dispute_outcome: string | null
          effects_completed_at: string | null
          external: boolean
          id: string
          idempotency_key: string
          last_error: string | null
          next_attempt_at: string | null
          order_id: string
          payment_reference: string | null
          provider_balance_transaction: string | null
          provider_completed_at: string | null
          provider_event_created_at: string | null
          provider_event_id: string | null
          provider_failure_balance_transaction: string | null
          provider_failure_reason: string | null
          provider_pending_reason: string | null
          provider_status: string | null
          purpose: string
          reason: string
          recovery_id: string | null
          refund_reference: string | null
          remaining_before_cents: number
          replacement_transfer_reference: string | null
          replaces_adjustment_id: string | null
          request_key: string | null
          requested_by: string
          resolve_dispute: boolean
          reversal_amount_cents: number | null
          reversal_call_may_have_occurred: boolean
          reversal_completed_at: string | null
          reversal_currency: string | null
          reversal_due_cents: number | null
          reversal_last_attempt_at: string | null
          reversal_lease_expires_at: string | null
          reversal_locked_by: string | null
          reversal_operation_key: string | null
          reversal_reference: string | null
          reversal_transfer_reference: string | null
          status: string
          updated_at: string
        }
        Insert: {
          actor_role?: string
          amount_cents: number
          attempts?: number
          created_at?: string
          currency: string
          dispute_outcome?: string | null
          effects_completed_at?: string | null
          external?: boolean
          id?: string
          idempotency_key: string
          last_error?: string | null
          next_attempt_at?: string | null
          order_id: string
          payment_reference?: string | null
          provider_balance_transaction?: string | null
          provider_completed_at?: string | null
          provider_event_created_at?: string | null
          provider_event_id?: string | null
          provider_failure_balance_transaction?: string | null
          provider_failure_reason?: string | null
          provider_pending_reason?: string | null
          provider_status?: string | null
          purpose?: string
          reason?: string
          recovery_id?: string | null
          refund_reference?: string | null
          remaining_before_cents: number
          replacement_transfer_reference?: string | null
          replaces_adjustment_id?: string | null
          request_key?: string | null
          requested_by: string
          resolve_dispute?: boolean
          reversal_amount_cents?: number | null
          reversal_call_may_have_occurred?: boolean
          reversal_completed_at?: string | null
          reversal_currency?: string | null
          reversal_due_cents?: number | null
          reversal_last_attempt_at?: string | null
          reversal_lease_expires_at?: string | null
          reversal_locked_by?: string | null
          reversal_operation_key?: string | null
          reversal_reference?: string | null
          reversal_transfer_reference?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          actor_role?: string
          amount_cents?: number
          attempts?: number
          created_at?: string
          currency?: string
          dispute_outcome?: string | null
          effects_completed_at?: string | null
          external?: boolean
          id?: string
          idempotency_key?: string
          last_error?: string | null
          next_attempt_at?: string | null
          order_id?: string
          payment_reference?: string | null
          provider_balance_transaction?: string | null
          provider_completed_at?: string | null
          provider_event_created_at?: string | null
          provider_event_id?: string | null
          provider_failure_balance_transaction?: string | null
          provider_failure_reason?: string | null
          provider_pending_reason?: string | null
          provider_status?: string | null
          purpose?: string
          reason?: string
          recovery_id?: string | null
          refund_reference?: string | null
          remaining_before_cents?: number
          replacement_transfer_reference?: string | null
          replaces_adjustment_id?: string | null
          request_key?: string | null
          requested_by?: string
          resolve_dispute?: boolean
          reversal_amount_cents?: number | null
          reversal_call_may_have_occurred?: boolean
          reversal_completed_at?: string | null
          reversal_currency?: string | null
          reversal_due_cents?: number | null
          reversal_last_attempt_at?: string | null
          reversal_lease_expires_at?: string | null
          reversal_locked_by?: string | null
          reversal_operation_key?: string | null
          reversal_reference?: string | null
          reversal_transfer_reference?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_operations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_operations_recovery_id_fkey"
            columns: ["recovery_id"]
            isOneToOne: false
            referencedRelation: "payment_recoveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_operations_replaces_adjustment_id_fkey"
            columns: ["replaces_adjustment_id"]
            isOneToOne: false
            referencedRelation: "refund_lifecycle_adjustments"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_provider_events: {
        Row: {
          amount_cents: number
          balance_transaction: string | null
          currency: string
          event_id: string
          failure_balance_transaction: string | null
          failure_reason: string | null
          order_id: string | null
          payment_reference: string | null
          provider_created_at: string
          provider_status: string
          received_at: string
          refund_operation_id: string | null
          refund_reference: string
          reported_operation_id: string | null
          reported_order_id: string | null
        }
        Insert: {
          amount_cents: number
          balance_transaction?: string | null
          currency: string
          event_id: string
          failure_balance_transaction?: string | null
          failure_reason?: string | null
          order_id?: string | null
          payment_reference?: string | null
          provider_created_at: string
          provider_status: string
          received_at?: string
          refund_operation_id?: string | null
          refund_reference: string
          reported_operation_id?: string | null
          reported_order_id?: string | null
        }
        Update: {
          amount_cents?: number
          balance_transaction?: string | null
          currency?: string
          event_id?: string
          failure_balance_transaction?: string | null
          failure_reason?: string | null
          order_id?: string | null
          payment_reference?: string | null
          provider_created_at?: string
          provider_status?: string
          received_at?: string
          refund_operation_id?: string | null
          refund_reference?: string
          reported_operation_id?: string | null
          reported_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refund_provider_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_provider_events_refund_operation_id_fkey"
            columns: ["refund_operation_id"]
            isOneToOne: false
            referencedRelation: "refund_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_recredit_proofs: {
        Row: {
          adjustment_id: string
          amount_cents: number
          balance_transaction: string | null
          currency: string
          original_reversal_reference: string | null
          recovery_id: string
          recredit_transfer_reference: string | null
          verified_at: string
          verified_by: string
        }
        Insert: {
          adjustment_id: string
          amount_cents: number
          balance_transaction?: string | null
          currency: string
          original_reversal_reference?: string | null
          recovery_id: string
          recredit_transfer_reference?: string | null
          verified_at?: string
          verified_by: string
        }
        Update: {
          adjustment_id?: string
          amount_cents?: number
          balance_transaction?: string | null
          currency?: string
          original_reversal_reference?: string | null
          recovery_id?: string
          recredit_transfer_reference?: string | null
          verified_at?: string
          verified_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_recredit_proofs_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: true
            referencedRelation: "refund_lifecycle_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_recredit_proofs_recovery_id_fkey"
            columns: ["recovery_id"]
            isOneToOne: true
            referencedRelation: "payment_recoveries"
            referencedColumns: ["id"]
          },
        ]
      }
      remediation_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          dedup_key: string
          id: string
          kind: string
          last_error: string | null
          lease_id: string | null
          locked_until: string | null
          next_attempt_at: string
          payload: Json
          status: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          dedup_key: string
          id?: string
          kind: string
          last_error?: string | null
          lease_id?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          payload: Json
          status?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          dedup_key?: string
          id?: string
          kind?: string
          last_error?: string | null
          lease_id?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          payload?: Json
          status?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          reason: string
          reporter_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          reason: string
          reporter_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject_id: string
          subject_type: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          reason?: string
          reporter_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      return_items: {
        Row: {
          inspection_note: string | null
          inspection_status: string
          order_item_id: string
          quantity: number
          reason: string | null
          return_id: string
        }
        Insert: {
          inspection_note?: string | null
          inspection_status?: string
          order_item_id: string
          quantity?: number
          reason?: string | null
          return_id: string
        }
        Update: {
          inspection_note?: string | null
          inspection_status?: string
          order_item_id?: string
          quantity?: number
          reason?: string | null
          return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
        ]
      }
      return_label_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          label: Json | null
          provider: string
          rated: Json
          return_id: string
          shipment_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          label?: Json | null
          provider: string
          rated: Json
          return_id: string
          shipment_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          label?: Json | null
          provider?: string
          rated?: Json
          return_id?: string
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_label_requests_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: true
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_label_requests_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          approved_at: string | null
          completed_at: string | null
          created_at: string
          delivered_at: string | null
          id: string
          label_deduction_cents: number
          order_id: string
          reason: string | null
          received_at: string | null
          refund_amount_cents: number | null
          refund_operation_id: string | null
          requested_at: string
          requested_by: string | null
          responsibility: string
          return_type: string
          seller_respond_by: string | null
          ship_by: string | null
          shipped_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          completed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          label_deduction_cents?: number
          order_id: string
          reason?: string | null
          received_at?: string | null
          refund_amount_cents?: number | null
          refund_operation_id?: string | null
          requested_at?: string
          requested_by?: string | null
          responsibility: string
          return_type: string
          seller_respond_by?: string | null
          ship_by?: string | null
          shipped_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          completed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          label_deduction_cents?: number
          order_id?: string
          reason?: string | null
          received_at?: string | null
          refund_amount_cents?: number | null
          refund_operation_id?: string | null
          requested_at?: string
          requested_by?: string | null
          responsibility?: string
          return_type?: string
          seller_respond_by?: string | null
          ship_by?: string | null
          shipped_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_refund_operation_id_fkey"
            columns: ["refund_operation_id"]
            isOneToOne: false
            referencedRelation: "refund_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          body: string | null
          created_at: string
          id: string
          order_id: string
          rating: number
          reviewee_id: string
          reviewer_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          order_id: string
          rating: number
          reviewee_id: string
          reviewer_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          order_id?: string
          rating?: number
          reviewee_id?: string
          reviewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewee_id_fkey"
            columns: ["reviewee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_search_email_cursors: {
        Row: {
          activated_at: string
          checked_through: string
          checked_xact: number
          saved_search_id: string
          updated_at: string
        }
        Insert: {
          activated_at: string
          checked_through: string
          checked_xact: number
          saved_search_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string
          checked_through?: string
          checked_xact?: number
          saved_search_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_search_email_cursors_saved_search_id_fkey"
            columns: ["saved_search_id"]
            isOneToOne: true
            referencedRelation: "saved_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_search_email_digests: {
        Row: {
          attempts: number
          created_at: string
          digest_day: string
          href: string
          id: string
          items: Json
          last_error: string | null
          match_count: number
          next_attempt_at: string
          provider_message_id: string | null
          saved_search_id: string
          search_name: string
          sent_at: string | null
          skip_reason: string | null
          status: string
          updated_at: string
          window_end: string
          window_end_xact: number | null
          window_start: string
          window_start_xact: number | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          digest_day: string
          href: string
          id?: string
          items?: Json
          last_error?: string | null
          match_count: number
          next_attempt_at?: string
          provider_message_id?: string | null
          saved_search_id: string
          search_name: string
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
          window_end: string
          window_end_xact?: number | null
          window_start: string
          window_start_xact?: number | null
        }
        Update: {
          attempts?: number
          created_at?: string
          digest_day?: string
          href?: string
          id?: string
          items?: Json
          last_error?: string | null
          match_count?: number
          next_attempt_at?: string
          provider_message_id?: string | null
          saved_search_id?: string
          search_name?: string
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
          window_end?: string
          window_end_xact?: number | null
          window_start?: string
          window_start_xact?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_search_email_digests_saved_search_id_fkey"
            columns: ["saved_search_id"]
            isOneToOne: false
            referencedRelation: "saved_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_searches: {
        Row: {
          alert: boolean
          created_at: string
          id: string
          last_checked_at: string | null
          last_matched_at: string | null
          name: string
          params: Json
          user_id: string
        }
        Insert: {
          alert?: boolean
          created_at?: string
          id?: string
          last_checked_at?: string | null
          last_matched_at?: string | null
          name: string
          params?: Json
          user_id: string
        }
        Update: {
          alert?: boolean
          created_at?: string
          id?: string
          last_checked_at?: string | null
          last_matched_at?: string | null
          name?: string
          params?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_searches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saves: {
        Row: {
          created_at: string
          target_id: string
          target_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          target_id: string
          target_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          target_id?: string
          target_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      search_rebuilds: {
        Row: {
          created_at: string
          cursor: string | null
          entity: string
          id: string
          status: string
        }
        Insert: {
          created_at?: string
          cursor?: string | null
          entity: string
          id?: string
          status?: string
        }
        Update: {
          created_at?: string
          cursor?: string | null
          entity?: string
          id?: string
          status?: string
        }
        Relationships: []
      }
      search_words: {
        Row: {
          uses: number
          word: string
        }
        Insert: {
          uses: number
          word: string
        }
        Update: {
          uses?: number
          word?: string
        }
        Relationships: []
      }
      seller_adjustments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          description: string | null
          external_reference: string | null
          id: string
          kind: string
          order_id: string | null
          return_id: string | null
          seller_id: string | null
          shipment_id: string | null
          voided_at: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          description?: string | null
          external_reference?: string | null
          id?: string
          kind: string
          order_id?: string | null
          return_id?: string | null
          seller_id?: string | null
          shipment_id?: string | null
          voided_at?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          description?: string | null
          external_reference?: string | null
          id?: string
          kind?: string
          order_id?: string | null
          return_id?: string | null
          seller_id?: string | null
          shipment_id?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_adjustments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_adjustments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_adjustments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_carry_entries: {
        Row: {
          adjustment_id: string | null
          amount_cents: number
          created_at: string
          currency: string
          entry_key: string
          id: string
          kind: string
          order_id: string | null
          seller_id: string | null
        }
        Insert: {
          adjustment_id?: string | null
          amount_cents: number
          created_at?: string
          currency?: string
          entry_key: string
          id?: string
          kind: string
          order_id?: string | null
          seller_id?: string | null
        }
        Update: {
          adjustment_id?: string | null
          amount_cents?: number
          created_at?: string
          currency?: string
          entry_key?: string
          id?: string
          kind?: string
          order_id?: string | null
          seller_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_carry_entries_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "seller_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_carry_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_carry_entries_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_carry_payouts: {
        Row: {
          amount_cents: number
          attempts: number
          created_at: string
          currency: string
          destination: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          locked_by: string | null
          next_attempt_at: string | null
          paid_at: string | null
          provider_call_may_have_occurred: boolean
          seller_id: string | null
          status: string
          transfer_reference: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          attempts?: number
          created_at?: string
          currency?: string
          destination?: string | null
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          locked_by?: string | null
          next_attempt_at?: string | null
          paid_at?: string | null
          provider_call_may_have_occurred?: boolean
          seller_id?: string | null
          status?: string
          transfer_reference?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          attempts?: number
          created_at?: string
          currency?: string
          destination?: string | null
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          locked_by?: string | null
          next_attempt_at?: string | null
          paid_at?: string | null
          provider_call_may_have_occurred?: boolean
          seller_id?: string | null
          status?: string
          transfer_reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_carry_payouts_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_fulfillment_profiles: {
        Row: {
          address_verified_at: string | null
          city: string
          company: string | null
          country: string
          created_at: string
          default_handling_days: number
          easypost_end_shipper_id: string | null
          phone: string | null
          postal_code: string
          return_city: string | null
          return_country: string | null
          return_name: string | null
          return_postal_code: string | null
          return_state: string | null
          return_street1: string | null
          return_street2: string | null
          seller_id: string
          ship_from_name: string
          state: string | null
          street1: string
          street2: string | null
          updated_at: string
        }
        Insert: {
          address_verified_at?: string | null
          city: string
          company?: string | null
          country?: string
          created_at?: string
          default_handling_days?: number
          easypost_end_shipper_id?: string | null
          phone?: string | null
          postal_code: string
          return_city?: string | null
          return_country?: string | null
          return_name?: string | null
          return_postal_code?: string | null
          return_state?: string | null
          return_street1?: string | null
          return_street2?: string | null
          seller_id: string
          ship_from_name: string
          state?: string | null
          street1: string
          street2?: string | null
          updated_at?: string
        }
        Update: {
          address_verified_at?: string | null
          city?: string
          company?: string | null
          country?: string
          created_at?: string
          default_handling_days?: number
          easypost_end_shipper_id?: string | null
          phone?: string | null
          postal_code?: string
          return_city?: string | null
          return_country?: string | null
          return_name?: string | null
          return_postal_code?: string | null
          return_state?: string | null
          return_street1?: string | null
          return_street2?: string | null
          seller_id?: string
          ship_from_name?: string
          state?: string | null
          street1?: string
          street2?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_fulfillment_profiles_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_settings: {
        Row: {
          auto_confirm_after_days: number | null
          auto_confirm_notice_days: number
          card_verification_from_cents: number | null
          id: boolean
          payout_hold_days: number
          payout_hold_mode: string
          receipt_release_after_days: number
          tracking_required_from_cents: number | null
          updated_at: string
        }
        Insert: {
          auto_confirm_after_days?: number | null
          auto_confirm_notice_days?: number
          card_verification_from_cents?: number | null
          id?: boolean
          payout_hold_days?: number
          payout_hold_mode?: string
          receipt_release_after_days?: number
          tracking_required_from_cents?: number | null
          updated_at?: string
        }
        Update: {
          auto_confirm_after_days?: number | null
          auto_confirm_notice_days?: number
          card_verification_from_cents?: number | null
          id?: boolean
          payout_hold_days?: number
          payout_hold_mode?: string
          receipt_release_after_days?: number
          tracking_required_from_cents?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      shipment_events: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          description: string | null
          id: string
          occurred_at: string
          provider_event_ref: string | null
          shipment_id: string
          state: string | null
          status: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          id?: string
          occurred_at: string
          provider_event_ref?: string | null
          shipment_id: string
          state?: string | null
          status: string
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          id?: string
          occurred_at?: string
          provider_event_ref?: string | null
          shipment_id?: string
          state?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_items: {
        Row: {
          order_item_id: string
          shipment_id: string
        }
        Insert: {
          order_item_id: string
          shipment_id: string
        }
        Update: {
          order_item_id?: string
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          carrier: string | null
          created_at: string
          delivered_at: string | null
          direction: string
          fulfillment_type: string
          id: string
          insured_value_cents: number | null
          label_reference: string | null
          order_id: string
          provider: string | null
          provider_shipment_id: string | null
          provider_tracker_id: string | null
          purchased_cents: number | null
          quoted_cents: number | null
          return_id: string | null
          service: string | null
          shipped_at: string | null
          signature_required: boolean
          status: string
          tracking_code: string | null
          updated_at: string
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          delivered_at?: string | null
          direction?: string
          fulfillment_type: string
          id?: string
          insured_value_cents?: number | null
          label_reference?: string | null
          order_id: string
          provider?: string | null
          provider_shipment_id?: string | null
          provider_tracker_id?: string | null
          purchased_cents?: number | null
          quoted_cents?: number | null
          return_id?: string | null
          service?: string | null
          shipped_at?: string | null
          signature_required?: boolean
          status?: string
          tracking_code?: string | null
          updated_at?: string
        }
        Update: {
          carrier?: string | null
          created_at?: string
          delivered_at?: string | null
          direction?: string
          fulfillment_type?: string
          id?: string
          insured_value_cents?: number | null
          label_reference?: string | null
          order_id?: string
          provider?: string | null
          provider_shipment_id?: string | null
          provider_tracker_id?: string | null
          purchased_cents?: number | null
          quoted_cents?: number | null
          return_id?: string | null
          service?: string | null
          shipped_at?: string | null
          signature_required?: boolean
          status?: string
          tracking_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_rate_quotes: {
        Row: {
          amount_cents: number
          buyer_id: string | null
          carrier: string
          consumed_order_id: string | null
          created_at: string
          currency: string
          destination_hash: string
          est_delivery_days: number | null
          expires_at: string
          id: string
          listing_id: string
          parcel: Json
          provider: string
          provider_shipment_id: string
          rate_ref: string
          request_fingerprint: string | null
          service: string
          service_label: string
        }
        Insert: {
          amount_cents: number
          buyer_id?: string | null
          carrier: string
          consumed_order_id?: string | null
          created_at?: string
          currency?: string
          destination_hash: string
          est_delivery_days?: number | null
          expires_at: string
          id?: string
          listing_id: string
          parcel: Json
          provider: string
          provider_shipment_id: string
          rate_ref: string
          request_fingerprint?: string | null
          service: string
          service_label: string
        }
        Update: {
          amount_cents?: number
          buyer_id?: string | null
          carrier?: string
          consumed_order_id?: string | null
          created_at?: string
          currency?: string
          destination_hash?: string
          est_delivery_days?: number | null
          expires_at?: string
          id?: string
          listing_id?: string
          parcel?: Json
          provider?: string
          provider_shipment_id?: string
          rate_ref?: string
          request_fingerprint?: string | null
          service?: string
          service_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_rate_quotes_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_rate_quotes_consumed_order_id_fkey"
            columns: ["consumed_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_rate_quotes_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_profiles: {
        Row: {
          created_at: string
          profile_id: string
          return_window_days: number
          returns_accepted: boolean
          updated_at: string
          verification_status: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          return_window_days?: number
          returns_accepted?: boolean
          updated_at?: string
          verification_status?: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          return_window_days?: number
          returns_accepted?: boolean
          updated_at?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staged_uploads: {
        Row: {
          bucket: string
          consumed_at: string | null
          created_at: string | null
          id: string
          owner_id: string
          path: string
          url: string
        }
        Insert: {
          bucket: string
          consumed_at?: string | null
          created_at?: string | null
          id?: string
          owner_id: string
          path: string
          url: string
        }
        Update: {
          bucket?: string
          consumed_at?: string | null
          created_at?: string | null
          id?: string
          owner_id?: string
          path?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "staged_uploads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_dispute_journal: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          dispute_id: string
          last_event_created: number
          last_event_id: string
          lease_expires_at: string | null
          lease_id: string | null
          order_ids: string[]
          payment_reference: string
          state: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          dispute_id: string
          last_event_created: number
          last_event_id: string
          lease_expires_at?: string | null
          lease_id?: string | null
          order_ids?: string[]
          payment_reference: string
          state: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          dispute_id?: string
          last_event_created?: number
          last_event_id?: string
          lease_expires_at?: string | null
          lease_id?: string | null
          order_ids?: string[]
          payment_reference?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      transfer_intents: {
        Row: {
          amount_cents: number
          attempts: number
          available_at: string | null
          created_at: string
          currency: string
          dispatch_amount_cents: number | null
          dispatch_carry_cents: number | null
          dispatch_currency: string | null
          dispatch_destination: string | null
          dispatch_source_transaction: string | null
          dispatch_transfer_group: string | null
          last_attempt_at: string | null
          last_error: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          next_attempt_at: string | null
          operation_key: string | null
          order_id: string
          provider_call_may_have_occurred: boolean
          seller_id: string | null
          source_transaction: string | null
          status: string
          transfer_reference: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          attempts?: number
          available_at?: string | null
          created_at?: string
          currency: string
          dispatch_amount_cents?: number | null
          dispatch_carry_cents?: number | null
          dispatch_currency?: string | null
          dispatch_destination?: string | null
          dispatch_source_transaction?: string | null
          dispatch_transfer_group?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          next_attempt_at?: string | null
          operation_key?: string | null
          order_id: string
          provider_call_may_have_occurred?: boolean
          seller_id?: string | null
          source_transaction?: string | null
          status?: string
          transfer_reference?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          attempts?: number
          available_at?: string | null
          created_at?: string
          currency?: string
          dispatch_amount_cents?: number | null
          dispatch_carry_cents?: number | null
          dispatch_currency?: string | null
          dispatch_destination?: string | null
          dispatch_source_transaction?: string | null
          dispatch_transfer_group?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          next_attempt_at?: string | null
          operation_key?: string | null
          order_id?: string
          provider_call_may_have_occurred?: boolean
          seller_id?: string | null
          source_transaction?: string | null
          status?: string
          transfer_reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_intents_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_generations: {
        Row: {
          created_at: string
          id: number
          model_id: number
          name: string
          platform_code: string | null
          source: string
          source_ref: string | null
          updated_at: string
          year_end: number | null
          year_start: number
        }
        Insert: {
          created_at?: string
          id?: never
          model_id: number
          name: string
          platform_code?: string | null
          source?: string
          source_ref?: string | null
          updated_at?: string
          year_end?: number | null
          year_start: number
        }
        Update: {
          created_at?: string
          id?: never
          model_id?: number
          name?: string
          platform_code?: string | null
          source?: string
          source_ref?: string | null
          updated_at?: string
          year_end?: number | null
          year_start?: number
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_generations_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "catalog_models"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_makes: {
        Row: {
          created_at: string
          id: number
          models_fetched_at: string | null
          name: string
        }
        Insert: {
          created_at?: string
          id: number
          models_fetched_at?: string | null
          name: string
        }
        Update: {
          created_at?: string
          id?: number
          models_fetched_at?: string | null
          name?: string
        }
        Relationships: []
      }
      vehicle_models: {
        Row: {
          created_at: string
          id: number
          make_id: number
          name: string
        }
        Insert: {
          created_at?: string
          id?: never
          make_id: number
          name: string
        }
        Update: {
          created_at?: string
          id?: never
          make_id?: number
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_models_make_id_fkey"
            columns: ["make_id"]
            isOneToOne: false
            referencedRelation: "vehicle_makes"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          failed_attempts: number
          id: string
          last_failed_at: string | null
          last_failure_detail: string | null
          last_failure_kind: string | null
          payload: Json | null
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          failed_attempts?: number
          id: string
          last_failed_at?: string | null
          last_failure_detail?: string | null
          last_failure_kind?: string | null
          payload?: Json | null
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          failed_attempts?: number
          id?: string
          last_failed_at?: string | null
          last_failure_detail?: string | null
          last_failure_kind?: string | null
          payload?: Json | null
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      worker_runs: {
        Row: {
          family: string
          finished_at: string | null
          id: string
          started_at: string
          status: string
          summary: Json | null
        }
        Insert: {
          family: string
          finished_at?: string | null
          id: string
          started_at?: string
          status?: string
          summary?: Json | null
        }
        Update: {
          family?: string
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          summary?: Json | null
        }
        Relationships: []
      }
    }
    Views: {
      feed_events: {
        Row: {
          car_id: string | null
          happened_at: string | null
          id: string | null
          kind: string | null
          owner_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      account_deletion_blockers: { Args: { p_user: string }; Returns: Json }
      activity_post_search_text: { Args: { body: Json }; Returns: string }
      activity_post_visible: { Args: { p_post_id: string }; Returns: boolean }
      actor_name: { Args: { p_id: string }; Returns: string }
      admin_audit_page: {
        Args: {
          p_action?: string
          p_actor?: string
          p_before_at?: string
          p_before_id?: number
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_subject_type?: string
          p_to?: string
        }
        Returns: {
          action: string
          actor_id: string
          created_at: string
          id: number
          metadata: Json
          order_id: string | null
          reason: string
          subject_id: string
          subject_type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "admin_audit_log"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_cancel_seller_carry_payout: {
        Args: { p_id: string }
        Returns: Json
      }
      admin_confirmed_factor: { Args: never; Returns: string }
      admin_enrolment_state: { Args: never; Returns: string }
      admin_export_orders: {
        Args: {
          p_after_at?: string
          p_after_id?: string
          p_category?: string
          p_from?: string
          p_limit?: number
          p_max_cents?: number
          p_min_cents?: number
          p_query?: string
          p_status?: string
          p_to?: string
          p_view: string
        }
        Returns: {
          buyer_display_name: string
          buyer_id: string
          buyer_username: string
          created_at: string
          currency: string
          dispute_category: string
          dispute_reason: string
          dispute_resolved_at: string
          disputed_at: string
          id: string
          refund_offer_cents: number
          refunded_cents: number
          seller_display_name: string
          seller_id: string
          seller_username: string
          sort_at: string
          status: string
          title: string
          total_cents: number
          transferred: boolean
        }[]
      }
      admin_open_agent_chat: {
        Args: {
          p_case: string
          p_case_kind: string
          p_member: string
          p_reason: string
        }
        Returns: {
          body: string
          created_at: string
          id: string
          role: string
        }[]
      }
      admin_order_money_window: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      admin_retry_seller_carry_payout: { Args: { p_id: string }; Returns: Json }
      admin_retry_transfer_intent: { Args: { p_order: string }; Returns: Json }
      admin_role: { Args: never; Returns: string }
      admin_set_agent_beta_step: {
        Args: { p_open: boolean; p_reason: string; p_step: string }
        Returns: undefined
      }
      admin_set_agent_control: {
        Args: {
          p_on: boolean
          p_reason: string
          p_scope: string
          p_subject: string
        }
        Returns: string
      }
      admin_set_agent_spend_limits: {
        Args: { p_global_usd: number; p_member_usd: number; p_reason: string }
        Returns: undefined
      }
      admin_users_page: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_state?: string
        }
        Returns: Json
      }
      admit_saved_search_digest: {
        Args: {
          p_expected_through?: string
          p_href: string
          p_items: Json
          p_match_count: number
          p_saved_search_id: string
          p_window_end: string
          p_window_xact: number
        }
        Returns: string
      }
      advance_search_rebuild: { Args: { p_run: string }; Returns: Json }
      agent_approval_decide: {
        Args: { p_approval: string; p_choice: string }
        Returns: Json
      }
      agent_authority: {
        Args: {
          p_job: Database["public"]["Tables"]["agent_jobs"]["Row"]
          p_listing: Database["public"]["Tables"]["listings"]["Row"]
          p_offer: Database["public"]["Tables"]["offers"]["Row"]
        }
        Returns: Json
      }
      agent_chat_append: {
        Args: {
          p_body: string
          p_cards?: Json
          p_images?: string[]
          p_owner: string
          p_role: string
        }
        Returns: {
          body: string
          cards: Json
          created_at: string
          id: string
          images: string[]
          role: string
        }[]
      }
      agent_chat_card_ok: { Args: { p_card: Json }; Returns: boolean }
      agent_chat_message_json: { Args: { p_id: string }; Returns: Json }
      agent_chat_photos_expired: {
        Args: { p_limit?: number; p_older_than?: string }
        Returns: {
          name: string
        }[]
      }
      agent_chat_turn_begin: {
        Args: {
          p_body: string
          p_images?: string[]
          p_owner: string
          p_request: string
        }
        Returns: Json
      }
      agent_chat_turn_finish: {
        Args: {
          p_body: string
          p_cards?: Json
          p_owner: string
          p_request: string
        }
        Returns: Json
      }
      agent_chat_turn_status: {
        Args: { p_owner: string; p_request: string }
        Returns: Json
      }
      agent_claim_jobs: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          expected_action: string
          job_id: string
          kind: string
          lease_id: string
          listing_id: string
          offer_id: string
          round_no: number
          task_id: string
        }[]
      }
      agent_clear_conversation: { Args: never; Returns: number }
      agent_compute_metrics: { Args: { p_day: string }; Returns: number }
      agent_controls_lock_key: { Args: never; Returns: number }
      agent_enqueue_turns: { Args: { p_task: string }; Returns: number }
      agent_finish_job: {
        Args: {
          p_code?: string
          p_end_task?: boolean
          p_job: string
          p_lease: string
          p_outcome: string
        }
        Returns: boolean
      }
      agent_halt_reason: {
        Args: {
          p_counterparty: string
          p_listing: string
          p_mandate: string
          p_owner: string
          p_scope: string
        }
        Returns: string
      }
      agent_health: { Args: never; Returns: Json }
      agent_job_context: {
        Args: { p_job: string; p_lease: string }
        Returns: Json
      }
      agent_lock_job: {
        Args: { p_action: string; p_job: string; p_lease: string }
        Returns: {
          attempts: number
          available_at: string
          created_at: string
          dedup_key: string
          expected_action: string
          finished_at: string | null
          id: string
          kind: string
          last_error: string | null
          lease_expires_at: string | null
          lease_id: string | null
          listing_id: string
          max_attempts: number
          offer_id: string | null
          round_no: number | null
          status: string
          task_id: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      agent_luhn: { Args: { p_digits: string }; Returns: boolean }
      agent_mandate_set: {
        Args: {
          p_acknowledge_binding?: boolean
          p_ceiling_basis?: string
          p_ceiling_cents?: number
          p_expires_at?: string
          p_listing: string
          p_minimum_cents?: number
          p_scope: string
          p_style?: string
          p_target_cents?: number
        }
        Returns: string
      }
      agent_mandate_set_status: {
        Args: { p_mandate: string; p_status: string }
        Returns: string
      }
      agent_member_lock_key: { Args: { p_owner: string }; Returns: number }
      agent_mode_set: { Args: { p_mode: string }; Returns: Json }
      agent_offer_move: {
        Args: {
          p_amount: number
          p_expected_round: number
          p_job: string
          p_kind: string
          p_lease: string
          p_offer: string
        }
        Returns: Json
      }
      agent_offer_open: {
        Args: {
          p_amount: number
          p_job: string
          p_lease: string
          p_listing: string
        }
        Returns: Json
      }
      agent_open_task: { Args: { p_mandate: string }; Returns: string }
      agent_purge_member: { Args: { p_user: string }; Returns: Json }
      agent_reconcile_outbox: { Args: { p_limit?: number }; Returns: Json }
      agent_record_decision: {
        Args: {
          p_decision: string
          p_job: string
          p_lease: string
          p_reason: string
        }
        Returns: undefined
      }
      agent_redact_cards: { Args: { p_text: string }; Returns: string }
      agent_renew_lease: {
        Args: { p_job: string; p_lease: string; p_lease_seconds?: number }
        Returns: string
      }
      agent_request_approval: {
        Args: {
          p_expected_round: number
          p_job: string
          p_lease: string
          p_offer: string
          p_reason: string
        }
        Returns: string
      }
      agent_retention_sweep: { Args: never; Returns: Json }
      agent_spend_allowed: { Args: { p_owner: string }; Returns: Json }
      agent_spend_reserve: {
        Args: { p_amount_usd: number; p_feature: string; p_owner: string }
        Returns: Json
      }
      agent_spend_settle: {
        Args: {
          p_cost_usd?: number
          p_feature: string
          p_hold: string
          p_input_tokens: number
          p_model: string
          p_output_tokens: number
          p_owner: string
          p_task?: string
        }
        Returns: undefined
      }
      agent_usage_retention_sweep: { Args: never; Returns: number }
      apply_stripe_dispute_event: {
        Args: {
          p_amount: number
          p_closed: boolean
          p_created: number
          p_currency: string
          p_dispute: string
          p_event: string
          p_intent: string
          p_lease: string
          p_status: string
        }
        Returns: string
      }
      assert_admin_actor: { Args: { p_actor: string }; Returns: undefined }
      assert_deletion_ready: { Args: { p_user: string }; Returns: undefined }
      auto_confirm_delivery: { Args: { p_order: string }; Returns: boolean }
      auto_confirm_untracked_deliveries: {
        Args: { p_limit?: number }
        Returns: Json
      }
      become_shop: { Args: never; Returns: Json }
      begin_admin_external_operation: {
        Args: {
          p_action: string
          p_actor: string
          p_metadata?: Json
          p_order: string
          p_reason: string
          p_subject: string
          p_subject_type: string
        }
        Returns: Json
      }
      begin_admin_mfa_recovery: {
        Args: { p_actor: string; p_reason: string; p_target: string }
        Returns: string
      }
      begin_refund_operation: {
        Args: {
          p_actor_role: string
          p_amount_cents: number
          p_dispute_outcome: string
          p_external?: boolean
          p_order_id: string
          p_payment_reference: string
          p_reason: string
          p_refund_reference?: string
          p_requested_by: string
          p_resolve_dispute: boolean
        }
        Returns: Json
      }
      begin_refund_replacement: {
        Args: { p_actor: string; p_recovery: string }
        Returns: string
      }
      begin_request_refund_operation: {
        Args: {
          p_actor_role: string
          p_amount_cents: number
          p_dispute_outcome: string
          p_order_id: string
          p_payment_reference: string
          p_reason: string
          p_request_key: string
          p_requested_by: string
          p_resolve_dispute: boolean
        }
        Returns: Json
      }
      beta_access_status: {
        Args: { p_role?: string; p_user_id?: string }
        Returns: Json
      }
      bind_cart_checkout_payment: {
        Args: {
          p_buyer: string
          p_idempotency_key: string
          p_orders: string[]
          p_provider: string
          p_reference: string
        }
        Returns: Json
      }
      bind_checkout_analytics: {
        Args: { p_orders: string[] }
        Returns: undefined
      }
      bump_listing_view: { Args: { p_listing: string }; Returns: undefined }
      capture_reconciliation_candidates: { Args: never; Returns: Json }
      car_search_doc: {
        Args: {
          p_about: string
          p_make: string
          p_model: string
          p_name: string
          p_tags: string[]
          p_year: number
        }
        Returns: string
      }
      car_update_page: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_car: string
          p_limit?: number
        }
        Returns: {
          body: Json
          id: string
          intro: string
          published_at: string
          title: string
        }[]
      }
      charge_cents_in_bounds: { Args: { p_cents: number }; Returns: boolean }
      claim_listing_creation: {
        Args: { p_payload_hash: string; p_request: string }
        Returns: Json
      }
      claim_media_deletion: {
        Args: { p_bucket: string; p_path: string }
        Returns: Json
      }
      claim_outbound_label_void: {
        Args: { p_shipment: string; p_worker: string }
        Returns: Json
      }
      claim_refund_replacement_provider: {
        Args: { p_operation: string }
        Returns: string
      }
      claim_refund_reversal: {
        Args: {
          p_amount_cents: number
          p_currency: string
          p_lease_seconds?: number
          p_operation: string
          p_operation_key: string
          p_transfer_reference: string
          p_worker: string
        }
        Returns: string
      }
      claim_remediation_jobs: {
        Args: { p_kind: string; p_limit?: number }
        Returns: Json
      }
      claim_saved_search_digests: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          attempt: number
          digest_day: string
          digest_id: string
          href: string
          items: Json
          match_count: number
          recipient: string
          search_name: string
        }[]
      }
      claim_search_job_batch: { Args: { p_limit: number }; Returns: Json }
      claim_search_jobs: { Args: never; Returns: Json }
      claim_seller_carry_payouts: {
        Args: {
          p_batch: number
          p_lease_seconds: number
          p_max_attempts: number
          p_worker: string
        }
        Returns: {
          amount_cents: number
          attempts: number
          created_at: string
          currency: string
          destination: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          locked_by: string | null
          next_attempt_at: string | null
          paid_at: string | null
          provider_call_may_have_occurred: boolean
          seller_id: string | null
          status: string
          transfer_reference: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "seller_carry_payouts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_transfer_intents: {
        Args: {
          p_batch?: number
          p_lease_seconds?: number
          p_max_attempts?: number
          p_worker: string
        }
        Returns: {
          amount_cents: number
          attempts: number
          available_at: string | null
          created_at: string
          currency: string
          dispatch_amount_cents: number | null
          dispatch_carry_cents: number | null
          dispatch_currency: string | null
          dispatch_destination: string | null
          dispatch_source_transaction: string | null
          dispatch_transfer_group: string | null
          last_attempt_at: string | null
          last_error: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          next_attempt_at: string | null
          operation_key: string | null
          order_id: string
          provider_call_may_have_occurred: boolean
          seller_id: string | null
          source_transaction: string | null
          status: string
          transfer_reference: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "transfer_intents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_unmapped_payment_requests: { Args: never; Returns: Json }
      complete_listing_creation: {
        Args: { p_listing: string; p_payload_hash: string; p_request: string }
        Returns: boolean
      }
      complete_media_deletion: {
        Args: { p_bucket: string; p_path: string; p_token: string }
        Returns: boolean
      }
      complete_outbound_label: {
        Args: { p_label: Json; p_shipment: string }
        Returns: Json
      }
      complete_refund_reversal: {
        Args: {
          p_amount_cents: number
          p_currency: string
          p_operation: string
          p_operation_key: string
          p_reversal_reference: string
          p_transfer_reference: string
          p_worker: string
        }
        Returns: string
      }
      complete_return_label: {
        Args: { p_label: Json; p_return: string }
        Returns: Json
      }
      complete_saved_search_digest: {
        Args: {
          p_attempt: number
          p_error?: string
          p_id: string
          p_outcome: string
          p_provider_message_id?: string
        }
        Returns: string
      }
      complete_seller_carry_payout: {
        Args: { p_id: string; p_transfer_reference: string; p_worker: string }
        Returns: string
      }
      complete_stripe_dispute_loss: {
        Args: { p_dispute: string; p_event: string; p_lease: string }
        Returns: undefined
      }
      complete_transfer_intent: {
        Args: {
          p_operation_key: string
          p_order: string
          p_transfer_reference: string
          p_worker: string
        }
        Returns: string
      }
      confirm_admin_mfa: {
        Args: { p_confirmed_by: string; p_factor: string; p_user: string }
        Returns: Json
      }
      consume_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window: string }
        Returns: boolean
      }
      continue_account_deletion: {
        Args: { p_job: string; p_lease: string }
        Returns: undefined
      }
      continue_account_export: {
        Args: { p_job: string; p_lease: string }
        Returns: undefined
      }
      create_protection_return: {
        Args: {
          p_item_ids?: string[]
          p_order: string
          p_seller: string
          p_ship_days?: number
        }
        Returns: Json
      }
      create_shop_policy_return: {
        Args: { p_buyer: string; p_order: string; p_reason?: string }
        Returns: Json
      }
      delivery_auto_confirm_eligible: {
        Args: { p_order: string }
        Returns: boolean
      }
      discard_listing_creation: {
        Args: { p_payload_hash: string; p_request: string }
        Returns: boolean
      }
      edit_car_gallery: {
        Args: { p_car: string; p_operation: string; p_payload: Json }
        Returns: Json
      }
      enqueue_order_receipt: {
        Args: { p_buyer: string; p_destination: string }
        Returns: undefined
      }
      enqueue_search_document: {
        Args: { p_entity: string; p_id: string }
        Returns: undefined
      }
      escalate_stale_disputes: { Args: never; Returns: number }
      execute_admin_command: {
        Args: {
          p_action: string
          p_data?: Json
          p_reason: string
          p_subject: string
        }
        Returns: Json
      }
      explore_build_rows: {
        Args: { p_query: string }
        Returns: {
          about: string | null
          body_class: string | null
          catalog_make_id: number | null
          catalog_model_id: number | null
          color: string | null
          cover_focal_x: number | null
          cover_focal_y: number | null
          cover_image_url: string | null
          created_at: string
          drivetrain: string | null
          engine: string | null
          generation_id: number | null
          generation_source: string | null
          id: string
          identity_source: string | null
          is_public: boolean
          make: string | null
          make_key: string | null
          model: string | null
          model_key: string | null
          name: string
          owner_id: string
          slug: string
          tags: string[]
          trim: string | null
          updated_at: string
          vin: string | null
          vin_decoded_at: string | null
          year: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "cars"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      explore_update_page: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_by_car_up_to?: number
          p_limit?: number
          p_make?: string
          p_make_id?: number
          p_model?: string
          p_model_id?: number
          p_offset?: number
          p_ymax?: number
          p_ymin?: number
        }
        Returns: {
          author_id: string
          body: Json
          car_id: string | null
          created_at: string
          draft_archived_at: string | null
          draft_key: string | null
          id: string
          intro: string | null
          publish_operation_id: string | null
          published_at: string | null
          search_text: string | null
          title: string | null
          updated_at: string
          video_url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "activity_posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      explore_update_rows: {
        Args: {
          p_make?: string
          p_make_id?: number
          p_model?: string
          p_model_id?: number
          p_query?: string
          p_ymax?: number
          p_ymin?: number
        }
        Returns: {
          author_id: string
          body: Json
          car_id: string | null
          created_at: string
          draft_archived_at: string | null
          draft_key: string | null
          id: string
          intro: string | null
          publish_operation_id: string | null
          published_at: string | null
          search_text: string | null
          title: string | null
          updated_at: string
          video_url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "activity_posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      explore_update_search_rows: {
        Args: {
          p_make?: string
          p_make_id?: number
          p_model?: string
          p_model_id?: number
          p_query: string
          p_ymax?: number
          p_ymin?: number
        }
        Returns: {
          author_id: string
          body: Json
          car_id: string | null
          created_at: string
          draft_archived_at: string | null
          draft_key: string | null
          id: string
          intro: string | null
          publish_operation_id: string | null
          published_at: string | null
          search_text: string | null
          title: string | null
          updated_at: string
          video_url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "activity_posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      feed_event_page: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_exclude_owner?: string
          p_kinds: string[]
          p_limit: number
          p_offset?: number
        }
        Returns: {
          happened_at: string
          id: string
          kind: string
        }[]
      }
      feed_hydration: {
        Args: {
          p_car_ids: string[]
          p_listing_ids: string[]
          p_post_ids: string[]
          p_viewer?: string
        }
        Returns: Json
      }
      finish_capture_check: {
        Args: { p_reference: string }
        Returns: undefined
      }
      finish_remediation_job: {
        Args: { p_error?: string; p_id: string; p_lease: string }
        Returns: undefined
      }
      finish_reservation_expiry: {
        Args: { p_job: string; p_lease: string; p_reference?: string }
        Returns: Json
      }
      followed_feed_rows: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          happened_at: string
          id: string
          kind: string
          seller_id: string
        }[]
      }
      freeze_accepted_offer_checkout: {
        Args: { p_actor: string; p_order: string; p_shipping: Json }
        Returns: Json
      }
      freeze_cart_checkout_shipping: {
        Args: { p_buyer: string; p_idempotency_key: string; p_order: string }
        Returns: Json
      }
      freeze_transfer_carry: {
        Args: { p_order: string; p_payable_cents: number; p_worker: string }
        Returns: number
      }
      garage_car_stats: {
        Args: { p_cars: string[] }
        Returns: {
          car_id: string
          followers: number
          latest_update: Json
          likes: number
          mods: number
          open_offers: number
          parts_held: number
          parts_live: number
          parts_sold: number
          sales_cents: number
          sales_count: number
          updates: number
        }[]
      }
      grow_products: { Args: { p_full?: boolean }; Returns: Json }
      has_embedded_media_reference: {
        Args: { p_url: string }
        Returns: boolean
      }
      hold_refund_reversal: {
        Args: {
          p_detail: string
          p_next_attempt_at: string
          p_operation: string
          p_operation_key: string
          p_worker: string
        }
        Returns: string
      }
      hold_stripe_dispute: {
        Args: { p_detail: string; p_dispute: string }
        Returns: string
      }
      identifier_matches_listing: {
        Args: { p_compact: string; p_id: string }
        Returns: boolean
      }
      invoke_remediation_worker: {
        Args: { p_family: string }
        Returns: undefined
      }
      invoke_transfer_worker: { Args: never; Returns: undefined }
      is_admin: { Args: never; Returns: boolean }
      is_suspended: { Args: { uid: string }; Returns: boolean }
      is_trusted_writer: { Args: never; Returns: boolean }
      list_conversations: {
        Args: {
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_query?: string
        }
        Returns: {
          counterparty_id: string
          id: string
          last_message_at: string
          last_message_id: string
          last_message_preview: string
          total_count: number
          unread_count: number
        }[]
      }
      listing_commercial_snapshot: {
        Args: {
          p_listing_id: string
          p_price_cents: number
          p_shipping_cents: number
        }
        Returns: Json
      }
      listing_edit_status: {
        Args: { p_listing: string; p_request: string }
        Returns: Json
      }
      listing_engagement_counts: {
        Args: { p_listings: string[] }
        Returns: {
          likes: number
          listing_id: string
          questions: number
        }[]
      }
      listing_enquiry_reply_allowed: {
        Args: { p_buyer: string; p_listing: string }
        Returns: boolean
      }
      listing_public_offer_floor: {
        Args: { p_listing: string }
        Returns: number
      }
      listing_question_parent_matches: {
        Args: { p_listing_id: string; p_parent_id: string }
        Returns: boolean
      }
      listing_search_doc: {
        Args: {
          p_brand: string
          p_category: string
          p_compatibility_notes: string
          p_description: string
          p_title: string
        }
        Returns: string
      }
      listing_watch_counts: {
        Args: { p_listings: string[] }
        Returns: {
          listing_id: string
          watchers: number
        }[]
      }
      local_feed_rows: {
        Args: { p_country: string; p_region?: string }
        Returns: {
          happened_at: string
          id: string
          kind: string
        }[]
      }
      mark_due_transfer_intents: { Args: never; Returns: number }
      mark_media_deletion_uncertain: {
        Args: { p_bucket: string; p_path: string; p_token: string }
        Returns: boolean
      }
      mark_order_dispatched: {
        Args: {
          p_actor: string
          p_carrier: string
          p_order: string
          p_tracker_provider?: string
          p_tracker_ref?: string
          p_tracking: string
        }
        Returns: Json
      }
      mark_order_received: {
        Args: { p_actor: string; p_hold_days?: number; p_order: string }
        Returns: Json
      }
      mark_return_dispatched: {
        Args: {
          p_actor: string
          p_carrier: string
          p_return: string
          p_tracking: string
        }
        Returns: Json
      }
      marketplace_brand_counts: {
        Args: never
        Returns: {
          brand: string
          total: number
        }[]
      }
      marketplace_browse_rows: {
        Args: {
          p_fit?: boolean
          p_query?: string
          p_vehicle?: string
          p_viewer?: string
          p_vyear?: number
          p_ymax?: number
          p_ymin?: number
        }
        Returns: {
          allows_collection: boolean
          brand: string | null
          brand_key: string | null
          category: string
          compatibility_notes: string | null
          condition: string | null
          condition_checklist: Json | null
          created_at: string
          currency: string
          description: string | null
          grade: string | null
          height_in: number | null
          id: string
          length_in: number | null
          location: string | null
          part_miles: number | null
          part_miles_unit: string | null
          part_number: string | null
          part_number_compact: string | null
          price_cents: number
          published_at: string | null
          published_xact: number | null
          removed_at: string | null
          removed_reason: string | null
          reserved_until: string | null
          seller_id: string
          shipping_cents: number
          shipping_mode: string
          show_offer_floor: boolean
          sold_at: string | null
          source_car_id: string | null
          status: string
          subcategory: string | null
          title: string
          updated_at: string
          view_count: number
          weight_oz: number | null
          width_in: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      marketplace_category_counts: {
        Args: never
        Returns: {
          category: string
          subcategory: string
          total: number
        }[]
      }
      marketplace_count: {
        Args: {
          p_brand?: string
          p_cap?: number
          p_category?: string
          p_condition?: string
          p_fit?: boolean
          p_ids?: string[]
          p_location?: string
          p_max_cents?: number
          p_min_cents?: number
          p_query?: string
          p_subcategory?: string
          p_vehicle?: string
          p_vyear?: number
          p_ymax?: number
          p_ymin?: number
        }
        Returns: number
      }
      marketplace_filtered_rows: {
        Args: {
          p_fit?: boolean
          p_make?: string
          p_make_id?: number
          p_model?: string
          p_model_id?: number
          p_query?: string
          p_ymax?: number
          p_ymin?: number
        }
        Returns: {
          allows_collection: boolean
          brand: string | null
          brand_key: string | null
          category: string
          compatibility_notes: string | null
          condition: string | null
          condition_checklist: Json | null
          created_at: string
          currency: string
          description: string | null
          grade: string | null
          height_in: number | null
          id: string
          length_in: number | null
          location: string | null
          part_miles: number | null
          part_miles_unit: string | null
          part_number: string | null
          part_number_compact: string | null
          price_cents: number
          published_at: string | null
          published_xact: number | null
          removed_at: string | null
          removed_reason: string | null
          reserved_until: string | null
          seller_id: string
          shipping_cents: number
          shipping_mode: string
          show_offer_floor: boolean
          sold_at: string | null
          source_car_id: string | null
          status: string
          subcategory: string | null
          title: string
          updated_at: string
          view_count: number
          weight_oz: number | null
          width_in: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      marketplace_match_evidence: {
        Args: {
          p_listing: string
          p_make: string
          p_model: string
          p_viewer?: string
          p_year?: number
        }
        Returns: string
      }
      marketplace_page: {
        Args: {
          p_after_created?: string
          p_after_id?: string
          p_after_price?: number
          p_before?: boolean
          p_brand?: string
          p_category?: string
          p_condition?: string
          p_fit?: boolean
          p_ids?: string[]
          p_limit?: number
          p_location?: string
          p_max_cents?: number
          p_min_cents?: number
          p_offset?: number
          p_query?: string
          p_sort?: string
          p_subcategory?: string
          p_vehicle?: string
          p_vyear?: number
          p_ymax?: number
          p_ymin?: number
        }
        Returns: {
          allows_collection: boolean
          brand: string | null
          brand_key: string | null
          category: string
          compatibility_notes: string | null
          condition: string | null
          condition_checklist: Json | null
          created_at: string
          currency: string
          description: string | null
          grade: string | null
          height_in: number | null
          id: string
          length_in: number | null
          location: string | null
          part_miles: number | null
          part_miles_unit: string | null
          part_number: string | null
          part_number_compact: string | null
          price_cents: number
          published_at: string | null
          published_xact: number | null
          removed_at: string | null
          removed_reason: string | null
          reserved_until: string | null
          seller_id: string
          shipping_cents: number
          shipping_mode: string
          show_offer_floor: boolean
          sold_at: string | null
          source_car_id: string | null
          status: string
          subcategory: string | null
          title: string
          updated_at: string
          view_count: number
          weight_oz: number | null
          width_in: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      marketplace_query_sql: {
        Args: {
          p_after_created: string
          p_after_id: string
          p_after_price: number
          p_before: boolean
          p_brand: string
          p_cap: number
          p_category: string
          p_condition: string
          p_fit: boolean
          p_ids?: string[]
          p_limit: number
          p_location: string
          p_max_cents: number
          p_min_cents: number
          p_mode: string
          p_offset: number
          p_query: string
          p_sort: string
          p_subcategory: string
          p_vehicle: string
          p_vyear: number
          p_ymax: number
          p_ymin: number
        }
        Returns: string
      }
      marketplace_search_browse_rows: {
        Args: {
          p_fit?: boolean
          p_query: string
          p_vehicle?: string
          p_viewer?: string
          p_vyear?: number
          p_ymax?: number
          p_ymin?: number
        }
        Returns: {
          allows_collection: boolean
          brand: string | null
          brand_key: string | null
          category: string
          compatibility_notes: string | null
          condition: string | null
          condition_checklist: Json | null
          created_at: string
          currency: string
          description: string | null
          grade: string | null
          height_in: number | null
          id: string
          length_in: number | null
          location: string | null
          part_miles: number | null
          part_miles_unit: string | null
          part_number: string | null
          part_number_compact: string | null
          price_cents: number
          published_at: string | null
          published_xact: number | null
          removed_at: string | null
          removed_reason: string | null
          reserved_until: string | null
          seller_id: string
          shipping_cents: number
          shipping_mode: string
          show_offer_floor: boolean
          sold_at: string | null
          source_car_id: string | null
          status: string
          subcategory: string | null
          title: string
          updated_at: string
          view_count: number
          weight_oz: number | null
          width_in: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      marketplace_search_capped_ids: {
        Args: {
          p_brand?: string
          p_cap?: number
          p_category?: string
          p_condition?: string
          p_location?: string
          p_max_cents?: number
          p_min_cents?: number
          p_query: string
          p_subcategory?: string
        }
        Returns: string[]
      }
      marketplace_search_ids: { Args: { p_query: string }; Returns: string[] }
      marketplace_search_rows: {
        Args: { p_query: string }
        Returns: {
          allows_collection: boolean
          brand: string | null
          brand_key: string | null
          category: string
          compatibility_notes: string | null
          condition: string | null
          condition_checklist: Json | null
          created_at: string
          currency: string
          description: string | null
          grade: string | null
          height_in: number | null
          id: string
          length_in: number | null
          location: string | null
          part_miles: number | null
          part_miles_unit: string | null
          part_number: string | null
          part_number_compact: string | null
          price_cents: number
          published_at: string | null
          published_xact: number | null
          removed_at: string | null
          removed_reason: string | null
          reserved_until: string | null
          seller_id: string
          shipping_cents: number
          shipping_mode: string
          show_offer_floor: boolean
          sold_at: string | null
          source_car_id: string | null
          status: string
          subcategory: string | null
          title: string
          updated_at: string
          view_count: number
          weight_oz: number | null
          width_in: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      media_object_referenced: {
        Args: { p_bucket: string; p_path: string }
        Returns: boolean
      }
      merge_products: {
        Args: { p_actor?: string; p_basis?: string; p_products: string[] }
        Returns: string
      }
      mod_purchase_sources: {
        Args: { p_order_item_ids: string[] }
        Returns: {
          order_item_id: string
          source_car_id: string
        }[]
      }
      mod_search_doc: {
        Args: { p_brand: string; p_part_number: string; p_product: string }
        Returns: string
      }
      my_account_deletion_status: { Args: never; Returns: Json }
      my_car_vin: { Args: { p_car: string }; Returns: string }
      my_default_offer_floor: { Args: never; Returns: number }
      my_listing_offer_floor: { Args: { p_listing: string }; Returns: number }
      notification_href_target: { Args: { p_href: string }; Returns: string }
      notify: {
        Args: {
          p_actor_id?: string
          p_body?: string
          p_href?: string
          p_kind: string
          p_section: string
          p_title: string
          p_user_id: string
        }
        Returns: undefined
      }
      offer_accept_begin: {
        Args: {
          p_offer_id: string
          p_reservation_window?: string
          p_seller_id: string
        }
        Returns: string
      }
      offer_effective_floor: { Args: { p_listing: string }; Returns: number }
      offer_move: {
        Args: {
          p_amount: number
          p_expected_round: number
          p_idempotency_key: string
          p_kind: string
          p_offer: string
        }
        Returns: Json
      }
      offer_move_core: {
        Args: {
          p_actor: string
          p_agent?: Json
          p_amount: number
          p_expected_round: number
          p_idempotency_key: string
          p_kind: string
          p_offer: string
        }
        Returns: Json
      }
      offer_open: {
        Args: {
          p_amount: number
          p_listing: string
          p_message?: string
          p_offer: string
        }
        Returns: Json
      }
      offer_open_core: {
        Args: {
          p_actor: string
          p_agent?: Json
          p_amount: number
          p_listing: string
          p_message?: string
          p_offer: string
        }
        Returns: Json
      }
      open_seller_carry_payouts: {
        Args: { p_limit?: number; p_quiet_hours?: number }
        Returns: number
      }
      order_buyer_reviewable: { Args: { p_order: string }; Returns: boolean }
      pause_account_deletion_hold: {
        Args: { p_job: string; p_lease: string; p_user: string }
        Returns: undefined
      }
      payout_available_at: {
        Args: { p_delivered_at: string; p_order: string }
        Returns: string
      }
      payout_release_at: {
        Args: { p_delivered_at: string; p_now: boolean; p_order: string }
        Returns: string
      }
      pickup_mint_pass: {
        Args: {
          p_buyer_id: string
          p_code_hash: string
          p_expires_at: string
          p_order_id: string
          p_token_hash: string
        }
        Returns: Json
      }
      pickup_redeem: {
        Args: { p_hash: string; p_order_id: string; p_seller_id: string }
        Returns: Json
      }
      post_comment_page: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_post: string
        }
        Returns: {
          author_display_name: string
          author_id: string
          author_username: string
          body: string
          created_at: string
          id: string
        }[]
      }
      post_href: { Args: { p_post_id: string }; Returns: string }
      post_reaction_counts: {
        Args: { p_post: string }
        Returns: {
          emoji: string
          reacted: boolean
          total: number
        }[]
      }
      post_search_doc: {
        Args: { p_intro: string; p_search_text: string; p_title: string }
        Returns: string
      }
      prepare_beta_signup: {
        Args: { p_email: string; p_token_hash: string }
        Returns: string
      }
      prepare_outbound_label: {
        Args: {
          p_actor: string
          p_provider: string
          p_rated: Json
          p_shipment: string
        }
        Returns: Json
      }
      prepare_outbound_label_void: {
        Args: { p_actor: string; p_provider: string; p_shipment: string }
        Returns: Json
      }
      prepare_payment_request: {
        Args: { p_key: string; p_request: Json }
        Returns: Json
      }
      prepare_return_label: {
        Args: {
          p_actor: string
          p_provider: string
          p_rated: Json
          p_return: string
        }
        Returns: Json
      }
      prepare_seller_carry_payout: {
        Args: { p_destination: string; p_id: string; p_worker: string }
        Returns: string
      }
      prepare_transfer_dispatch: {
        Args: {
          p_amount_cents: number
          p_currency: string
          p_destination: string
          p_operation_key: string
          p_order: string
          p_source_transaction: string
          p_transfer_group: string
          p_worker: string
        }
        Returns: boolean
      }
      price_comparables: {
        Args: {
          p_brand: string
          p_currency?: string
          p_exclude_listing?: string
          p_part_number: string
        }
        Returns: Json
      }
      product_coverage: { Args: never; Returns: Json }
      profile_follow_counts: {
        Args: { p_profile: string }
        Returns: {
          followers: number
          following: number
        }[]
      }
      profile_is_visible: { Args: { p_id: string }; Returns: boolean }
      profile_sales_count: { Args: { p_profile: string }; Returns: number }
      profile_shares_deal_with_me: { Args: { p_id: string }; Returns: boolean }
      prune_listing_edit_requests: { Args: never; Returns: number }
      prune_rate_limits: { Args: never; Returns: undefined }
      purchase_begin: {
        Args: {
          p_buyer_id: string
          p_checkout_context?: Json
          p_checkout_request_key?: string
          p_idempotency_key?: string
          p_listing_ids: string[]
          p_reservation_window?: string
          p_shipping_overrides?: Json
        }
        Returns: Json
      }
      purchase_claim_key: {
        Args: { p_buyer_id: string; p_idempotency_key: string }
        Returns: Json
      }
      purchase_finalize: {
        Args: {
          p_failure_reason?: string
          p_order_id: string
          p_provider?: string
          p_reference?: string
          p_success: boolean
        }
        Returns: Json
      }
      recommend_listings: {
        Args: { p_limit?: number; p_user: string }
        Returns: {
          condition: string
          id: string
          location: string
          part_number: string
          price_cents: number
          reason: string
          score: number
          seller_id: string
          shipping_cents: number
          source_car_id: string
          status: string
          title: string
        }[]
      }
      reconcile_admin_external_operation: {
        Args: {
          p_operation: string
          p_outcome: string
          p_reason: string
          p_seen_through: number
        }
        Returns: Json
      }
      record_capture_recovery: {
        Args: { p_amount?: number; p_detail: string; p_key: string }
        Returns: string
      }
      record_listing_edit: {
        Args: {
          p_expected_updated_at: string
          p_listing: string
          p_payload_hash: string
          p_request: string
          p_result: Json
        }
        Returns: undefined
      }
      record_listing_view: {
        Args: { p_arrival: string; p_listing: string }
        Returns: boolean
      }
      record_outbound_label_void_observation: {
        Args: {
          p_attempt: number
          p_detail?: string
          p_observed_at: string
          p_shipment: string
          p_source: string
          p_state: string
          p_worker: string
        }
        Returns: Json
      }
      record_outbound_label_void_observation_unfenced: {
        Args: {
          p_detail?: string
          p_shipment: string
          p_source: string
          p_state: string
          p_worker: string
        }
        Returns: Json
      }
      record_payment_reference: {
        Args: { p_key: string; p_reference: string }
        Returns: undefined
      }
      record_payment_request_rejection: {
        Args: { p_key: string; p_reason: string }
        Returns: Json
      }
      record_refund_provider_event: {
        Args: {
          p_amount_cents: number
          p_balance_transaction?: string
          p_currency: string
          p_event_id: string
          p_failure_balance_transaction?: string
          p_failure_reason?: string
          p_operation_id: string
          p_order_id: string
          p_payment_reference: string
          p_pending_reason?: string
          p_provider_created_at: string
          p_provider_status: string
          p_refund_reference: string
        }
        Returns: Json
      }
      record_refund_recredit_proof: {
        Args: {
          p_actor: string
          p_adjustment: string
          p_amount: number
          p_balance_transaction?: string
          p_currency: string
          p_recovery: string
          p_reversal?: string
          p_transfer?: string
        }
        Returns: undefined
      }
      record_seller_carry: {
        Args: {
          p_adjustment: string
          p_amount: number
          p_key: string
          p_kind: string
          p_order: string
          p_seller: string
        }
        Returns: undefined
      }
      record_transfer_recovery: {
        Args: {
          p_amount?: number
          p_detail: string
          p_key: string
          p_order: string
          p_worker: string
        }
        Returns: string
      }
      record_webhook_failure: {
        Args: { p_detail?: string; p_id: string; p_kind: string }
        Returns: number
      }
      record_worker_run: {
        Args: {
          p_family: string
          p_id: string
          p_status: string
          p_summary?: Json
        }
        Returns: undefined
      }
      refresh_explore_builders: { Args: never; Returns: undefined }
      refresh_explore_rankings: { Args: never; Returns: undefined }
      refresh_explore_trending: { Args: never; Returns: undefined }
      refresh_listing_vehicle_fit: {
        Args: { p_listings: string[]; p_lock?: boolean }
        Returns: undefined
      }
      refresh_marketplace_facet_counts: { Args: never; Returns: undefined }
      refresh_search_words: { Args: never; Returns: undefined }
      release_cart_checkout: {
        Args: {
          p_buyer: string
          p_idempotency_key: string
          p_reference?: string
        }
        Returns: Json
      }
      release_expired_reservations: { Args: never; Returns: Json }
      release_media_claim: {
        Args: { p_bucket: string; p_path: string; p_token: string }
        Returns: boolean
      }
      release_refused_admin_refund: {
        Args: { p_actor: string; p_detail: string; p_operation: string }
        Returns: Json
      }
      release_seller_carry_payout: {
        Args: {
          p_attempts: number
          p_id: string
          p_last_error: string
          p_next_attempt_at: string
          p_status: string
          p_worker: string
        }
        Returns: boolean
      }
      release_transfer_intent: {
        Args: {
          p_attempts?: number
          p_last_error?: string
          p_next_attempt_at?: string
          p_order: string
          p_status: string
          p_worker: string
        }
        Returns: boolean
      }
      remap_public_media: {
        Args: { p_new: string; p_old: string }
        Returns: Json
      }
      renew_refund_reversal_lease: {
        Args: {
          p_lease_seconds?: number
          p_operation: string
          p_operation_key: string
          p_worker: string
        }
        Returns: boolean
      }
      renew_remediation_lease: {
        Args: { p_id: string; p_lease: string }
        Returns: undefined
      }
      repair_completed_outbound_label: {
        Args: { p_actor: string; p_shipment: string }
        Returns: Json
      }
      replay_listing_edit: {
        Args: {
          p_expected_updated_at: string
          p_listing: string
          p_payload_hash: string
          p_request: string
        }
        Returns: Json
      }
      request_account_deletion: { Args: never; Returns: Json }
      request_account_export: { Args: never; Returns: string }
      resolve_product_identity_review: {
        Args: { p_decision: string; p_reason: string; p_review: string }
        Returns: Json
      }
      resolve_vehicle_generation: {
        Args: { p_model_id: number; p_year: number }
        Returns: number
      }
      respond_shop_policy_return: {
        Args: {
          p_decision: string
          p_return: string
          p_seller: string
          p_ship_days?: number
        }
        Returns: Json
      }
      save_listing_creation: {
        Args: {
          p_alt_numbers: Json
          p_fitments: Json
          p_images: Json
          p_listing: Json
          p_mod_item?: string
          p_payload_hash: string
          p_request: string
        }
        Returns: Json
      }
      save_listing_edit: {
        Args: {
          p_alt_numbers: Json
          p_expected_updated_at: string
          p_fields: Json
          p_fitments: Json
          p_images: Json
          p_listing: string
          p_payload_hash: string
          p_request: string
        }
        Returns: Json
      }
      save_marketplace_search: {
        Args: { p_name: string; p_params: Json }
        Returns: string
      }
      save_mod_items: {
        Args: { p_car_id: string; p_items: Json }
        Returns: Json
      }
      saved_counts: {
        Args: never
        Returns: {
          builds: number
          followed_builds: number
          followed_sellers: number
          parts: number
          posts: number
          unavailable_parts: number
        }[]
      }
      saved_listing_page: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_sort?: string
        }
        Returns: {
          listing_id: string
          total: number
        }[]
      }
      saved_page: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_collection: string
          p_limit?: number
        }
        Returns: {
          saved_at: string
          target_id: string
        }[]
      }
      saved_search_digest_sweep: { Args: never; Returns: Json }
      saved_search_digests_due: {
        Args: { p_limit?: number }
        Returns: {
          checked_through: string
          checked_xact: number
          params: Json
          saved_search_id: string
          user_id: string
          window_end: string
          window_floor: string
          window_xact: number
        }[]
      }
      search_car_ids: { Args: { p_query: string }; Returns: string[] }
      search_listing_documents: {
        Args: { p_ids: string[] }
        Returns: {
          doc: Json
          id: string
        }[]
      }
      search_listing_ids: { Args: { p_query: string }; Returns: string[] }
      search_profile_ids: { Args: { p_query: string }; Returns: string[] }
      search_update_ids: { Args: { p_query: string }; Returns: string[] }
      search_user_messages: { Args: { p_query: string }; Returns: string[] }
      search_word_corrections: {
        Args: { p_query: string }
        Returns: {
          correction: string
          word: string
        }[]
      }
      seller_active_counts: {
        Args: { p_sellers: string[] }
        Returns: {
          seller_id: string
          total: number
        }[]
      }
      seller_carry_available_cents: {
        Args: { p_except_order: string; p_seller: string }
        Returns: number
      }
      seller_listing_stats: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_register?: string
          p_seller: string
          p_sort?: string
        }
        Returns: {
          cover_url: string
          created_at: string
          id: string
          part_number: string
          price_cents: number
          soonest_offer_expiry: string
          source_car_id: string
          status: string
          title: string
          top_offer_cents: number
          total_count: number
          unanswered_questions: number
          view_count: number
          watch_count: number
        }[]
      }
      seller_open_question_list: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          created_at: string
          id: string
          listing_id: string
          listing_title: string
        }[]
      }
      seller_open_questions: { Args: { p_seller: string }; Returns: number }
      seller_payout_dates: {
        Args: { p_orders: string[] }
        Returns: {
          available_at: string
          order_id: string
        }[]
      }
      seller_register_tally: {
        Args: { p_seller: string }
        Returns: {
          all_count: number
          archived_count: number
          draft_count: number
          live_count: number
          offer_count: number
          paused_count: number
          reserved_count: number
          sold_count: number
        }[]
      }
      seller_review_summaries: {
        Args: { p_sellers: string[] }
        Returns: {
          rating_avg: number
          review_count: number
          seller_id: string
        }[]
      }
      set_analytics_consent: {
        Args: { p_allowed: boolean }
        Returns: undefined
      }
      set_listing_offer_floor: {
        Args: { p_floor: number; p_listing: string }
        Returns: undefined
      }
      set_social_relationship: {
        Args: {
          p_active: boolean
          p_kind: string
          p_target_id: string
          p_target_type: string
        }
        Returns: boolean
      }
      settle_payment_capture: {
        Args: {
          p_amount: number
          p_buyer: string
          p_currency: string
          p_order_ids: string[]
          p_reference: string
          p_source: string
        }
        Returns: Json
      }
      settle_refund_operation: {
        Args: { p_operation_id: string }
        Returns: Json
      }
      settle_seller_cancellation: {
        Args: { p_actor: string; p_order: string; p_reason?: string }
        Returns: Json
      }
      settlement_hold_policy: {
        Args: never
        Returns: {
          auto_confirm_after_days: number
          auto_confirm_notice_days: number
          card_verification_on: boolean
          payout_hold_days: number
          payout_hold_mode: string
          receipt_release_after_days: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sitemap_post_page: {
        Args: { p_count: number; p_start: number }
        Returns: {
          car_slug: string
          id: string
          updated_at: string
        }[]
      }
      suggested_builders: {
        Args: { p_limit?: number; p_viewer?: string }
        Returns: {
          avatar_url: string
          car_count: number
          display_name: string
          headline: string
          id: string
          update_count: number
          username: string
        }[]
      }
      suspended_profile_ids: { Args: never; Returns: string[] }
      sync_activity_post_listings: {
        Args: { p_listing_ids: string[]; p_post_id: string }
        Returns: undefined
      }
      trending_models: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          builds: number
          catalog_make_id: number
          catalog_model_id: number
          make: string
          model: string
          updates: number
        }[]
      }
      trending_models_live: {
        Args: { p_days: number; p_limit: number }
        Returns: {
          builds: number
          catalog_make_id: number
          catalog_model_id: number
          make: string
          model: string
          updates: number
        }[]
      }
      update_listing_atomic: {
        Args: {
          p_alt_numbers: Json
          p_expected_updated_at: string
          p_fields: Json
          p_fitments: Json
          p_images: Json
          p_listing: string
        }
        Returns: Json
      }
      worker_health_snapshot: { Args: never; Returns: Json }
      write_account_export: {
        Args: {
          p_checkpoint?: Json
          p_error?: string
          p_job: string
          p_lease: string
          p_manifest?: Json
          p_part?: Json
          p_request: string
        }
        Returns: undefined
      }
      write_activity_post: {
        Args: {
          p_body?: Json
          p_car_id: string
          p_image_urls?: string[]
          p_intro?: string
          p_listing_ids?: string[]
          p_mode: string
          p_post_id: string
          p_title: string
          p_video_url?: string
        }
        Returns: {
          outcome: string
          post_id: string
        }[]
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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

