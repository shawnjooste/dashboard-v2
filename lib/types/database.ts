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
      client_billing: {
        Row: {
          as_of: string | null
          client_id: string
          currency: string | null
          outstanding: number
          overdue: number
          updated_at: string
        }
        Insert: {
          as_of?: string | null
          client_id: string
          currency?: string | null
          outstanding?: number
          overdue?: number
          updated_at?: string
        }
        Update: {
          as_of?: string | null
          client_id?: string
          currency?: string | null
          outstanding?: number
          overdue?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_billing_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
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
      client_products: {
        Row: {
          client_id: string
          created_at: string
          id: string
          note: string | null
          product_id: string
          quantity: number
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          note?: string | null
          product_id: string
          quantity?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          note?: string | null
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_products_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
          support_package_id: string | null
          support_plan_label: string | null
          xero_contact_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          status?: Database["public"]["Enums"]["client_status"]
          support_package_id?: string | null
          support_plan_label?: string | null
          xero_contact_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["client_status"]
          support_package_id?: string | null
          support_plan_label?: string | null
          xero_contact_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_support_package_id_fkey"
            columns: ["support_package_id"]
            isOneToOne: false
            referencedRelation: "support_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      device_alerts: {
        Row: {
          alert_policy: string | null
          alert_type: string | null
          context: Json | null
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
          alert_type?: string | null
          context?: Json | null
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
          alert_type?: string | null
          context?: Json | null
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
      device_changes: {
        Row: {
          category: string
          created_at: string
          created_by_profile_id: string | null
          device_id: string
          id: string
          note: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by_profile_id?: string | null
          device_id: string
          id?: string
          note: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by_profile_id?: string | null
          device_id?: string
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_changes_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_changes_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
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
      device_nics: {
        Row: {
          device_id: string
          id: string
          import_run_id: string | null
          ipv4: string | null
          ipv6: string | null
          label: string | null
          mac: string | null
          nic_type: string | null
        }
        Insert: {
          device_id: string
          id?: string
          import_run_id?: string | null
          ipv4?: string | null
          ipv6?: string | null
          label?: string | null
          mac?: string | null
          nic_type?: string | null
        }
        Update: {
          device_id?: string
          id?: string
          import_run_id?: string | null
          ipv4?: string | null
          ipv6?: string | null
          label?: string | null
          mac?: string | null
          nic_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_nics_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_nics_import_run_id_fkey"
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
      device_photos: {
        Row: {
          caption: string | null
          created_at: string
          device_id: string
          file_size: number | null
          id: string
          mime_type: string | null
          storage_path: string
          uploaded_by_profile_id: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          device_id: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path: string
          uploaded_by_profile_id?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          device_id?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          uploaded_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_photos_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_photos_uploaded_by_profile_id_fkey"
            columns: ["uploaded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      device_software: {
        Row: {
          device_id: string
          id: string
          import_run_id: string | null
          name: string
          version: string | null
        }
        Insert: {
          device_id: string
          id?: string
          import_run_id?: string | null
          name: string
          version?: string | null
        }
        Update: {
          device_id?: string
          id?: string
          import_run_id?: string | null
          name?: string
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_software_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_software_import_run_id_fkey"
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
      device_udfs: {
        Row: {
          device_id: string
          id: string
          import_run_id: string | null
          slot: string
          value: string | null
        }
        Insert: {
          device_id: string
          id?: string
          import_run_id?: string | null
          slot: string
          value?: string | null
        }
        Update: {
          device_id?: string
          id?: string
          import_run_id?: string | null
          slot?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_udfs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_udfs_import_run_id_fkey"
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
          bios_version: string | null
          client_id: string
          cpu: string | null
          created_at: string
          datto_uid: string
          disposition: string
          disposition_note: string | null
          disposition_updated_at: string | null
          disposition_updated_by: string | null
          domain: string | null
          enrollment_date: string | null
          external_ip: string | null
          hostname: string
          id: string
          last_import_run_id: string | null
          last_reboot: string | null
          last_seen: string | null
          last_user: string | null
          manufacturer: string | null
          memory: string | null
          model: string | null
          online: boolean | null
          operating_system: string | null
          person_id: string | null
          physical_cores: number | null
          reboot_required: boolean | null
          serial_number: string | null
          software_status: string | null
          updated_at: string
          warranty_date: string | null
        }
        Insert: {
          agent_version?: string | null
          assigned_user_label?: string | null
          av_ok?: boolean | null
          av_status_raw?: string | null
          bios_version?: string | null
          client_id: string
          cpu?: string | null
          created_at?: string
          datto_uid: string
          disposition?: string
          disposition_note?: string | null
          disposition_updated_at?: string | null
          disposition_updated_by?: string | null
          domain?: string | null
          enrollment_date?: string | null
          external_ip?: string | null
          hostname: string
          id?: string
          last_import_run_id?: string | null
          last_reboot?: string | null
          last_seen?: string | null
          last_user?: string | null
          manufacturer?: string | null
          memory?: string | null
          model?: string | null
          online?: boolean | null
          operating_system?: string | null
          person_id?: string | null
          physical_cores?: number | null
          reboot_required?: boolean | null
          serial_number?: string | null
          software_status?: string | null
          updated_at?: string
          warranty_date?: string | null
        }
        Update: {
          agent_version?: string | null
          assigned_user_label?: string | null
          av_ok?: boolean | null
          av_status_raw?: string | null
          bios_version?: string | null
          client_id?: string
          cpu?: string | null
          created_at?: string
          datto_uid?: string
          disposition?: string
          disposition_note?: string | null
          disposition_updated_at?: string | null
          disposition_updated_by?: string | null
          domain?: string | null
          enrollment_date?: string | null
          external_ip?: string | null
          hostname?: string
          id?: string
          last_import_run_id?: string | null
          last_reboot?: string | null
          last_seen?: string | null
          last_user?: string | null
          manufacturer?: string | null
          memory?: string | null
          model?: string | null
          online?: boolean | null
          operating_system?: string | null
          person_id?: string | null
          physical_cores?: number | null
          reboot_required?: boolean | null
          serial_number?: string | null
          software_status?: string | null
          updated_at?: string
          warranty_date?: string | null
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
            foreignKeyName: "devices_disposition_updated_by_fkey"
            columns: ["disposition_updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      job_tasks: {
        Row: {
          assignee_profile_id: string | null
          created_at: string
          done: boolean
          id: string
          job_id: string
          label: string
          position: number
        }
        Insert: {
          assignee_profile_id?: string | null
          created_at?: string
          done?: boolean
          id?: string
          job_id: string
          label: string
          position?: number
        }
        Update: {
          assignee_profile_id?: string | null
          created_at?: string
          done?: boolean
          id?: string
          job_id?: string
          label?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_tasks_assignee_profile_id_fkey"
            columns: ["assignee_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_updates: {
        Row: {
          body: string | null
          created_at: string
          emailed_count: number
          id: string
          job_id: string
          kind: string
          posted_by_profile_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          emailed_count?: number
          id?: string
          job_id: string
          kind: string
          posted_by_profile_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          emailed_count?: number
          id?: string
          job_id?: string
          kind?: string
          posted_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_updates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_updates_posted_by_profile_id_fkey"
            columns: ["posted_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          id: string
          notes: string | null
          owner_profile_id: string | null
          quote_id: string | null
          status: string
          title: string
          updated_at: string
          waiting_note: string | null
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          owner_profile_id?: string | null
          quote_id?: string | null
          status?: string
          title: string
          updated_at?: string
          waiting_note?: string | null
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          owner_profile_id?: string | null
          quote_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          waiting_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
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
      network_devices: {
        Row: {
          client_count: number | null
          client_id: string
          created_at: string
          firmware: string | null
          id: string
          ip: string | null
          kind: string | null
          last_import_run_id: string | null
          last_seen_at: string | null
          model: string | null
          name: string | null
          site_id: string | null
          source: string
          source_device_id: string
          status: string | null
          updated_at: string
          uptime_s: number | null
        }
        Insert: {
          client_count?: number | null
          client_id: string
          created_at?: string
          firmware?: string | null
          id?: string
          ip?: string | null
          kind?: string | null
          last_import_run_id?: string | null
          last_seen_at?: string | null
          model?: string | null
          name?: string | null
          site_id?: string | null
          source: string
          source_device_id: string
          status?: string | null
          updated_at?: string
          uptime_s?: number | null
        }
        Update: {
          client_count?: number | null
          client_id?: string
          created_at?: string
          firmware?: string | null
          id?: string
          ip?: string | null
          kind?: string | null
          last_import_run_id?: string | null
          last_seen_at?: string | null
          model?: string | null
          name?: string | null
          site_id?: string | null
          source?: string
          source_device_id?: string
          status?: string | null
          updated_at?: string
          uptime_s?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "network_devices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "network_devices_last_import_run_id_fkey"
            columns: ["last_import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "network_devices_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "network_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      network_health_snapshots: {
        Row: {
          client_count: number | null
          client_id: string
          created_at: string
          devices_down: number | null
          devices_total: number | null
          devices_up: number | null
          id: string
          site_id: string
          snapshot_date: string
          status: string | null
        }
        Insert: {
          client_count?: number | null
          client_id: string
          created_at?: string
          devices_down?: number | null
          devices_total?: number | null
          devices_up?: number | null
          id?: string
          site_id: string
          snapshot_date: string
          status?: string | null
        }
        Update: {
          client_count?: number | null
          client_id?: string
          created_at?: string
          devices_down?: number | null
          devices_total?: number | null
          devices_up?: number | null
          id?: string
          site_id?: string
          snapshot_date?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "network_health_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "network_health_snapshots_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "network_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      network_sites: {
        Row: {
          client_count: number | null
          client_id: string
          created_at: string
          device_count: number | null
          id: string
          last_import_run_id: string | null
          last_seen_at: string | null
          name: string
          source: string
          source_site_id: string
          status: string | null
          updated_at: string
        }
        Insert: {
          client_count?: number | null
          client_id: string
          created_at?: string
          device_count?: number | null
          id?: string
          last_import_run_id?: string | null
          last_seen_at?: string | null
          name: string
          source: string
          source_site_id: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          client_count?: number | null
          client_id?: string
          created_at?: string
          device_count?: number | null
          id?: string
          last_import_run_id?: string | null
          last_seen_at?: string | null
          name?: string
          source?: string
          source_site_id?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "network_sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "network_sites_last_import_run_id_fkey"
            columns: ["last_import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      network_source_aliases: {
        Row: {
          client_id: string
          created_at: string
          id: string
          label: string | null
          source: string
          source_key: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          label?: string | null
          source: string
          source_key: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          label?: string | null
          source?: string
          source_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "network_source_aliases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      portal_activity: {
        Row: {
          client_id: string | null
          detail: string | null
          hour_bucket: string
          id: string
          kind: string
          occurred_at: string
          profile_id: string | null
          section: string
        }
        Insert: {
          client_id?: string | null
          detail?: string | null
          hour_bucket?: string
          id?: string
          kind: string
          occurred_at?: string
          profile_id?: string | null
          section: string
        }
        Update: {
          client_id?: string | null
          detail?: string | null
          hour_bucket?: string
          id?: string
          kind?: string
          occurred_at?: string
          profile_id?: string | null
          section?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_activity_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_activity_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          client_id: string | null
          created_at: string
          decline_reason: string | null
          email: string
          feature_overrides: Json | null
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
          feature_overrides?: Json | null
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
          feature_overrides?: Json | null
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
      rfq_events: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          posted_by_profile_id: string | null
          rfq_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          posted_by_profile_id?: string | null
          rfq_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          posted_by_profile_id?: string | null
          rfq_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_events_posted_by_profile_id_fkey"
            columns: ["posted_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_events_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      rfqs: {
        Row: {
          client_id: string | null
          client_name: string | null
          closed_at: string | null
          created_at: string
          description: string | null
          id: string
          lost_reason: string | null
          needed_by: string | null
          notes: string | null
          owner_profile_id: string | null
          quote_id: string | null
          requested_by: string | null
          sourcing_note: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          client_name?: string | null
          closed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          lost_reason?: string | null
          needed_by?: string | null
          notes?: string | null
          owner_profile_id?: string | null
          quote_id?: string | null
          requested_by?: string | null
          sourcing_note?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          client_name?: string | null
          closed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          lost_reason?: string | null
          needed_by?: string | null
          notes?: string | null
          owner_profile_id?: string | null
          quote_id?: string | null
          requested_by?: string | null
          sourcing_note?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfqs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
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
      supplier_documents: {
        Row: {
          amount: number | null
          created_at: string
          currency: string
          doc_date: string | null
          doc_type: string
          file_name: string | null
          file_size: number | null
          id: string
          mime_type: string | null
          notes: string | null
          reference: string | null
          storage_path: string | null
          supplier_id: string
          title: string
          uploaded_by_profile_id: string | null
          valid_until: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string
          doc_date?: string | null
          doc_type?: string
          file_name?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          reference?: string | null
          storage_path?: string | null
          supplier_id: string
          title: string
          uploaded_by_profile_id?: string | null
          valid_until?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string
          doc_date?: string | null
          doc_type?: string
          file_name?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          reference?: string | null
          storage_path?: string | null
          supplier_id?: string
          title?: string
          uploaded_by_profile_id?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_documents_uploaded_by_profile_id_fkey"
            columns: ["uploaded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          category: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          category?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          category?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      support_packages: {
        Row: {
          has_chat: boolean
          id: string
          included_minutes: number
          is_default: boolean
          key: string
          name: string
          rank: number
          remote_included: boolean
          sla_hours: number | null
        }
        Insert: {
          has_chat?: boolean
          id?: string
          included_minutes?: number
          is_default?: boolean
          key: string
          name: string
          rank?: number
          remote_included?: boolean
          sla_hours?: number | null
        }
        Update: {
          has_chat?: boolean
          id?: string
          included_minutes?: number
          is_default?: boolean
          key?: string
          name?: string
          rank?: number
          remote_included?: boolean
          sla_hours?: number | null
        }
        Relationships: []
      }
      support_time_entries: {
        Row: {
          client_id: string
          created_at: string
          entered_by: string | null
          freescout_number: number | null
          id: string
          minutes: number
          note: string | null
          occurred_on: string
          work_type: string
        }
        Insert: {
          client_id: string
          created_at?: string
          entered_by?: string | null
          freescout_number?: number | null
          id?: string
          minutes: number
          note?: string | null
          occurred_on?: string
          work_type?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          entered_by?: string | null
          freescout_number?: number | null
          id?: string
          minutes?: number
          note?: string | null
          occurred_on?: string
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_time_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_time_entries_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      xero_connection: {
        Row: {
          created_at: string
          id: number
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
          created_at?: string
          id?: number
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
          created_at?: string
          id?: number
          last_pull_at?: string | null
          status?: string
          tenant_id?: string | null
          tenant_name?: string | null
          token_ciphertext?: string
          token_iv?: string
          token_tag?: string
          updated_at?: string
        }
        Relationships: []
      }
      xero_invoices: {
        Row: {
          amount_due: number | null
          amount_paid: number | null
          client_id: string
          currency: string | null
          date: string | null
          due_date: string | null
          id: string
          import_run_id: string | null
          number: string | null
          status: string
          total: number | null
          type: string
          updated_at: string
          xero_invoice_id: string
        }
        Insert: {
          amount_due?: number | null
          amount_paid?: number | null
          client_id: string
          currency?: string | null
          date?: string | null
          due_date?: string | null
          id?: string
          import_run_id?: string | null
          number?: string | null
          status: string
          total?: number | null
          type: string
          updated_at?: string
          xero_invoice_id: string
        }
        Update: {
          amount_due?: number | null
          amount_paid?: number | null
          client_id?: string
          currency?: string | null
          date?: string | null
          due_date?: string | null
          id?: string
          import_run_id?: string | null
          number?: string | null
          status?: string
          total?: number | null
          type?: string
          updated_at?: string
          xero_invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "xero_invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xero_invoices_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
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
      has_feature: { Args: { p_feature: string }; Returns: boolean }
      ingest_network_report: { Args: { payload: Json }; Returns: Json }
      is_rocking_staff: { Args: never; Returns: boolean }
      my_assigned_device_ids: { Args: never; Returns: string[] }
      my_first_name: { Args: never; Returns: string }
      network_ingest_targets: {
        Args: never
        Returns: {
          label: string
          source: string
          source_key: string
        }[]
      }
      next_quote_number: { Args: never; Returns: string }
      reject_pending_user: {
        Args: { p_profile_id: string; p_reason?: string }
        Returns: undefined
      }
      set_device_disposition: {
        Args: { p_device_id: string; p_disposition: string; p_note?: string }
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
