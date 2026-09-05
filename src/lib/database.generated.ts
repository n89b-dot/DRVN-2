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
      activity_posts: {
        Row: {
          author_id: string
          body: Json
          car_id: string
          created_at: string
          id: string
          intro: string | null
          published_at: string | null
          search_text: string | null
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          author_id: string
          body?: Json
          car_id: string
          created_at?: string
          id?: string
          intro?: string | null
          published_at?: string | null
          search_text?: string | null
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          author_id?: string
          body?: Json
          car_id?: string
          created_at?: string
          id?: string
          intro?: string | null
          published_at?: string | null
          search_text?: string | null
          title?: string
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
          note: string | null
          role: string
          sessions_valid_after: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          role?: string
          sessions_valid_after?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          role?: string
          sessions_valid_after?: string | null
          user_id?: string
        }
        Relationships: []
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
          id: string
          identity_source: string | null
          is_public: boolean
          make: string | null
          model: string | null
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
          id?: string
          identity_source?: string | null
          is_public?: boolean
          make?: string | null
          model?: string | null
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
          id?: string
          identity_source?: string | null
          is_public?: boolean
          make?: string | null
          model?: string | null
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
          listing_id: string | null
          offer_id: string | null
          order_id: string | null
          participant_a: string
          participant_b: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_id?: string | null
          last_message_preview?: string | null
          listing_id?: string | null
          offer_id?: string | null
          order_id?: string | null
          participant_a: string
          participant_b: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_id?: string | null
          last_message_preview?: string | null
          listing_id?: string | null
          offer_id?: string | null
          order_id?: string | null
          participant_a?: string
          participant_b?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: true
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
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
      listings: {
        Row: {
          allows_collection: boolean
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
          offer_floor_cents: number | null
          part_number: string | null
          part_number_compact: string | null
          price_cents: number
          removed_at: string | null
          removed_reason: string | null
          reserved_until: string | null
          seller_id: string
          shipping_cents: number
          shipping_mode: string
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
          offer_floor_cents?: number | null
          part_number?: string | null
          part_number_compact?: string | null
          price_cents: number
          removed_at?: string | null
          removed_reason?: string | null
          reserved_until?: string | null
          seller_id: string
          shipping_cents?: number
          shipping_mode?: string
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
          offer_floor_cents?: number | null
          part_number?: string | null
          part_number_compact?: string | null
          price_cents?: number
          removed_at?: string | null
          removed_reason?: string | null
          reserved_until?: string | null
          seller_id?: string
          shipping_cents?: number
          shipping_mode?: string
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
      messages: {
        Row: {
          body: string
          conversation_id: string | null
          created_at: string
          id: string
          listing_id: string | null
          offer_id: string | null
          order_id: string | null
          read_at: string | null
          recipient_id: string
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          offer_id?: string | null
          order_id?: string | null
          read_at?: string | null
          recipient_id: string
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
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
          car_id: string
          category: string | null
          confidence: number | null
          created_at: string
          group_label: string
          id: string
          linked_listing_id: string | null
          part_number: string | null
          position: number
          product: string | null
          raw_text: string | null
          updated_at: string
        }
        Insert: {
          brand?: string | null
          car_id: string
          category?: string | null
          confidence?: number | null
          created_at?: string
          group_label?: string
          id?: string
          linked_listing_id?: string | null
          part_number?: string | null
          position?: number
          product?: string | null
          raw_text?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string | null
          car_id?: string
          category?: string | null
          confidence?: number | null
          created_at?: string
          group_label?: string
          id?: string
          linked_listing_id?: string | null
          part_number?: string | null
          position?: number
          product?: string | null
          raw_text?: string | null
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
      offers: {
        Row: {
          amount_cents: number
          buyer_id: string
          counter_amount_cents: number | null
          countered_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          listing_id: string
          responded_at: string | null
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
          listing_id: string
          responded_at?: string | null
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
          listing_id?: string
          responded_at?: string | null
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
          subtotal_cents: number
          total_cents: number
          tracking_number: string | null
          transfer_reference: string | null
          transferred_at: string | null
          updated_at: string
        }
        Insert: {
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
          subtotal_cents?: number
          total_cents?: number
          tracking_number?: string | null
          transfer_reference?: string | null
          transferred_at?: string | null
          updated_at?: string
        }
        Update: {
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
      part_number_links: {
        Row: {
          created_at: string
          from_compact: string
          id: string
          kind: string
          source: string
          to_compact: string
        }
        Insert: {
          created_at?: string
          from_compact: string
          id?: string
          kind: string
          source?: string
          to_compact: string
        }
        Update: {
          created_at?: string
          from_compact?: string
          id?: string
          kind?: string
          source?: string
          to_compact?: string
        }
        Relationships: []
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
          request: Json
        }
        Insert: {
          correlation_id?: string
          created_at?: string
          next_reconcile_at?: string
          operation_key: string
          provider_reference?: string | null
          request: Json
        }
        Update: {
          correlation_id?: string
          created_at?: string
          next_reconcile_at?: string
          operation_key?: string
          provider_reference?: string | null
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
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          headline: string | null
          id: string
          import_attested_at: string | null
          links: Json
          location: string | null
          notification_prefs: Json
          payouts_enabled: boolean
          profile_type: string
          stripe_account_id: string | null
          stripe_customer_id: string | null
          suspended_at: string | null
          suspended_reason: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          headline?: string | null
          id: string
          import_attested_at?: string | null
          links?: Json
          location?: string | null
          notification_prefs?: Json
          payouts_enabled?: boolean
          profile_type?: string
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          headline?: string | null
          id?: string
          import_attested_at?: string | null
          links?: Json
          location?: string | null
          notification_prefs?: Json
          payouts_enabled?: boolean
          profile_type?: string
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      purchase_attempts: {
        Row: {
          buyer_id: string | null
          created_at: string
          idempotency_key: string
          request_fingerprint: Json | null
          result: Json
        }
        Insert: {
          buyer_id?: string | null
          created_at?: string
          idempotency_key: string
          request_fingerprint?: Json | null
          result: Json
        }
        Update: {
          buyer_id?: string | null
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
          requested_by: string
          resolve_dispute: boolean
          reversal_completed_at: string | null
          reversal_due_cents: number | null
          reversal_reference: string | null
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
          requested_by: string
          resolve_dispute?: boolean
          reversal_completed_at?: string | null
          reversal_due_cents?: number | null
          reversal_reference?: string | null
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
          requested_by?: string
          resolve_dispute?: boolean
          reversal_completed_at?: string | null
          reversal_due_cents?: number | null
          reversal_reference?: string | null
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
      transfer_intents: {
        Row: {
          amount_cents: number
          attempts: number
          available_at: string | null
          created_at: string
          currency: string
          dispatch_amount_cents: number | null
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
          id: string
          payload: Json | null
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          id: string
          payload?: Json | null
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          id?: string
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
        }
        Relationships: []
      }
    }
    Functions: {
      activity_post_search_text: { Args: { body: Json }; Returns: string }
      activity_post_visible: { Args: { p_post_id: string }; Returns: boolean }
      actor_name: { Args: { p_id: string }; Returns: string }
      admin_role: { Args: never; Returns: string }
      advance_search_rebuild: { Args: { p_run: string }; Returns: Json }
      assert_admin_actor: { Args: { p_actor: string }; Returns: undefined }
      assert_deletion_ready: { Args: { p_user: string }; Returns: undefined }
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
      bind_checkout_analytics: {
        Args: { p_orders: string[] }
        Returns: undefined
      }
      bump_listing_view: { Args: { p_listing: string }; Returns: undefined }
      capture_reconciliation_candidates: { Args: never; Returns: Json }
      claim_remediation_jobs: {
        Args: { p_kind: string; p_limit?: number }
        Returns: Json
      }
      claim_search_jobs: { Args: never; Returns: Json }
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
      complete_transfer_intent: {
        Args: {
          p_operation_key: string
          p_order: string
          p_transfer_reference: string
          p_worker: string
        }
        Returns: string
      }
      consume_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window: string }
        Returns: boolean
      }
      continue_account_deletion: {
        Args: { p_job: string; p_lease: string }
        Returns: undefined
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
          id: string
          identity_source: string | null
          is_public: boolean
          make: string | null
          model: string | null
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
          car_id: string
          created_at: string
          id: string
          intro: string | null
          published_at: string | null
          search_text: string | null
          title: string
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
      has_embedded_media_reference: {
        Args: { p_url: string }
        Returns: boolean
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
      listing_commercial_snapshot: {
        Args: {
          p_listing_id: string
          p_price_cents: number
          p_shipping_cents: number
        }
        Returns: Json
      }
      mark_due_transfer_intents: { Args: never; Returns: number }
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
          offer_floor_cents: number | null
          part_number: string | null
          part_number_compact: string | null
          price_cents: number
          removed_at: string | null
          removed_reason: string | null
          reserved_until: string | null
          seller_id: string
          shipping_cents: number
          shipping_mode: string
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
      marketplace_search_rows: {
        Args: { p_query: string }
        Returns: {
          allows_collection: boolean
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
          offer_floor_cents: number | null
          part_number: string | null
          part_number_compact: string | null
          price_cents: number
          removed_at: string | null
          removed_reason: string | null
          reserved_until: string | null
          seller_id: string
          shipping_cents: number
          shipping_mode: string
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
      pickup_redeem: {
        Args: { p_hash: string; p_order_id: string; p_seller_id: string }
        Returns: Json
      }
      prepare_payment_request: {
        Args: { p_key: string; p_request: Json }
        Returns: Json
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
      profile_is_visible: { Args: { p_id: string }; Returns: boolean }
      prune_rate_limits: { Args: never; Returns: undefined }
      purchase_begin: {
        Args: {
          p_buyer_id: string
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
      record_capture_recovery: {
        Args: { p_amount?: number; p_detail: string; p_key: string }
        Returns: string
      }
      record_payment_reference: {
        Args: { p_key: string; p_reference: string }
        Returns: undefined
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
      record_worker_run: {
        Args: {
          p_family: string
          p_id: string
          p_status: string
          p_summary?: Json
        }
        Returns: undefined
      }
      release_expired_reservations: { Args: never; Returns: Json }
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
      renew_remediation_lease: {
        Args: { p_id: string; p_lease: string }
        Returns: undefined
      }
      request_account_deletion: { Args: never; Returns: string }
      search_car_ids: { Args: { p_query: string }; Returns: string[] }
      search_listing_ids: { Args: { p_query: string }; Returns: string[] }
      search_profile_ids: { Args: { p_query: string }; Returns: string[] }
      search_update_ids: { Args: { p_query: string }; Returns: string[] }
      search_user_messages: { Args: { p_query: string }; Returns: string[] }
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
      seller_open_questions: { Args: { p_seller: string }; Returns: number }
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
      set_analytics_consent: {
        Args: { p_allowed: boolean }
        Returns: undefined
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      worker_health_snapshot: { Args: never; Returns: Json }
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

