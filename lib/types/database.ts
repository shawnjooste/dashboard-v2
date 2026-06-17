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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      client_domains: {
        Row: {
          client_id: string
          created_at: string
          domain: string
          id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          domain: string
          id?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          domain?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_domains_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          id: string
          name: string
          status: Database["public"]["Enums"]["client_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          status?: Database["public"]["Enums"]["client_status"]
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["client_status"]
        }
        Relationships: []
      }
      device_alerts: {
        Row: {
          alert_policy: string | null
          device_id: string
          id: string
          import_run_id: string | null
          message: string
          priority: string | null
          resolved: boolean
          resolved_at: string | null
          ticket_number: string | null
          triggered_at: string
        }
        Insert: {
          alert_policy?: string | null
          device_id: string
          id?: string
          import_run_id?: string | null
          message: string
          priority?: string | null
          resolved?: boolean
          resolved_at?: string | null
          ticket_number?: string | null
          triggered_at: string
        }
        Update: {
          alert_policy?: string | null
          device_id?: string
          id?: string
          import_run_id?: string | null
          message?: string
          priority?: string | null
          resolved?: boolean
          resolved_at?: string | null
          ticket_number?: string | null
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_alerts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_alerts_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      device_assignments: {
        Row: {
          created_at: string
          device_id: string
          id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          profile_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_assignments_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      device_health_snapshots: {
        Row: {
          av_ok: boolean | null
          client_id: string
          device_id: string
          id: string
          import_run_id: string | null
          max_disk_pct: number | null
          open_alert_count: number | null
          patch_pct: number | null
          snapshot_date: string
        }
        Insert: {
          av_ok?: boolean | null
          client_id: string
          device_id: string
          id?: string
          import_run_id?: string | null
          max_disk_pct?: number | null
          open_alert_count?: number | null
          patch_pct?: number | null
          snapshot_date: string
        }
        Update: {
          av_ok?: boolean | null
          client_id?: string
          device_id?: string
          id?: string
          import_run_id?: string | null
          max_disk_pct?: number | null
          open_alert_count?: number | null
          patch_pct?: number | null
          snapshot_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_health_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_health_snapshots_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_health_snapshots_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      device_patch_status: {
        Row: {
          device_id: string
          import_run_id: string | null
          last_reboot: string | null
          patch_status: string | null
          patches_approved_pending: number | null
          patches_installed: number | null
          patches_not_approved: number | null
          updated_at: string
        }
        Insert: {
          device_id: string
          import_run_id?: string | null
          last_reboot?: string | null
          patch_status?: string | null
          patches_approved_pending?: number | null
          patches_installed?: number | null
          patches_not_approved?: number | null
          updated_at?: string
        }
        Update: {
          device_id?: string
          import_run_id?: string | null
          last_reboot?: string | null
          patch_status?: string | null
          patches_approved_pending?: number | null
          patches_installed?: number | null
          patches_not_approved?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_patch_status_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_patch_status_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      device_storage: {
        Row: {
          device_id: string
          drive: string
          drive_type: string | null
          free_gb: number | null
          free_pct: number | null
          id: string
          import_run_id: string | null
          size_gb: number | null
          used_gb: number | null
          used_pct: number | null
        }
        Insert: {
          device_id: string
          drive: string
          drive_type?: string | null
          free_gb?: number | null
          free_pct?: number | null
          id?: string
          import_run_id?: string | null
          size_gb?: number | null
          used_gb?: number | null
          used_pct?: number | null
        }
        Update: {
          device_id?: string
          drive?: string
          drive_type?: string | null
          free_gb?: number | null
          free_pct?: number | null
          id?: string
          import_run_id?: string | null
          size_gb?: number | null
          used_gb?: number | null
          used_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "device_storage_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_storage_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          agent_version: string | null
          assigned_user_label: string | null
          av_ok: boolean | null
          av_status_raw: string | null
          client_id: string
          cpu: string | null
          created_at: string
          datto_uid: string
          enrollment_date: string | null
          external_ip: string | null
          hostname: string
          id: string
          last_import_run_id: string | null
          last_reboot: string | null
          last_user: string | null
          manufacturer: string | null
          memory: string | null
          model: string | null
          operating_system: string | null
          person_id: string | null
          physical_cores: number | null
          serial_number: string | null
          updated_at: string
        }
        Insert: {
          agent_version?: string | null
          assigned_user_label?: string | null
          av_ok?: boolean | null
          av_status_raw?: string | null
          client_id: string
          cpu?: string | null
          created_at?: string
          datto_uid: string
          enrollment_date?: string | null
          external_ip?: string | null
          hostname: string
          id?: string
          last_import_run_id?: string | null
          last_reboot?: string | null
          last_user?: string | null
          manufacturer?: string | null
          memory?: string | null
          model?: string | null
          operating_system?: string | null
          person_id?: string | null
          physical_cores?: number | null
          serial_number?: string | null
          updated_at?: string
        }
        Update: {
          agent_version?: string | null
          assigned_user_label?: string | null
          av_ok?: boolean | null
          av_status_raw?: string | null
          client_id?: string
          cpu?: string | null
          created_at?: string
          datto_uid?: string
          enrollment_date?: string | null
          external_ip?: string | null
          hostname?: string
          id?: string
          last_import_run_id?: string | null
          last_reboot?: string | null
          last_user?: string | null
          manufacturer?: string | null
          memory?: string | null
          model?: string | null
          operating_system?: string | null
          person_id?: string | null
          physical_cores?: number | null
          serial_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_last_import_run_id_fkey"
            columns: ["last_import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      impersonation_log: {
        Row: {
          ended_at: string | null
          id: string
          staff_profile_id: string
          started_at: string
          target_email: string
          target_profile_id: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          staff_profile_id: string
          started_at?: string
          target_email: string
          target_profile_id: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          staff_profile_id?: string
          started_at?: string
          target_email?: string
          target_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_log_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_log_target_profile_id_fkey"
            columns: ["target_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_runs: {
        Row: {
          counts: Json
          created_at: string
          file_names: string[]
          id: string
          report_date: string
          source: string
        }
        Insert: {
          counts?: Json
          created_at?: string
          file_names?: string[]
          id?: string
          report_date: string
          source: string
        }
        Update: {
          counts?: Json
          created_at?: string
          file_names?: string[]
          id?: string
          report_date?: string
          source?: string
        }
        Relationships: []
      }
      m365_connections: {
        Row: {
          client_id: string
          created_at: string
          id: string
          last_pull_at: string | null
          status: string
          tenant_id: string | null
          tenant_name: string | null
          token_ciphertext: string
          token_iv: string
          token_tag: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          last_pull_at?: string | null
          status?: string
          tenant_id?: string | null
          tenant_name?: string | null
          token_ciphertext: string
          token_iv: string
          token_tag: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          last_pull_at?: string | null
          status?: string
          tenant_id?: string | null
          tenant_name?: string | null
          token_ciphertext?: string
          token_iv?: string
          token_tag?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "m365_connections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_licenses: {
        Row: {
          client_id: string
          consumed: number | null
          id: string
          last_import_run_id: string | null
          sku_part_number: string
          total: number | null
        }
        Insert: {
          client_id: string
          consumed?: number | null
          id?: string
          last_import_run_id?: string | null
          sku_part_number: string
          total?: number | null
        }
        Update: {
          client_id?: string
          consumed?: number | null
          id?: string
          last_import_run_id?: string | null
          sku_part_number?: string
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "m365_licenses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_licenses_last_import_run_id_fkey"
            columns: ["last_import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_snapshots: {
        Row: {
          client_id: string
          id: string
          import_run_id: string | null
          licensed_users: number | null
          mfa_coverage_pct: number | null
          password_only_count: number | null
          security_defaults_on: boolean | null
          snapshot_date: string
        }
        Insert: {
          client_id: string
          id?: string
          import_run_id?: string | null
          licensed_users?: number | null
          mfa_coverage_pct?: number | null
          password_only_count?: number | null
          security_defaults_on?: boolean | null
          snapshot_date: string
        }
        Update: {
          client_id?: string
          id?: string
          import_run_id?: string | null
          licensed_users?: number | null
          mfa_coverage_pct?: number | null
          password_only_count?: number | null
          security_defaults_on?: boolean | null
          snapshot_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "m365_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_snapshots_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_tenant: {
        Row: {
          ca_policy_count: number | null
          client_id: string
          last_import_run_id: string | null
          licensed_user_count: number | null
          mfa_strong_count: number | null
          secure_score: number | null
          secure_score_max: number | null
          security_defaults_on: boolean | null
          updated_at: string
        }
        Insert: {
          ca_policy_count?: number | null
          client_id: string
          last_import_run_id?: string | null
          licensed_user_count?: number | null
          mfa_strong_count?: number | null
          secure_score?: number | null
          secure_score_max?: number | null
          security_defaults_on?: boolean | null
          updated_at?: string
        }
        Update: {
          ca_policy_count?: number | null
          client_id?: string
          last_import_run_id?: string | null
          licensed_user_count?: number | null
          mfa_strong_count?: number | null
          secure_score?: number | null
          secure_score_max?: number | null
          security_defaults_on?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "m365_tenant_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_tenant_last_import_run_id_fkey"
            columns: ["last_import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_users: {
        Row: {
          account_enabled: boolean | null
          assigned_licenses: string[]
          client_id: string
          created_at: string
          display_name: string | null
          id: string
          is_licensed: boolean
          last_import_run_id: string | null
          m365_user_id: string
          mfa_methods: string[]
          mfa_strong: boolean
          person_id: string | null
          updated_at: string
          user_principal_name: string | null
        }
        Insert: {
          account_enabled?: boolean | null
          assigned_licenses?: string[]
          client_id: string
          created_at?: string
          display_name?: string | null
          id?: string
          is_licensed?: boolean
          last_import_run_id?: string | null
          m365_user_id: string
          mfa_methods?: string[]
          mfa_strong?: boolean
          person_id?: string | null
          updated_at?: string
          user_principal_name?: string | null
        }
        Update: {
          account_enabled?: boolean | null
          assigned_licenses?: string[]
          client_id?: string
          created_at?: string
          display_name?: string | null
          id?: string
          is_licensed?: boolean
          last_import_run_id?: string | null
          m365_user_id?: string
          mfa_methods?: string[]
          mfa_strong?: boolean
          person_id?: string | null
          updated_at?: string
          user_principal_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "m365_users_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_users_last_import_run_id_fkey"
            columns: ["last_import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_users_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          client_id: string
          created_at: string
          display_name: string | null
          email: string
          first_name: string | null
          id: string
          is_active: boolean
          last_name: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          display_name?: string | null
          email: string
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          display_name?: string | null
          email?: string
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          client_id: string | null
          created_at: string
          decline_reason: string | null
          email: string
          first_signin_notified_at: string | null
          id: string
          pending_notified_at: string | null
          person_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["profile_status"]
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          decline_reason?: string | null
          email: string
          first_signin_notified_at?: string | null
          id: string
          pending_notified_at?: string | null
          person_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          decline_reason?: string | null
          email?: string
          first_signin_notified_at?: string | null
          id?: string
          pending_notified_at?: string | null
          person_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_counters: {
        Row: {
          last_n: number
          year: number
        }
        Insert: {
          last_n?: number
          year: number
        }
        Update: {
          last_n?: number
          year?: number
        }
        Relationships: []
      }
      quote_events: {
        Row: {
          actor_profile_id: string | null
          comment: string | null
          created_at: string
          event: string
          id: string
          quote_id: string
          version: number | null
        }
        Insert: {
          actor_profile_id?: string | null
          comment?: string | null
          created_at?: string
          event: string
          id?: string
          quote_id: string
          version?: number | null
        }
        Update: {
          actor_profile_id?: string | null
          comment?: string | null
          created_at?: string
          event?: string
          id?: string
          quote_id?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_events_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_internal: {
        Row: {
          id: string
          line_path: string
          note: string | null
          supplier_cost: number | null
          version_id: string
        }
        Insert: {
          id?: string
          line_path: string
          note?: string | null
          supplier_cost?: number | null
          version_id: string
        }
        Update: {
          id?: string
          line_path?: string
          note?: string | null
          supplier_cost?: number | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_internal_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_versions: {
        Row: {
          created_at: string
          doc: Json
          grand_total: number | null
          id: string
          monthly_total: number | null
          quote_id: string
          subtotal: number | null
          valid_until: string | null
          vat_amount: number | null
          version: number
        }
        Insert: {
          created_at?: string
          doc: Json
          grand_total?: number | null
          id?: string
          monthly_total?: number | null
          quote_id: string
          subtotal?: number | null
          valid_until?: string | null
          vat_amount?: number | null
          version: number
        }
        Update: {
          created_at?: string
          doc?: Json
          grand_total?: number | null
          id?: string
          monthly_total?: number | null
          quote_id?: string
          subtotal?: number | null
          valid_until?: string | null
          vat_amount?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_versions_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          current_version: number
          id: string
          invoiced_at: string | null
          quote_number: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          current_version?: number
          id?: string
          invoiced_at?: string | null
          quote_number: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          current_version?: number
          id?: string
          invoiced_at?: string | null
          quote_number?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      site_aliases: {
        Row: {
          client_id: string
          created_at: string
          id: string
          site_name: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          site_name: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          site_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_aliases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_pending_user: {
        Args: {
          p_client_id: string
          p_link_domain?: boolean
          p_make_manager?: boolean
          p_profile_id: string
        }
        Returns: undefined
      }
      claim_device: { Args: { p_device_id: string }; Returns: undefined }
      claimable_devices: {
        Args: never
        Returns: {
          assigned_user_label: string
          hostname: string
          id: string
        }[]
      }
      current_client_id: { Args: never; Returns: string }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      device_in_current_client: {
        Args: { p_device_id: string }
        Returns: boolean
      }
      is_rocking_staff: { Args: never; Returns: boolean }
      my_assigned_device_ids: { Args: never; Returns: string[] }
      my_first_name: { Args: never; Returns: string }
      next_quote_number: { Args: never; Returns: string }
      reject_pending_user: {
        Args: { p_profile_id: string; p_reason?: string }
        Returns: undefined
      }
      set_my_name: {
        Args: { p_first: string; p_last: string }
        Returns: undefined
      }
      set_portal_role: {
        Args: {
          p_profile_id: string
          p_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: undefined
      }
      upsert_person: {
        Args: {
          p_client_id: string
          p_display_name: string
          p_email: string
          p_is_active?: boolean
        }
        Returns: string
      }
    }
    Enums: {
      client_status: "active" | "inactive"
      profile_status: "pending" | "active" | "rejected"
      user_role: "rocking_staff" | "client_manager" | "client_member"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      client_status: ["active", "inactive"],
      profile_status: ["pending", "active", "rejected"],
      user_role: ["rocking_staff", "client_manager", "client_member"],
    },
  },
} as const
