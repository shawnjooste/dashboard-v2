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
          device_identity: string
          enrollment_date: string | null
          external_ip: string | null
          hostname: string
          id: string
          last_import_run_id: string | null
          last_reboot: string | null
          manufacturer: string | null
          memory: string | null
          model: string | null
          operating_system: string | null
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
          device_identity: string
          enrollment_date?: string | null
          external_ip?: string | null
          hostname: string
          id?: string
          last_import_run_id?: string | null
          last_reboot?: string | null
          manufacturer?: string | null
          memory?: string | null
          model?: string | null
          operating_system?: string | null
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
          device_identity?: string
          enrollment_date?: string | null
          external_ip?: string | null
          hostname?: string
          id?: string
          last_import_run_id?: string | null
          last_reboot?: string | null
          manufacturer?: string | null
          memory?: string | null
          model?: string | null
          operating_system?: string | null
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
      profiles: {
        Row: {
          client_id: string | null
          created_at: string
          email: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["profile_status"]
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          email: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          email?: string
          id?: string
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
    }
    Enums: {
      client_status: "active" | "inactive"
      profile_status: "pending" | "active"
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
  public: {
    Enums: {
      client_status: ["active", "inactive"],
      profile_status: ["pending", "active"],
      user_role: ["rocking_staff", "client_manager", "client_member"],
    },
  },
} as const
