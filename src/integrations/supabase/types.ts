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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      appointment_clinical_notes: {
        Row: {
          appointment_id: string
          client_affect: string | null
          client_appearance: string | null
          client_attitude: string | null
          client_behavior: string | null
          client_diagnosis: string[] | null
          client_functioning: string | null
          client_homicidalideation:
            | Database["public"]["Enums"]["client_ideation_enum"]
            | null
          client_id: string
          client_insightjudgement: string | null
          client_intervention1: string | null
          client_intervention2: string | null
          client_intervention3: string | null
          client_intervention4: string | null
          client_intervention5: string | null
          client_intervention6: string | null
          client_medications: string | null
          client_memoryconcentration: string | null
          client_mood: string | null
          client_nexttreatmentplanupdate: string | null
          client_orientation: string | null
          client_perception: string | null
          client_personsinattendance: string | null
          client_planlength: string | null
          client_primaryobjective: string | null
          client_privatenote: string | null
          client_problem: string | null
          client_prognosis: string | null
          client_progress: string | null
          client_secondaryobjective: string | null
          client_sessionnarrative: string | null
          client_speech: string | null
          client_substanceabuserisk:
            | Database["public"]["Enums"]["client_substance_abuse_risk_enum"]
            | null
          client_suicidalideation:
            | Database["public"]["Enums"]["client_ideation_enum"]
            | null
          client_tertiaryobjective: string | null
          client_thoughtprocess: string | null
          client_treatmentfrequency: string | null
          client_treatmentgoal: string | null
          client_treatmentplan_startdate: string | null
          created_at: string
          id: string
          note_status: Database["public"]["Enums"]["appointment_note_status_enum"]
          note_type:
            | Database["public"]["Enums"]["appointment_note_type_enum"]
            | null
          signed_at: string | null
          staff_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          client_affect?: string | null
          client_appearance?: string | null
          client_attitude?: string | null
          client_behavior?: string | null
          client_diagnosis?: string[] | null
          client_functioning?: string | null
          client_homicidalideation?:
            | Database["public"]["Enums"]["client_ideation_enum"]
            | null
          client_id: string
          client_insightjudgement?: string | null
          client_intervention1?: string | null
          client_intervention2?: string | null
          client_intervention3?: string | null
          client_intervention4?: string | null
          client_intervention5?: string | null
          client_intervention6?: string | null
          client_medications?: string | null
          client_memoryconcentration?: string | null
          client_mood?: string | null
          client_nexttreatmentplanupdate?: string | null
          client_orientation?: string | null
          client_perception?: string | null
          client_personsinattendance?: string | null
          client_planlength?: string | null
          client_primaryobjective?: string | null
          client_privatenote?: string | null
          client_problem?: string | null
          client_prognosis?: string | null
          client_progress?: string | null
          client_secondaryobjective?: string | null
          client_sessionnarrative?: string | null
          client_speech?: string | null
          client_substanceabuserisk?:
            | Database["public"]["Enums"]["client_substance_abuse_risk_enum"]
            | null
          client_suicidalideation?:
            | Database["public"]["Enums"]["client_ideation_enum"]
            | null
          client_tertiaryobjective?: string | null
          client_thoughtprocess?: string | null
          client_treatmentfrequency?: string | null
          client_treatmentgoal?: string | null
          client_treatmentplan_startdate?: string | null
          created_at?: string
          id?: string
          note_status?: Database["public"]["Enums"]["appointment_note_status_enum"]
          note_type?:
            | Database["public"]["Enums"]["appointment_note_type_enum"]
            | null
          signed_at?: string | null
          staff_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          client_affect?: string | null
          client_appearance?: string | null
          client_attitude?: string | null
          client_behavior?: string | null
          client_diagnosis?: string[] | null
          client_functioning?: string | null
          client_homicidalideation?:
            | Database["public"]["Enums"]["client_ideation_enum"]
            | null
          client_id?: string
          client_insightjudgement?: string | null
          client_intervention1?: string | null
          client_intervention2?: string | null
          client_intervention3?: string | null
          client_intervention4?: string | null
          client_intervention5?: string | null
          client_intervention6?: string | null
          client_medications?: string | null
          client_memoryconcentration?: string | null
          client_mood?: string | null
          client_nexttreatmentplanupdate?: string | null
          client_orientation?: string | null
          client_perception?: string | null
          client_personsinattendance?: string | null
          client_planlength?: string | null
          client_primaryobjective?: string | null
          client_privatenote?: string | null
          client_problem?: string | null
          client_prognosis?: string | null
          client_progress?: string | null
          client_secondaryobjective?: string | null
          client_sessionnarrative?: string | null
          client_speech?: string | null
          client_substanceabuserisk?:
            | Database["public"]["Enums"]["client_substance_abuse_risk_enum"]
            | null
          client_suicidalideation?:
            | Database["public"]["Enums"]["client_ideation_enum"]
            | null
          client_tertiaryobjective?: string | null
          client_thoughtprocess?: string | null
          client_treatmentfrequency?: string | null
          client_treatmentgoal?: string | null
          client_treatmentplan_startdate?: string | null
          created_at?: string
          id?: string
          note_status?: Database["public"]["Enums"]["appointment_note_status_enum"]
          note_type?:
            | Database["public"]["Enums"]["appointment_note_type_enum"]
            | null
          signed_at?: string | null
          staff_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_clinical_notes_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_clinical_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_clinical_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "appointment_clinical_notes_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_clinical_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_exceptions: {
        Row: {
          change_type: Database["public"]["Enums"]["appointment_exception_type_enum"]
          created_at: string
          id: string
          notes: string | null
          original_start_at: string
          replacement_appointment_id: string | null
          series_id: string
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          change_type: Database["public"]["Enums"]["appointment_exception_type_enum"]
          created_at?: string
          id?: string
          notes?: string | null
          original_start_at: string
          replacement_appointment_id?: string | null
          series_id: string
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          change_type?: Database["public"]["Enums"]["appointment_exception_type_enum"]
          created_at?: string
          id?: string
          notes?: string | null
          original_start_at?: string
          replacement_appointment_id?: string | null
          series_id?: string
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "appointment_exceptions_replacement_appointment_id_fkey"
            columns: ["replacement_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_exceptions_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "appointment_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_exceptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_private_notes: {
        Row: {
          appointment_id: string
          created_at: string
          created_by_profile_id: string
          id: string
          note_content: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          created_by_profile_id: string
          id?: string
          note_content?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          created_by_profile_id?: string
          id?: string
          note_content?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_private_notes_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_series: {
        Row: {
          client_id: string
          created_at: string
          created_by_profile_id: string
          duration_minutes: number
          id: string
          is_active: boolean
          max_occurrences: number | null
          notes: string | null
          rrule: string
          series_end_date: string | null
          service_id: string
          staff_id: string
          start_at: string
          tenant_id: string
          time_zone: Database["public"]["Enums"]["time_zones"]
          updated_at: string
          version: number
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by_profile_id: string
          duration_minutes: number
          id?: string
          is_active?: boolean
          max_occurrences?: number | null
          notes?: string | null
          rrule: string
          series_end_date?: string | null
          service_id: string
          staff_id: string
          start_at: string
          tenant_id: string
          time_zone: Database["public"]["Enums"]["time_zones"]
          updated_at?: string
          version?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by_profile_id?: string
          duration_minutes?: number
          id?: string
          is_active?: boolean
          max_occurrences?: number | null
          notes?: string | null
          rrule?: string
          series_end_date?: string | null
          service_id?: string
          staff_id?: string
          start_at?: string
          tenant_id?: string
          time_zone?: Database["public"]["Enums"]["time_zones"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "appointment_series_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_series_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "appointment_series_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "appointment_series_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_series_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_series_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_series_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_session_context: {
        Row: {
          appointment_id: string
          client_location_desc: string | null
          client_location_state:
            | Database["public"]["Enums"]["state_code_enum"]
            | null
          context_captured_at: string
          created_at: string
          emergency_contact_id: string | null
          emergency_plan_confirmed: boolean
          emergency_plan_notes: string | null
          id: string
          risk_level: Database["public"]["Enums"]["risk_level_enum"]
          risk_notes: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          client_location_desc?: string | null
          client_location_state?:
            | Database["public"]["Enums"]["state_code_enum"]
            | null
          context_captured_at?: string
          created_at?: string
          emergency_contact_id?: string | null
          emergency_plan_confirmed?: boolean
          emergency_plan_notes?: string | null
          id?: string
          risk_level?: Database["public"]["Enums"]["risk_level_enum"]
          risk_notes?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          client_location_desc?: string | null
          client_location_state?:
            | Database["public"]["Enums"]["state_code_enum"]
            | null
          context_captured_at?: string
          created_at?: string
          emergency_contact_id?: string | null
          emergency_plan_confirmed?: boolean
          emergency_plan_notes?: string | null
          id?: string
          risk_level?: Database["public"]["Enums"]["risk_level_enum"]
          risk_notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_session_context_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_session_context_emergency_contact_id_fkey"
            columns: ["emergency_contact_id"]
            isOneToOne: false
            referencedRelation: "client_emergency_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_session_context_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          accept_assign: Database["public"]["Enums"]["accept_assign_enum"]
          auto_accident: boolean | null
          auto_accident_state: string | null
          charge_1: number | null
          client_id: string
          created_at: string
          created_by_profile_id: string
          documented_at: string | null
          employment_related: boolean | null
          end_at: string
          from_date_1: string | null
          id: string
          is_telehealth: boolean
          location_id: string | null
          location_name: string | null
          mod1_1: string | null
          mod2_1: string | null
          mod3_1: string | null
          mod4_1: string | null
          narrative_1: string | null
          place_of_service_1: number | null
          prior_auth: string | null
          proc_code_1: string | null
          remote_chgid_1: string | null
          series_id: string | null
          service_id: string
          staff_id: string
          start_at: string
          status: Database["public"]["Enums"]["appointment_status_enum"]
          tenant_id: string
          thru_date_1: string | null
          time_zone: Database["public"]["Enums"]["time_zones"]
          units_1: number | null
          updated_at: string
          version: number
          videoroom_url: string | null
        }
        Insert: {
          accept_assign?: Database["public"]["Enums"]["accept_assign_enum"]
          auto_accident?: boolean | null
          auto_accident_state?: string | null
          charge_1?: number | null
          client_id: string
          created_at?: string
          created_by_profile_id: string
          documented_at?: string | null
          employment_related?: boolean | null
          end_at: string
          from_date_1?: string | null
          id?: string
          is_telehealth?: boolean
          location_id?: string | null
          location_name?: string | null
          mod1_1?: string | null
          mod2_1?: string | null
          mod3_1?: string | null
          mod4_1?: string | null
          narrative_1?: string | null
          place_of_service_1?: number | null
          prior_auth?: string | null
          proc_code_1?: string | null
          remote_chgid_1?: string | null
          series_id?: string | null
          service_id: string
          staff_id: string
          start_at: string
          status?: Database["public"]["Enums"]["appointment_status_enum"]
          tenant_id?: string
          thru_date_1?: string | null
          time_zone: Database["public"]["Enums"]["time_zones"]
          units_1?: number | null
          updated_at: string
          version?: number
          videoroom_url?: string | null
        }
        Update: {
          accept_assign?: Database["public"]["Enums"]["accept_assign_enum"]
          auto_accident?: boolean | null
          auto_accident_state?: string | null
          charge_1?: number | null
          client_id?: string
          created_at?: string
          created_by_profile_id?: string
          documented_at?: string | null
          employment_related?: boolean | null
          end_at?: string
          from_date_1?: string | null
          id?: string
          is_telehealth?: boolean
          location_id?: string | null
          location_name?: string | null
          mod1_1?: string | null
          mod2_1?: string | null
          mod3_1?: string | null
          mod4_1?: string | null
          narrative_1?: string | null
          place_of_service_1?: number | null
          prior_auth?: string | null
          proc_code_1?: string | null
          remote_chgid_1?: string | null
          series_id?: string | null
          service_id?: string
          staff_id?: string
          start_at?: string
          status?: Database["public"]["Enums"]["appointment_status_enum"]
          tenant_id?: string
          thru_date_1?: string | null
          time_zone?: Database["public"]["Enums"]["time_zones"]
          units_1?: number | null
          updated_at?: string
          version?: number
          videoroom_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "appointments_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "appointments_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "appointment_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      backend_contract_consumers: {
        Row: {
          adopted_application_version: string | null
          adopted_commit_sha: string | null
          blocker_detail: string | null
          consumer_name: string
          contract_release_id: string
          created_at: string
          id: string
          repository_name: string | null
          required: boolean
          retired_legacy_contracts: string[]
          status: Database["public"]["Enums"]["contract_consumer_status_enum"]
          updated_at: string
          validated_at: string | null
          validated_by_profile_id: string | null
          validation_evidence: Json
        }
        Insert: {
          adopted_application_version?: string | null
          adopted_commit_sha?: string | null
          blocker_detail?: string | null
          consumer_name: string
          contract_release_id: string
          created_at?: string
          id?: string
          repository_name?: string | null
          required?: boolean
          retired_legacy_contracts?: string[]
          status?: Database["public"]["Enums"]["contract_consumer_status_enum"]
          updated_at?: string
          validated_at?: string | null
          validated_by_profile_id?: string | null
          validation_evidence?: Json
        }
        Update: {
          adopted_application_version?: string | null
          adopted_commit_sha?: string | null
          blocker_detail?: string | null
          consumer_name?: string
          contract_release_id?: string
          created_at?: string
          id?: string
          repository_name?: string | null
          required?: boolean
          retired_legacy_contracts?: string[]
          status?: Database["public"]["Enums"]["contract_consumer_status_enum"]
          updated_at?: string
          validated_at?: string | null
          validated_by_profile_id?: string | null
          validation_evidence?: Json
        }
        Relationships: [
          {
            foreignKeyName: "backend_contract_consumers_contract_release_id_fkey"
            columns: ["contract_release_id"]
            isOneToOne: false
            referencedRelation: "backend_contract_releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backend_contract_consumers_validated_by_profile_id_fkey"
            columns: ["validated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "backend_contract_consumers_validated_by_profile_id_fkey"
            columns: ["validated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      backend_contract_releases: {
        Row: {
          contract_key: string
          contract_version: string
          created_at: string
          deprecated_at: string | null
          domain: string
          enums: Json
          events: Json
          generated_types_hash: string | null
          id: string
          migration_version: string | null
          permissions: Json
          published_at: string | null
          published_by_profile_id: string | null
          reason_codes: Json
          release_notes: string | null
          retired_at: string | null
          rpcs: Json
          schema_objects: Json
          status: Database["public"]["Enums"]["contract_release_status_enum"]
          updated_at: string
          views: Json
        }
        Insert: {
          contract_key: string
          contract_version: string
          created_at?: string
          deprecated_at?: string | null
          domain: string
          enums?: Json
          events?: Json
          generated_types_hash?: string | null
          id?: string
          migration_version?: string | null
          permissions?: Json
          published_at?: string | null
          published_by_profile_id?: string | null
          reason_codes?: Json
          release_notes?: string | null
          retired_at?: string | null
          rpcs?: Json
          schema_objects?: Json
          status?: Database["public"]["Enums"]["contract_release_status_enum"]
          updated_at?: string
          views?: Json
        }
        Update: {
          contract_key?: string
          contract_version?: string
          created_at?: string
          deprecated_at?: string | null
          domain?: string
          enums?: Json
          events?: Json
          generated_types_hash?: string | null
          id?: string
          migration_version?: string | null
          permissions?: Json
          published_at?: string | null
          published_by_profile_id?: string | null
          reason_codes?: Json
          release_notes?: string | null
          retired_at?: string | null
          rpcs?: Json
          schema_objects?: Json
          status?: Database["public"]["Enums"]["contract_release_status_enum"]
          updated_at?: string
          views?: Json
        }
        Relationships: [
          {
            foreignKeyName: "backend_contract_releases_published_by_profile_id_fkey"
            columns: ["published_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "backend_contract_releases_published_by_profile_id_fkey"
            columns: ["published_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_appointment_exclusions: {
        Row: {
          appointment_id: string
          excluded_at: string
          excluded_by_profile_id: string | null
          id: string
          reason: string | null
          revoked_at: string | null
          revoked_by_profile_id: string | null
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          excluded_at?: string
          excluded_by_profile_id?: string | null
          id?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          excluded_at?: string
          excluded_by_profile_id?: string | null
          id?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      billing_audit_events: {
        Row: {
          actor_profile_id: string | null
          actor_staff_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json
          subject_id: string | null
          subject_type: string
          tenant_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          actor_staff_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          subject_id?: string | null
          subject_type: string
          tenant_id: string
        }
        Update: {
          actor_profile_id?: string | null
          actor_staff_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          subject_id?: string | null
          subject_type?: string
          tenant_id?: string
        }
        Relationships: []
      }
      billing_reconciliation_findings: {
        Row: {
          claim_id: string | null
          claim_line_id: string | null
          created_at: string
          details: Json | null
          era_id: string | null
          era_service_line_id: string | null
          finding_type: string
          id: string
          official_era_value: Json | null
          payment_source_row_id: string | null
          report_value: Json | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          claim_id?: string | null
          claim_line_id?: string | null
          created_at?: string
          details?: Json | null
          era_id?: string | null
          era_service_line_id?: string | null
          finding_type: string
          id?: string
          official_era_value?: Json | null
          payment_source_row_id?: string | null
          report_value?: Json | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          claim_id?: string | null
          claim_line_id?: string | null
          created_at?: string
          details?: Json | null
          era_id?: string | null
          era_service_line_id?: string | null
          finding_type?: string
          id?: string
          official_era_value?: Json | null
          payment_source_row_id?: string | null
          report_value?: Json | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      calendar_sync_log: {
        Row: {
          appointment_id: string
          created_at: string
          error_message: string | null
          google_calendar_id: string | null
          google_event_id: string | null
          id: string
          last_synced_at: string | null
          retry_count: number
          staff_id: string
          sync_direction: string
          sync_status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          error_message?: string | null
          google_calendar_id?: string | null
          google_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          retry_count?: number
          staff_id: string
          sync_direction?: string
          sync_status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          error_message?: string | null
          google_calendar_id?: string | null
          google_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          retry_count?: number
          staff_id?: string
          sync_direction?: string
          sync_status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_sync_log_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_sync_log_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_sync_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_watch_channels: {
        Row: {
          calendar_id: string
          channel_id: string
          created_at: string
          expiration: string
          id: string
          resource_id: string
          staff_id: string
          sync_token: string | null
          tenant_id: string
        }
        Insert: {
          calendar_id: string
          channel_id: string
          created_at?: string
          expiration: string
          id?: string
          resource_id: string
          staff_id: string
          sync_token?: string | null
          tenant_id: string
        }
        Update: {
          calendar_id?: string
          channel_id?: string
          created_at?: string
          expiration?: string
          id?: string
          resource_id?: string
          staff_id?: string
          sync_token?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_watch_channels_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_watch_channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_appeals: {
        Row: {
          appeal_date: string
          appeal_reason: string | null
          appeal_status: string
          claim_id: string
          created_at: string
          id: string
          outcome: string | null
          outcome_date: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          appeal_date?: string
          appeal_reason?: string | null
          appeal_status?: string
          claim_id: string
          created_at?: string
          id?: string
          outcome?: string | null
          outcome_date?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          appeal_date?: string
          appeal_reason?: string | null
          appeal_status?: string
          claim_id?: string
          created_at?: string
          id?: string
          outcome?: string | null
          outcome_date?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_appeals_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_appeals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_batch_claims: {
        Row: {
          batch_id: string
          claim_batch_status: string | null
          claim_id: string
          created_at: string
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          batch_id: string
          claim_batch_status?: string | null
          claim_id: string
          created_at?: string
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          batch_id?: string
          claim_batch_status?: string | null
          claim_id?: string
          created_at?: string
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_batch_claims_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "claim_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_batch_claims_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_batch_claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_batches: {
        Row: {
          batch_status: string
          created_at: string
          id: string
          remote_batch_id: string | null
          remote_file_id: string | null
          submitted_at: string | null
          tenant_id: string
        }
        Insert: {
          batch_status?: string
          created_at?: string
          id?: string
          remote_batch_id?: string | null
          remote_file_id?: string | null
          submitted_at?: string | null
          tenant_id: string
        }
        Update: {
          batch_status?: string
          created_at?: string
          id?: string
          remote_batch_id?: string | null
          remote_file_id?: string | null
          submitted_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_diagnoses: {
        Row: {
          claim_id: string
          created_at: string
          diag_sequence: number
          diagnosis_code_id: string
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          diag_sequence: number
          diagnosis_code_id: string
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          diag_sequence?: number
          diagnosis_code_id?: string
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_diagnoses_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_diagnoses_diagnosis_code_id_fkey"
            columns: ["diagnosis_code_id"]
            isOneToOne: false
            referencedRelation: "diagnosis_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_diagnoses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_line_diagnoses: {
        Row: {
          claim_diagnosis_id: string
          claim_line_id: string
          created_at: string
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          claim_diagnosis_id: string
          claim_line_id: string
          created_at?: string
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          claim_diagnosis_id?: string
          claim_line_id?: string
          created_at?: string
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_line_diagnoses_claim_diagnosis_id_fkey"
            columns: ["claim_diagnosis_id"]
            isOneToOne: false
            referencedRelation: "claim_diagnoses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_line_diagnoses_claim_line_id_fkey"
            columns: ["claim_line_id"]
            isOneToOne: false
            referencedRelation: "claim_line_balances"
            referencedColumns: ["claim_line_id"]
          },
          {
            foreignKeyName: "claim_line_diagnoses_claim_line_id_fkey"
            columns: ["claim_line_id"]
            isOneToOne: false
            referencedRelation: "claim_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_line_diagnoses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_lines: {
        Row: {
          adjusted_amount: number | null
          allowed_amount: number | null
          appointment_id: string | null
          charge_amount: number
          claim_id: string
          created_at: string
          era_reconciliation_status: Database["public"]["Enums"]["claim_line_era_reconciliation_status"]
          financial_payment_status: Database["public"]["Enums"]["claim_line_financial_status"]
          id: string
          mod1: string | null
          mod2: string | null
          mod3: string | null
          mod4: string | null
          paid_amount: number | null
          patient_responsibility: number | null
          place_of_service: string | null
          procedure_code: string
          service_date_from: string
          service_date_to: string | null
          service_notes: string | null
          tenant_id: string
          units: number
          updated_at: string
        }
        Insert: {
          adjusted_amount?: number | null
          allowed_amount?: number | null
          appointment_id?: string | null
          charge_amount: number
          claim_id: string
          created_at?: string
          era_reconciliation_status?: Database["public"]["Enums"]["claim_line_era_reconciliation_status"]
          financial_payment_status?: Database["public"]["Enums"]["claim_line_financial_status"]
          id?: string
          mod1?: string | null
          mod2?: string | null
          mod3?: string | null
          mod4?: string | null
          paid_amount?: number | null
          patient_responsibility?: number | null
          place_of_service?: string | null
          procedure_code: string
          service_date_from: string
          service_date_to?: string | null
          service_notes?: string | null
          tenant_id: string
          units?: number
          updated_at?: string
        }
        Update: {
          adjusted_amount?: number | null
          allowed_amount?: number | null
          appointment_id?: string | null
          charge_amount?: number
          claim_id?: string
          created_at?: string
          era_reconciliation_status?: Database["public"]["Enums"]["claim_line_era_reconciliation_status"]
          financial_payment_status?: Database["public"]["Enums"]["claim_line_financial_status"]
          id?: string
          mod1?: string | null
          mod2?: string | null
          mod3?: string | null
          mod4?: string | null
          paid_amount?: number | null
          patient_responsibility?: number | null
          place_of_service?: string | null
          procedure_code?: string
          service_date_from?: string
          service_date_to?: string | null
          service_notes?: string | null
          tenant_id?: string
          units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_lines_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_lines_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_payer_list: {
        Row: {
          attachments: string | null
          created_at: string | null
          dental_claims: string | null
          eligibility: string | null
          eligibility_category: string | null
          era: string | null
          institutional_claims: string | null
          payer_id: string
          payer_name: string | null
          payer_state: string | null
          payer_type: string | null
          professional_claims: string | null
          secondary_support: string | null
          updated_at: string | null
          workers_comp: string | null
        }
        Insert: {
          attachments?: string | null
          created_at?: string | null
          dental_claims?: string | null
          eligibility?: string | null
          eligibility_category?: string | null
          era?: string | null
          institutional_claims?: string | null
          payer_id: string
          payer_name?: string | null
          payer_state?: string | null
          payer_type?: string | null
          professional_claims?: string | null
          secondary_support?: string | null
          updated_at?: string | null
          workers_comp?: string | null
        }
        Update: {
          attachments?: string | null
          created_at?: string | null
          dental_claims?: string | null
          eligibility?: string | null
          eligibility_category?: string | null
          era?: string | null
          institutional_claims?: string | null
          payer_id?: string
          payer_name?: string | null
          payer_state?: string | null
          payer_type?: string | null
          professional_claims?: string | null
          secondary_support?: string | null
          updated_at?: string | null
          workers_comp?: string | null
        }
        Relationships: []
      }
      claim_status_events: {
        Row: {
          claim_id: string
          claimmd_response_id: string | null
          created_at: string | null
          event_source: string
          id: string
          new_status: string
          old_status: string | null
          raw_payload: Json | null
          status_message: string | null
          tenant_id: string
        }
        Insert: {
          claim_id: string
          claimmd_response_id?: string | null
          created_at?: string | null
          event_source: string
          id?: string
          new_status: string
          old_status?: string | null
          raw_payload?: Json | null
          status_message?: string | null
          tenant_id: string
        }
        Update: {
          claim_id?: string
          claimmd_response_id?: string | null
          created_at?: string | null
          event_source?: string
          id?: string
          new_status?: string
          old_status?: string | null
          raw_payload?: Json | null
          status_message?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_status_events_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_status_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_submission_requests: {
        Row: {
          claim_ids: string[]
          client_action_id: string
          created_at: string
          external_finalized_at: string | null
          external_response_snapshot: Json | null
          external_started_at: string | null
          id: string
          last_reconciled_at: string | null
          requested_by_profile_id: string | null
          result: Json | null
          single_claim_id: string | null
          status: string
          submission_state:
            | Database["public"]["Enums"]["claim_submission_state"]
            | null
          tenant_id: string
          uncertain_reason: string | null
          updated_at: string
        }
        Insert: {
          claim_ids: string[]
          client_action_id: string
          created_at?: string
          external_finalized_at?: string | null
          external_response_snapshot?: Json | null
          external_started_at?: string | null
          id?: string
          last_reconciled_at?: string | null
          requested_by_profile_id?: string | null
          result?: Json | null
          single_claim_id?: string | null
          status?: string
          submission_state?:
            | Database["public"]["Enums"]["claim_submission_state"]
            | null
          tenant_id: string
          uncertain_reason?: string | null
          updated_at?: string
        }
        Update: {
          claim_ids?: string[]
          client_action_id?: string
          created_at?: string
          external_finalized_at?: string | null
          external_response_snapshot?: Json | null
          external_started_at?: string | null
          id?: string
          last_reconciled_at?: string | null
          requested_by_profile_id?: string | null
          result?: Json | null
          single_claim_id?: string | null
          status?: string
          submission_state?:
            | Database["public"]["Enums"]["claim_submission_state"]
            | null
          tenant_id?: string
          uncertain_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_submission_requests_requested_by_profile_id_fkey"
            columns: ["requested_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "claim_submission_requests_requested_by_profile_id_fkey"
            columns: ["requested_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_submission_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claimmd_cursors: {
        Row: {
          cursor_type: string
          cursor_value: string
          id: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          cursor_type: string
          cursor_value?: string
          id?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          cursor_type?: string
          cursor_value?: string
          id?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claimmd_cursors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claims: {
        Row: {
          accept_assignment: boolean
          auto_accident: boolean
          auto_accident_state:
            | Database["public"]["Enums"]["state_code_enum"]
            | null
          claim_notes: string | null
          claim_number: string | null
          claim_status: string
          client_id: string
          client_insurance_id: string
          created_at: string
          employment_related: boolean
          frequency_code: string | null
          id: string
          original_claim_id: string | null
          practice_id: string
          prior_auth: string | null
          referral_id: string | null
          rendering_staff_id: string
          tenant_id: string
          total_charge: number | null
          updated_at: string
        }
        Insert: {
          accept_assignment?: boolean
          auto_accident?: boolean
          auto_accident_state?:
            | Database["public"]["Enums"]["state_code_enum"]
            | null
          claim_notes?: string | null
          claim_number?: string | null
          claim_status?: string
          client_id: string
          client_insurance_id: string
          created_at?: string
          employment_related?: boolean
          frequency_code?: string | null
          id?: string
          original_claim_id?: string | null
          practice_id: string
          prior_auth?: string | null
          referral_id?: string | null
          rendering_staff_id: string
          tenant_id: string
          total_charge?: number | null
          updated_at?: string
        }
        Update: {
          accept_assignment?: boolean
          auto_accident?: boolean
          auto_accident_state?:
            | Database["public"]["Enums"]["state_code_enum"]
            | null
          claim_notes?: string | null
          claim_number?: string | null
          claim_status?: string
          client_id?: string
          client_insurance_id?: string
          created_at?: string
          employment_related?: boolean
          frequency_code?: string | null
          id?: string
          original_claim_id?: string | null
          practice_id?: string
          prior_auth?: string | null
          referral_id?: string | null
          rendering_staff_id?: string
          tenant_id?: string
          total_charge?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claims_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "claims_client_insurance_id_fkey"
            columns: ["client_insurance_id"]
            isOneToOne: false
            referencedRelation: "client_insurance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_client_insurance_id_fkey"
            columns: ["client_insurance_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_operations"
            referencedColumns: ["current_insurance_id"]
          },
          {
            foreignKeyName: "claims_original_claim_id_fkey"
            columns: ["original_claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_practice_id_fkey"
            columns: ["practice_id"]
            isOneToOne: false
            referencedRelation: "practice_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_rendering_staff_id_fkey"
            columns: ["rendering_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clickup_client_mirror_state: {
        Row: {
          canonical_payload_hash: string | null
          clickup_task_id: string | null
          client_id: string
          consecutive_failure_count: number
          created_at: string
          last_attempted_sync_at: string | null
          last_error_code: string | null
          last_error_detail: string | null
          last_outbox_event_id: string | null
          last_successful_sync_at: string | null
          remote_deleted_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          canonical_payload_hash?: string | null
          clickup_task_id?: string | null
          client_id: string
          consecutive_failure_count?: number
          created_at?: string
          last_attempted_sync_at?: string | null
          last_error_code?: string | null
          last_error_detail?: string | null
          last_outbox_event_id?: string | null
          last_successful_sync_at?: string | null
          remote_deleted_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          canonical_payload_hash?: string | null
          clickup_task_id?: string | null
          client_id?: string
          consecutive_failure_count?: number
          created_at?: string
          last_attempted_sync_at?: string | null
          last_error_code?: string | null
          last_error_detail?: string | null
          last_outbox_event_id?: string | null
          last_successful_sync_at?: string | null
          remote_deleted_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clickup_client_mirror_state_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clickup_client_mirror_state_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "clickup_client_mirror_state_last_outbox_event_id_fkey"
            columns: ["last_outbox_event_id"]
            isOneToOne: false
            referencedRelation: "integration_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clickup_client_mirror_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_assessment_assignments: {
        Row: {
          assessment_type: string
          assigned_by_staff_id: string | null
          client_id: string
          created_at: string
          id: string
          is_active: boolean
          last_completed_at: string | null
          next_due_at: string | null
          recurrence_days: number
          source: string
          source_diagnosis_code: string | null
          tenant_id: string
          treatment_plan_id: string | null
          updated_at: string
        }
        Insert: {
          assessment_type: string
          assigned_by_staff_id?: string | null
          client_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_completed_at?: string | null
          next_due_at?: string | null
          recurrence_days?: number
          source: string
          source_diagnosis_code?: string | null
          tenant_id: string
          treatment_plan_id?: string | null
          updated_at?: string
        }
        Update: {
          assessment_type?: string
          assigned_by_staff_id?: string | null
          client_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_completed_at?: string | null
          next_due_at?: string | null
          recurrence_days?: number
          source?: string
          source_diagnosis_code?: string | null
          tenant_id?: string
          treatment_plan_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_assessment_assignments_assigned_by_staff_id_fkey"
            columns: ["assigned_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assessment_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assessment_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_assessment_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assessment_assignments_treatment_plan_id_fkey"
            columns: ["treatment_plan_id"]
            isOneToOne: false
            referencedRelation: "client_treatment_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      client_at_risk_evaluation_log: {
        Row: {
          anchor_at: string | null
          care_cadence: Database["public"]["Enums"]["client_care_cadence_enum"]
          client_id: string
          created_at: string
          evaluated_at: string
          evaluation_run_key: string
          evaluator_version: number
          evidence: Json
          id: string
          lifecycle_stage: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
          next_future_appointment_id: string | null
          reason_codes: string[]
          should_be_at_risk: boolean
          source: string
          tenant_id: string
          threshold_days: number
        }
        Insert: {
          anchor_at?: string | null
          care_cadence: Database["public"]["Enums"]["client_care_cadence_enum"]
          client_id: string
          created_at?: string
          evaluated_at?: string
          evaluation_run_key: string
          evaluator_version?: number
          evidence?: Json
          id?: string
          lifecycle_stage: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
          next_future_appointment_id?: string | null
          reason_codes?: string[]
          should_be_at_risk: boolean
          source: string
          tenant_id: string
          threshold_days: number
        }
        Update: {
          anchor_at?: string | null
          care_cadence?: Database["public"]["Enums"]["client_care_cadence_enum"]
          client_id?: string
          created_at?: string
          evaluated_at?: string
          evaluation_run_key?: string
          evaluator_version?: number
          evidence?: Json
          id?: string
          lifecycle_stage?: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
          next_future_appointment_id?: string | null
          reason_codes?: string[]
          should_be_at_risk?: boolean
          source?: string
          tenant_id?: string
          threshold_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_at_risk_evaluation_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_at_risk_evaluation_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_at_risk_evaluation_log_next_future_appointment_id_fkey"
            columns: ["next_future_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_at_risk_evaluation_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_charges: {
        Row: {
          amount: number
          appointment_id: string | null
          charge_type: string
          client_id: string
          created_at: string
          description: string | null
          id: string
          paid_amount: number
          staff_id: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          appointment_id?: string | null
          charge_type: string
          client_id: string
          created_at?: string
          description?: string | null
          id?: string
          paid_amount?: number
          staff_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          charge_type?: string
          client_id?: string
          created_at?: string
          description?: string | null
          id?: string
          paid_amount?: number
          staff_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_charges_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_charges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_charges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_charges_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_charges_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_diagnoses: {
        Row: {
          added_at: string
          client_id: string
          created_at: string
          diagnosis_code_id: string
          id: string
          is_active: boolean
          is_primary: boolean
          notes: string | null
          resolved_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          added_at?: string
          client_id: string
          created_at?: string
          diagnosis_code_id?: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          notes?: string | null
          resolved_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          added_at?: string
          client_id?: string
          created_at?: string
          diagnosis_code_id?: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          notes?: string | null
          resolved_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_diagnoses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_diagnoses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_diagnoses_diagnosis_code_id_fkey"
            columns: ["diagnosis_code_id"]
            isOneToOne: false
            referencedRelation: "diagnosis_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_diagnoses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_emergency_contacts: {
        Row: {
          addr_1: string | null
          addr_2: string | null
          city: string | null
          client_id: string
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          is_primary: boolean
          name: string
          phone: string
          relationship: string | null
          state: Database["public"]["Enums"]["state_code_enum"] | null
          tenant_id: string
          updated_at: string
          zip: string | null
        }
        Insert: {
          addr_1?: string | null
          addr_2?: string | null
          city?: string | null
          client_id: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          name: string
          phone: string
          relationship?: string | null
          state?: Database["public"]["Enums"]["state_code_enum"] | null
          tenant_id: string
          updated_at?: string
          zip?: string | null
        }
        Update: {
          addr_1?: string | null
          addr_2?: string | null
          city?: string | null
          client_id?: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          name?: string
          phone?: string
          relationship?: string | null
          state?: Database["public"]["Enums"]["state_code_enum"] | null
          tenant_id?: string
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_emergency_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_emergency_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_emergency_contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_form_assignments: {
        Row: {
          assigned_at: string
          assigned_by_profile_id: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          due_at: string | null
          form_response_id: string | null
          form_template_id: string
          id: string
          notes: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by_profile_id?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          due_at?: string | null
          form_response_id?: string | null
          form_template_id: string
          id?: string
          notes?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by_profile_id?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          due_at?: string | null
          form_response_id?: string | null
          form_template_id?: string
          id?: string
          notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_form_assignments_assigned_by_profile_id_fkey"
            columns: ["assigned_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_form_assignments_assigned_by_profile_id_fkey"
            columns: ["assigned_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_form_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_form_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_form_assignments_form_response_id_fkey"
            columns: ["form_response_id"]
            isOneToOne: false
            referencedRelation: "form_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_form_assignments_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_form_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_gad7_assessments: {
        Row: {
          administered_at: string
          appointment_id: string | null
          assessment_date: string | null
          client_id: string
          clinician_name_snapshot: string | null
          created_at: string
          id: string
          q1: number
          q2: number
          q3: number
          q4: number
          q5: number
          q6: number
          q7: number
          severity: Database["public"]["Enums"]["gad7_severity_enum"]
          staff_id: string | null
          tenant_id: string
          total_score: number
          updated_at: string
        }
        Insert: {
          administered_at?: string
          appointment_id?: string | null
          assessment_date?: string | null
          client_id: string
          clinician_name_snapshot?: string | null
          created_at?: string
          id?: string
          q1: number
          q2: number
          q3: number
          q4: number
          q5: number
          q6: number
          q7: number
          severity: Database["public"]["Enums"]["gad7_severity_enum"]
          staff_id?: string | null
          tenant_id: string
          total_score: number
          updated_at?: string
        }
        Update: {
          administered_at?: string
          appointment_id?: string | null
          assessment_date?: string | null
          client_id?: string
          clinician_name_snapshot?: string | null
          created_at?: string
          id?: string
          q1?: number
          q2?: number
          q3?: number
          q4?: number
          q5?: number
          q6?: number
          q7?: number
          severity?: Database["public"]["Enums"]["gad7_severity_enum"]
          staff_id?: string | null
          tenant_id?: string
          total_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_gad7_assessments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_gad7_assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_gad7_assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_gad7_assessments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_gad7_assessments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_history_family_members: {
        Row: {
          client_id: string
          context: Database["public"]["Enums"]["client_history_family_context_enum"]
          created_at: string
          history_form_id: string
          id: string
          name: string | null
          personality: string | null
          relationship_growing_up: string | null
          relationship_now: string | null
          relationship_type: string | null
          sort_order: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          context: Database["public"]["Enums"]["client_history_family_context_enum"]
          created_at?: string
          history_form_id: string
          id?: string
          name?: string | null
          personality?: string | null
          relationship_growing_up?: string | null
          relationship_now?: string | null
          relationship_type?: string | null
          sort_order?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          context?: Database["public"]["Enums"]["client_history_family_context_enum"]
          created_at?: string
          history_form_id?: string
          id?: string
          name?: string | null
          personality?: string | null
          relationship_growing_up?: string | null
          relationship_now?: string | null
          relationship_type?: string | null
          sort_order?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_history_family_members_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_family_members_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_history_family_members_history_form_id_fkey"
            columns: ["history_form_id"]
            isOneToOne: false
            referencedRelation: "client_history_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_family_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_history_forms: {
        Row: {
          additional_info: string | null
          additional_info2: string | null
          alcohol_use_per_week: number | null
          childhood_elaboration: string | null
          childhood_experiences: string[] | null
          chronic_health: string | null
          client_id: string
          counseling_goals: string | null
          created_at: string
          current_issues: string | null
          drug_use: string | null
          education_level: string | null
          emergency_name: string | null
          emergency_phone: string | null
          emergency_relationship: string | null
          ever_married_before: boolean | null
          ever_mh_treatment: boolean | null
          ever_psych_hold: boolean | null
          ever_psych_hospitalized: boolean | null
          ever_suicide_attempt: boolean | null
          hobbies: string | null
          id: string
          is_married: boolean | null
          life_changes: string | null
          medical_conditions: string[] | null
          occupation_details: string | null
          personal_strengths: string | null
          progression_of_issues: string | null
          relationship_problems: string | null
          same_household_as_family: boolean | null
          signature: string | null
          sleep_hours: number | null
          spouse_name: string | null
          spouse_personality: string | null
          spouse_relationship: string | null
          submission_date: string | null
          submitted_by_profile_id: string | null
          symptoms_behavioral: string[] | null
          symptoms_cognitive: string[] | null
          symptoms_life_stressors: string[] | null
          symptoms_mood: string[] | null
          symptoms_physical: string[] | null
          takes_prescription_meds: boolean | null
          tenant_id: string
          tobacco_use_per_day: number | null
          updated_at: string
        }
        Insert: {
          additional_info?: string | null
          additional_info2?: string | null
          alcohol_use_per_week?: number | null
          childhood_elaboration?: string | null
          childhood_experiences?: string[] | null
          chronic_health?: string | null
          client_id: string
          counseling_goals?: string | null
          created_at?: string
          current_issues?: string | null
          drug_use?: string | null
          education_level?: string | null
          emergency_name?: string | null
          emergency_phone?: string | null
          emergency_relationship?: string | null
          ever_married_before?: boolean | null
          ever_mh_treatment?: boolean | null
          ever_psych_hold?: boolean | null
          ever_psych_hospitalized?: boolean | null
          ever_suicide_attempt?: boolean | null
          hobbies?: string | null
          id?: string
          is_married?: boolean | null
          life_changes?: string | null
          medical_conditions?: string[] | null
          occupation_details?: string | null
          personal_strengths?: string | null
          progression_of_issues?: string | null
          relationship_problems?: string | null
          same_household_as_family?: boolean | null
          signature?: string | null
          sleep_hours?: number | null
          spouse_name?: string | null
          spouse_personality?: string | null
          spouse_relationship?: string | null
          submission_date?: string | null
          submitted_by_profile_id?: string | null
          symptoms_behavioral?: string[] | null
          symptoms_cognitive?: string[] | null
          symptoms_life_stressors?: string[] | null
          symptoms_mood?: string[] | null
          symptoms_physical?: string[] | null
          takes_prescription_meds?: boolean | null
          tenant_id: string
          tobacco_use_per_day?: number | null
          updated_at?: string
        }
        Update: {
          additional_info?: string | null
          additional_info2?: string | null
          alcohol_use_per_week?: number | null
          childhood_elaboration?: string | null
          childhood_experiences?: string[] | null
          chronic_health?: string | null
          client_id?: string
          counseling_goals?: string | null
          created_at?: string
          current_issues?: string | null
          drug_use?: string | null
          education_level?: string | null
          emergency_name?: string | null
          emergency_phone?: string | null
          emergency_relationship?: string | null
          ever_married_before?: boolean | null
          ever_mh_treatment?: boolean | null
          ever_psych_hold?: boolean | null
          ever_psych_hospitalized?: boolean | null
          ever_suicide_attempt?: boolean | null
          hobbies?: string | null
          id?: string
          is_married?: boolean | null
          life_changes?: string | null
          medical_conditions?: string[] | null
          occupation_details?: string | null
          personal_strengths?: string | null
          progression_of_issues?: string | null
          relationship_problems?: string | null
          same_household_as_family?: boolean | null
          signature?: string | null
          sleep_hours?: number | null
          spouse_name?: string | null
          spouse_personality?: string | null
          spouse_relationship?: string | null
          submission_date?: string | null
          submitted_by_profile_id?: string | null
          symptoms_behavioral?: string[] | null
          symptoms_cognitive?: string[] | null
          symptoms_life_stressors?: string[] | null
          symptoms_mood?: string[] | null
          symptoms_physical?: string[] | null
          takes_prescription_meds?: boolean | null
          tenant_id?: string
          tobacco_use_per_day?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_history_forms_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_forms_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_history_forms_submitted_by_profile_id_fkey"
            columns: ["submitted_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_history_forms_submitted_by_profile_id_fkey"
            columns: ["submitted_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_forms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_history_medications: {
        Row: {
          client_id: string
          created_at: string
          history_form_id: string
          id: string
          med_duration: string | null
          med_name: string | null
          med_purpose: string | null
          sort_order: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          history_form_id: string
          id?: string
          med_duration?: string | null
          med_name?: string | null
          med_purpose?: string | null
          sort_order?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          history_form_id?: string
          id?: string
          med_duration?: string | null
          med_name?: string | null
          med_purpose?: string | null
          sort_order?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_history_medications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_medications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_history_medications_history_form_id_fkey"
            columns: ["history_form_id"]
            isOneToOne: false
            referencedRelation: "client_history_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_medications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_history_past_spouses: {
        Row: {
          client_id: string
          created_at: string
          history_form_id: string
          id: string
          name: string | null
          personality: string | null
          relationship: string | null
          sort_order: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          history_form_id: string
          id?: string
          name?: string | null
          personality?: string | null
          relationship?: string | null
          sort_order?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          history_form_id?: string
          id?: string
          name?: string | null
          personality?: string | null
          relationship?: string | null
          sort_order?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_history_past_spouses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_past_spouses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_history_past_spouses_history_form_id_fkey"
            columns: ["history_form_id"]
            isOneToOne: false
            referencedRelation: "client_history_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_past_spouses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_history_past_treatments: {
        Row: {
          client_id: string
          created_at: string
          history_form_id: string
          id: string
          provider_name: string | null
          sort_order: number | null
          tenant_id: string
          treatment_length: string | null
          treatment_reason: string | null
          treatment_year: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          history_form_id: string
          id?: string
          provider_name?: string | null
          sort_order?: number | null
          tenant_id: string
          treatment_length?: string | null
          treatment_reason?: string | null
          treatment_year?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          history_form_id?: string
          id?: string
          provider_name?: string | null
          sort_order?: number | null
          tenant_id?: string
          treatment_length?: string | null
          treatment_reason?: string | null
          treatment_year?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_history_past_treatments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_past_treatments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_history_past_treatments_history_form_id_fkey"
            columns: ["history_form_id"]
            isOneToOne: false
            referencedRelation: "client_history_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_past_treatments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_insurance: {
        Row: {
          claims_office_number: string | null
          client_id: string
          copay_amount: number | null
          created_at: string
          deductible_amount: number | null
          deductible_met: number | null
          effective_date: string | null
          eligibility_verification_version: number
          has_other_coverage: boolean | null
          id: string
          ins_addr_1: string | null
          ins_addr_2: string | null
          ins_city: string | null
          ins_country: string
          ins_dob: string | null
          ins_employer: string | null
          ins_group: string | null
          ins_name_f: string | null
          ins_name_l: string | null
          ins_name_m: string | null
          ins_number: string | null
          ins_phone: string | null
          ins_plan: string | null
          ins_sex: Database["public"]["Enums"]["sex_enum"] | null
          ins_state: Database["public"]["Enums"]["state_code_enum"] | null
          ins_zip: string | null
          is_active: boolean
          out_of_pocket_max: number | null
          out_of_pocket_met: number | null
          pat_rel: Database["public"]["Enums"]["pat_rel_enum"] | null
          payer_addr_1: string | null
          payer_addr_2: string | null
          payer_city: string | null
          payer_name: string | null
          payer_order: string
          payer_order_source: string | null
          payer_phone: string | null
          payer_state: Database["public"]["Enums"]["state_code_enum"] | null
          payer_zip: string | null
          payerid: string | null
          prior_auth: string | null
          tenant_id: string
          termination_date: string | null
          updated_at: string
        }
        Insert: {
          claims_office_number?: string | null
          client_id: string
          copay_amount?: number | null
          created_at?: string
          deductible_amount?: number | null
          deductible_met?: number | null
          effective_date?: string | null
          eligibility_verification_version?: number
          has_other_coverage?: boolean | null
          id?: string
          ins_addr_1?: string | null
          ins_addr_2?: string | null
          ins_city?: string | null
          ins_country?: string
          ins_dob?: string | null
          ins_employer?: string | null
          ins_group?: string | null
          ins_name_f?: string | null
          ins_name_l?: string | null
          ins_name_m?: string | null
          ins_number?: string | null
          ins_phone?: string | null
          ins_plan?: string | null
          ins_sex?: Database["public"]["Enums"]["sex_enum"] | null
          ins_state?: Database["public"]["Enums"]["state_code_enum"] | null
          ins_zip?: string | null
          is_active?: boolean
          out_of_pocket_max?: number | null
          out_of_pocket_met?: number | null
          pat_rel?: Database["public"]["Enums"]["pat_rel_enum"] | null
          payer_addr_1?: string | null
          payer_addr_2?: string | null
          payer_city?: string | null
          payer_name?: string | null
          payer_order: string
          payer_order_source?: string | null
          payer_phone?: string | null
          payer_state?: Database["public"]["Enums"]["state_code_enum"] | null
          payer_zip?: string | null
          payerid?: string | null
          prior_auth?: string | null
          tenant_id: string
          termination_date?: string | null
          updated_at?: string
        }
        Update: {
          claims_office_number?: string | null
          client_id?: string
          copay_amount?: number | null
          created_at?: string
          deductible_amount?: number | null
          deductible_met?: number | null
          effective_date?: string | null
          eligibility_verification_version?: number
          has_other_coverage?: boolean | null
          id?: string
          ins_addr_1?: string | null
          ins_addr_2?: string | null
          ins_city?: string | null
          ins_country?: string
          ins_dob?: string | null
          ins_employer?: string | null
          ins_group?: string | null
          ins_name_f?: string | null
          ins_name_l?: string | null
          ins_name_m?: string | null
          ins_number?: string | null
          ins_phone?: string | null
          ins_plan?: string | null
          ins_sex?: Database["public"]["Enums"]["sex_enum"] | null
          ins_state?: Database["public"]["Enums"]["state_code_enum"] | null
          ins_zip?: string | null
          is_active?: boolean
          out_of_pocket_max?: number | null
          out_of_pocket_met?: number | null
          pat_rel?: Database["public"]["Enums"]["pat_rel_enum"] | null
          payer_addr_1?: string | null
          payer_addr_2?: string | null
          payer_city?: string | null
          payer_name?: string | null
          payer_order?: string
          payer_order_source?: string | null
          payer_phone?: string | null
          payer_state?: Database["public"]["Enums"]["state_code_enum"] | null
          payer_zip?: string | null
          payerid?: string | null
          prior_auth?: string | null
          tenant_id?: string
          termination_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_insurance_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_insurance_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_insurance_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_insurance_deferment_acknowledgements: {
        Row: {
          acknowledged_at: string
          acknowledged_by_profile_id: string
          acknowledgement_text: string
          acknowledgement_version: string
          client_id: string
          client_insurance_id: string
          created_at: string
          eligibility_check_id: string
          id: string
          outcome: Database["public"]["Enums"]["insurance_eligibility_outcome_enum"]
          superseded_at: string | null
          tenant_id: string
        }
        Insert: {
          acknowledged_at?: string
          acknowledged_by_profile_id: string
          acknowledgement_text: string
          acknowledgement_version?: string
          client_id: string
          client_insurance_id: string
          created_at?: string
          eligibility_check_id: string
          id?: string
          outcome: Database["public"]["Enums"]["insurance_eligibility_outcome_enum"]
          superseded_at?: string | null
          tenant_id: string
        }
        Update: {
          acknowledged_at?: string
          acknowledged_by_profile_id?: string
          acknowledgement_text?: string
          acknowledgement_version?: string
          client_id?: string
          client_insurance_id?: string
          created_at?: string
          eligibility_check_id?: string
          id?: string
          outcome?: Database["public"]["Enums"]["insurance_eligibility_outcome_enum"]
          superseded_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_insurance_deferment_ackn_acknowledged_by_profile_id_fkey"
            columns: ["acknowledged_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_insurance_deferment_ackn_acknowledged_by_profile_id_fkey"
            columns: ["acknowledged_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_insurance_deferment_acknowledg_eligibility_check_id_fkey"
            columns: ["eligibility_check_id"]
            isOneToOne: false
            referencedRelation: "eligibility_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_insurance_deferment_acknowledge_client_insurance_id_fkey"
            columns: ["client_insurance_id"]
            isOneToOne: false
            referencedRelation: "client_insurance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_insurance_deferment_acknowledge_client_insurance_id_fkey"
            columns: ["client_insurance_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_operations"
            referencedColumns: ["current_insurance_id"]
          },
          {
            foreignKeyName: "client_insurance_deferment_acknowledgements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_insurance_deferment_acknowledgements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_insurance_deferment_acknowledgements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_journey_exception_history: {
        Row: {
          action: string
          change_note: string | null
          change_source: string
          changed_by_profile_id: string | null
          client_id: string
          created_at: string
          exception_id: string
          id: number
          new_owner_profile_id: string | null
          new_resolution_state: string
          previous_owner_profile_id: string | null
          previous_resolution_state: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          change_note?: string | null
          change_source: string
          changed_by_profile_id?: string | null
          client_id: string
          created_at?: string
          exception_id: string
          id?: never
          new_owner_profile_id?: string | null
          new_resolution_state: string
          previous_owner_profile_id?: string | null
          previous_resolution_state?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          change_note?: string | null
          change_source?: string
          changed_by_profile_id?: string | null
          client_id?: string
          created_at?: string
          exception_id?: string
          id?: never
          new_owner_profile_id?: string | null
          new_resolution_state?: string
          previous_owner_profile_id?: string | null
          previous_resolution_state?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_journey_exception_history_changed_by_profile_id_fkey"
            columns: ["changed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_journey_exception_history_changed_by_profile_id_fkey"
            columns: ["changed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exception_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exception_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_journey_exception_history_exception_id_fkey"
            columns: ["exception_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exception_history_exception_id_fkey"
            columns: ["exception_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exceptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exception_history_new_owner_profile_id_fkey"
            columns: ["new_owner_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_journey_exception_history_new_owner_profile_id_fkey"
            columns: ["new_owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exception_history_previous_owner_profile_id_fkey"
            columns: ["previous_owner_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_journey_exception_history_previous_owner_profile_id_fkey"
            columns: ["previous_owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_journey_exception_reason_catalog: {
        Row: {
          automation_key: string | null
          category: string
          created_at: string
          default_next_action: string
          default_sla: string
          is_active: boolean
          label: string
          reason_code: string
          updated_at: string
        }
        Insert: {
          automation_key?: string | null
          category: string
          created_at?: string
          default_next_action: string
          default_sla: string
          is_active?: boolean
          label: string
          reason_code: string
          updated_at?: string
        }
        Update: {
          automation_key?: string | null
          category?: string
          created_at?: string
          default_next_action?: string
          default_sla?: string
          is_active?: boolean
          label?: string
          reason_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_journey_exceptions: {
        Row: {
          category: string
          client_id: string
          created_at: string
          created_by_profile_id: string | null
          evidence: Json
          exception_type: string
          id: string
          next_action: string
          owner_profile_id: string | null
          reason_code: string
          reason_detail: string
          related_entity_id: string | null
          related_entity_type: string | null
          resolution_note: string | null
          resolution_state: string
          resolved_at: string | null
          resolved_by_profile_id: string | null
          review_due_at: string
          run_key: string | null
          source: string
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          category: string
          client_id: string
          created_at?: string
          created_by_profile_id?: string | null
          evidence?: Json
          exception_type?: string
          id?: string
          next_action: string
          owner_profile_id?: string | null
          reason_code: string
          reason_detail: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          resolution_note?: string | null
          resolution_state?: string
          resolved_at?: string | null
          resolved_by_profile_id?: string | null
          review_due_at: string
          run_key?: string | null
          source?: string
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          category?: string
          client_id?: string
          created_at?: string
          created_by_profile_id?: string | null
          evidence?: Json
          exception_type?: string
          id?: string
          next_action?: string
          owner_profile_id?: string | null
          reason_code?: string
          reason_detail?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          resolution_note?: string | null
          resolution_state?: string
          resolved_at?: string | null
          resolved_by_profile_id?: string | null
          review_due_at?: string
          run_key?: string | null
          source?: string
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_journey_exceptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_resolved_by_profile_id_fkey"
            columns: ["resolved_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_resolved_by_profile_id_fkey"
            columns: ["resolved_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_run_key_fkey"
            columns: ["run_key"]
            isOneToOne: false
            referencedRelation: "client_journey_phase4_runs"
            referencedColumns: ["run_key"]
          },
        ]
      }
      client_journey_phase4_reconciliation: {
        Row: {
          application_result: string | null
          applied_at: string | null
          assigned_staff: boolean
          client_id: string
          conversion_old_status: string | null
          documented_sessions: number
          emergency_contact_complete: boolean
          evaluated_at: string
          evidence: Json
          future_scheduled_appointments: number
          inferred_at_risk: boolean
          inferred_at_risk_anchor_at: string | null
          inferred_at_risk_since: string | null
          inferred_closed_at: string | null
          inferred_closure_reason:
            | Database["public"]["Enums"]["client_closure_reason_enum"]
            | null
          inferred_contact_policy: Database["public"]["Enums"]["client_contact_policy_enum"]
          inferred_eligibility_state: Database["public"]["Enums"]["client_eligibility_state_enum"]
          inferred_engagement_state: Database["public"]["Enums"]["client_engagement_state_enum"]
          inferred_lifecycle_stage:
            | Database["public"]["Enums"]["client_lifecycle_stage_enum"]
            | null
          inferred_service_policy: Database["public"]["Enums"]["client_service_policy_enum"]
          latest_eligibility_status: string | null
          latest_engagement_signal: string | null
          latest_qualifying_activity_at: string | null
          latest_scheduled_at: string | null
          legacy_stage_signal: string | null
          legacy_status: string | null
          lifecycle_rationale: string
          review_reason_codes: string[]
          run_key: string
          scheduled_appointments: number
          state_rationale: string
          submitted_intake: boolean
          tenant_id: string
        }
        Insert: {
          application_result?: string | null
          applied_at?: string | null
          assigned_staff?: boolean
          client_id: string
          conversion_old_status?: string | null
          documented_sessions?: number
          emergency_contact_complete?: boolean
          evaluated_at?: string
          evidence?: Json
          future_scheduled_appointments?: number
          inferred_at_risk: boolean
          inferred_at_risk_anchor_at?: string | null
          inferred_at_risk_since?: string | null
          inferred_closed_at?: string | null
          inferred_closure_reason?:
            | Database["public"]["Enums"]["client_closure_reason_enum"]
            | null
          inferred_contact_policy: Database["public"]["Enums"]["client_contact_policy_enum"]
          inferred_eligibility_state: Database["public"]["Enums"]["client_eligibility_state_enum"]
          inferred_engagement_state: Database["public"]["Enums"]["client_engagement_state_enum"]
          inferred_lifecycle_stage?:
            | Database["public"]["Enums"]["client_lifecycle_stage_enum"]
            | null
          inferred_service_policy: Database["public"]["Enums"]["client_service_policy_enum"]
          latest_eligibility_status?: string | null
          latest_engagement_signal?: string | null
          latest_qualifying_activity_at?: string | null
          latest_scheduled_at?: string | null
          legacy_stage_signal?: string | null
          legacy_status?: string | null
          lifecycle_rationale: string
          review_reason_codes?: string[]
          run_key: string
          scheduled_appointments?: number
          state_rationale: string
          submitted_intake?: boolean
          tenant_id: string
        }
        Update: {
          application_result?: string | null
          applied_at?: string | null
          assigned_staff?: boolean
          client_id?: string
          conversion_old_status?: string | null
          documented_sessions?: number
          emergency_contact_complete?: boolean
          evaluated_at?: string
          evidence?: Json
          future_scheduled_appointments?: number
          inferred_at_risk?: boolean
          inferred_at_risk_anchor_at?: string | null
          inferred_at_risk_since?: string | null
          inferred_closed_at?: string | null
          inferred_closure_reason?:
            | Database["public"]["Enums"]["client_closure_reason_enum"]
            | null
          inferred_contact_policy?: Database["public"]["Enums"]["client_contact_policy_enum"]
          inferred_eligibility_state?: Database["public"]["Enums"]["client_eligibility_state_enum"]
          inferred_engagement_state?: Database["public"]["Enums"]["client_engagement_state_enum"]
          inferred_lifecycle_stage?:
            | Database["public"]["Enums"]["client_lifecycle_stage_enum"]
            | null
          inferred_service_policy?: Database["public"]["Enums"]["client_service_policy_enum"]
          latest_eligibility_status?: string | null
          latest_engagement_signal?: string | null
          latest_qualifying_activity_at?: string | null
          latest_scheduled_at?: string | null
          legacy_stage_signal?: string | null
          legacy_status?: string | null
          lifecycle_rationale?: string
          review_reason_codes?: string[]
          run_key?: string
          scheduled_appointments?: number
          state_rationale?: string
          submitted_intake?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_journey_phase4_reconciliation_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_phase4_reconciliation_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_journey_phase4_reconciliation_run_key_fkey"
            columns: ["run_key"]
            isOneToOne: false
            referencedRelation: "client_journey_phase4_runs"
            referencedColumns: ["run_key"]
          },
        ]
      }
      client_journey_phase4_runs: {
        Row: {
          clients_requiring_review: number | null
          completed_at: string | null
          created_at: string
          report: Json
          resolved_lifecycle_clients: number | null
          run_key: string
          scope_before: string
          started_at: string
          total_clients: number | null
          unresolved_lifecycle_clients: number | null
          updated_at: string
        }
        Insert: {
          clients_requiring_review?: number | null
          completed_at?: string | null
          created_at?: string
          report?: Json
          resolved_lifecycle_clients?: number | null
          run_key: string
          scope_before: string
          started_at?: string
          total_clients?: number | null
          unresolved_lifecycle_clients?: number | null
          updated_at?: string
        }
        Update: {
          clients_requiring_review?: number | null
          completed_at?: string | null
          created_at?: string
          report?: Json
          resolved_lifecycle_clients?: number | null
          run_key?: string
          scope_before?: string
          started_at?: string
          total_clients?: number | null
          unresolved_lifecycle_clients?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      client_payment_links: {
        Row: {
          amount_cents: number
          claim_line_ids: string[] | null
          client_charge_ids: string[] | null
          client_id: string
          created_at: string
          currency: string
          description: string | null
          expires_at: string | null
          id: string
          paid_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_payment_link_id: string
          stripe_payment_link_url: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          claim_line_ids?: string[] | null
          client_charge_ids?: string[] | null
          client_id: string
          created_at?: string
          currency?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          paid_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_link_id: string
          stripe_payment_link_url: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          claim_line_ids?: string[] | null
          client_charge_ids?: string[] | null
          client_id?: string
          created_at?: string
          currency?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          paid_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_link_id?: string
          stripe_payment_link_url?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_payment_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payment_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_payment_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_payment_methods: {
        Row: {
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last_four: string | null
          client_id: string
          created_at: string
          id: string
          is_active: boolean | null
          is_default: boolean | null
          stripe_customer_id: string
          stripe_payment_method_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last_four?: string | null
          client_id: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          stripe_customer_id: string
          stripe_payment_method_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last_four?: string | null
          client_id?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          stripe_customer_id?: string
          stripe_payment_method_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_payment_methods_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payment_methods_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_payment_methods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_payments: {
        Row: {
          amount: number
          claim_id: string | null
          client_id: string
          created_at: string
          external_txn_id: string | null
          id: string
          payment_date: string
          payment_method: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          claim_id?: string | null
          client_id: string
          created_at?: string
          external_txn_id?: string | null
          id?: string
          payment_date?: string
          payment_method?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          claim_id?: string | null
          client_id?: string
          created_at?: string
          external_txn_id?: string | null
          id?: string
          payment_date?: string
          payment_method?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_payments_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_pcl5_assessments: {
        Row: {
          administered_at: string
          appointment_id: string | null
          assessment_date: string | null
          client_id: string
          clinical_notes: string | null
          clinician_name_snapshot: string | null
          cluster_arousal: number
          cluster_avoidance: number
          cluster_intrusion: number
          cluster_negative_alterations: number
          created_at: string
          event_description: string | null
          id: string
          meets_ptsd_cutoff: boolean
          q1: number
          q10: number
          q11: number
          q12: number
          q13: number
          q14: number
          q15: number
          q16: number
          q17: number
          q18: number
          q19: number
          q2: number
          q20: number
          q3: number
          q4: number
          q5: number
          q6: number
          q7: number
          q8: number
          q9: number
          staff_id: string | null
          tenant_id: string
          total_score: number
          updated_at: string
        }
        Insert: {
          administered_at?: string
          appointment_id?: string | null
          assessment_date?: string | null
          client_id: string
          clinical_notes?: string | null
          clinician_name_snapshot?: string | null
          cluster_arousal: number
          cluster_avoidance: number
          cluster_intrusion: number
          cluster_negative_alterations: number
          created_at?: string
          event_description?: string | null
          id?: string
          meets_ptsd_cutoff: boolean
          q1: number
          q10: number
          q11: number
          q12: number
          q13: number
          q14: number
          q15: number
          q16: number
          q17: number
          q18: number
          q19: number
          q2: number
          q20: number
          q3: number
          q4: number
          q5: number
          q6: number
          q7: number
          q8: number
          q9: number
          staff_id?: string | null
          tenant_id: string
          total_score: number
          updated_at?: string
        }
        Update: {
          administered_at?: string
          appointment_id?: string | null
          assessment_date?: string | null
          client_id?: string
          clinical_notes?: string | null
          clinician_name_snapshot?: string | null
          cluster_arousal?: number
          cluster_avoidance?: number
          cluster_intrusion?: number
          cluster_negative_alterations?: number
          created_at?: string
          event_description?: string | null
          id?: string
          meets_ptsd_cutoff?: boolean
          q1?: number
          q10?: number
          q11?: number
          q12?: number
          q13?: number
          q14?: number
          q15?: number
          q16?: number
          q17?: number
          q18?: number
          q19?: number
          q2?: number
          q20?: number
          q3?: number
          q4?: number
          q5?: number
          q6?: number
          q7?: number
          q8?: number
          q9?: number
          staff_id?: string | null
          tenant_id?: string
          total_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_pcl5_assessments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_pcl5_assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_pcl5_assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_pcl5_assessments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_pcl5_assessments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_phq9_assessments: {
        Row: {
          additional_notes: string | null
          administered_at: string
          ai_narrative: string | null
          ai_narrative_generated_at: string | null
          appointment_id: string | null
          assessment_date: string | null
          client_id: string
          clinician_name_snapshot: string | null
          created_at: string
          id: string
          q1: number
          q2: number
          q3: number
          q4: number
          q5: number
          q6: number
          q7: number
          q8: number
          q9: number
          severity: Database["public"]["Enums"]["phq9_severity_enum"]
          staff_id: string | null
          tenant_id: string
          total_score: number
          updated_at: string
        }
        Insert: {
          additional_notes?: string | null
          administered_at?: string
          ai_narrative?: string | null
          ai_narrative_generated_at?: string | null
          appointment_id?: string | null
          assessment_date?: string | null
          client_id: string
          clinician_name_snapshot?: string | null
          created_at?: string
          id?: string
          q1: number
          q2: number
          q3: number
          q4: number
          q5: number
          q6: number
          q7: number
          q8: number
          q9: number
          severity: Database["public"]["Enums"]["phq9_severity_enum"]
          staff_id?: string | null
          tenant_id: string
          total_score: number
          updated_at?: string
        }
        Update: {
          additional_notes?: string | null
          administered_at?: string
          ai_narrative?: string | null
          ai_narrative_generated_at?: string | null
          appointment_id?: string | null
          assessment_date?: string | null
          client_id?: string
          clinician_name_snapshot?: string | null
          created_at?: string
          id?: string
          q1?: number
          q2?: number
          q3?: number
          q4?: number
          q5?: number
          q6?: number
          q7?: number
          q8?: number
          q9?: number
          severity?: Database["public"]["Enums"]["phq9_severity_enum"]
          staff_id?: string | null
          tenant_id?: string
          total_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_phq9_assessments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_phq9_assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_phq9_assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_phq9_assessments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_phq9_assessments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_provider_demand: {
        Row: {
          client_age: number | null
          client_id: string
          client_state: Database["public"]["Enums"]["state_code_enum"] | null
          created_at: string
          id: string
          last_evaluated_at: string
          last_evaluation_source: string | null
          last_option_count: number
          opened_at: string
          pathway_code: string
          provider_fit_context: Json
          reason_code: string
          release_notification_state: string
          release_notified_at: string | null
          resolution_reason: string | null
          resolved_at: string | null
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          client_age?: number | null
          client_id: string
          client_state?: Database["public"]["Enums"]["state_code_enum"] | null
          created_at?: string
          id?: string
          last_evaluated_at?: string
          last_evaluation_source?: string | null
          last_option_count?: number
          opened_at?: string
          pathway_code: string
          provider_fit_context?: Json
          reason_code?: string
          release_notification_state?: string
          release_notified_at?: string | null
          resolution_reason?: string | null
          resolved_at?: string | null
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          client_age?: number | null
          client_id?: string
          client_state?: Database["public"]["Enums"]["state_code_enum"] | null
          created_at?: string
          id?: string
          last_evaluated_at?: string
          last_evaluation_source?: string | null
          last_option_count?: number
          opened_at?: string
          pathway_code?: string
          provider_fit_context?: Json
          reason_code?: string
          release_notification_state?: string
          release_notified_at?: string | null
          resolution_reason?: string | null
          resolved_at?: string | null
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_provider_demand_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_provider_demand_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_provider_demand_reevaluation_queue: {
        Row: {
          attempts: number
          available_at: string
          client_id: string | null
          client_state: Database["public"]["Enums"]["state_code_enum"] | null
          created_at: string
          dedupe_key: string
          enqueued_at: string
          id: string
          last_error: string | null
          locked_at: string | null
          pathway_code: string | null
          payload: Json
          processed_at: string | null
          reason_code: string
          scope_type: string
          staff_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          client_id?: string | null
          client_state?: Database["public"]["Enums"]["state_code_enum"] | null
          created_at?: string
          dedupe_key: string
          enqueued_at?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          pathway_code?: string | null
          payload?: Json
          processed_at?: string | null
          reason_code: string
          scope_type: string
          staff_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          client_id?: string | null
          client_state?: Database["public"]["Enums"]["state_code_enum"] | null
          created_at?: string
          dedupe_key?: string
          enqueued_at?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          pathway_code?: string | null
          payload?: Json
          processed_at?: string | null
          reason_code?: string
          scope_type?: string
          staff_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_provider_demand_reevaluation_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_provider_demand_reevaluation_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_provider_demand_reevaluation_queue_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      client_provider_demand_release_notifications: {
        Row: {
          attempts: number
          available_at: string
          client_id: string
          created_at: string
          demand_id: string
          dispatched_at: string | null
          id: string
          last_error: string | null
          sent_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          client_id: string
          created_at?: string
          demand_id: string
          dispatched_at?: string | null
          id?: string
          last_error?: string | null
          sent_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          client_id?: string
          created_at?: string
          demand_id?: string
          dispatched_at?: string | null
          id?: string
          last_error?: string | null
          sent_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_provider_demand_release_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_provider_demand_release_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_provider_demand_release_notifications_demand_id_fkey"
            columns: ["demand_id"]
            isOneToOne: true
            referencedRelation: "client_provider_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_provider_demand_release_notifications_demand_id_fkey"
            columns: ["demand_id"]
            isOneToOne: true
            referencedRelation: "client_provider_demand_operations_v"
            referencedColumns: ["demand_id"]
          },
        ]
      }
      client_qualifying_sessions: {
        Row: {
          appointment_id: string
          client_id: string
          created_at: string
          disqualification_reason: string | null
          documented_at: string
          id: string
          ordinal_for_client: number | null
          qualification_version: number
          qualifies: boolean
          source: string
          source_event_key: string | null
          staff_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          client_id: string
          created_at?: string
          disqualification_reason?: string | null
          documented_at: string
          id?: string
          ordinal_for_client?: number | null
          qualification_version?: number
          qualifies?: boolean
          source: string
          source_event_key?: string | null
          staff_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          client_id?: string
          created_at?: string
          disqualification_reason?: string | null
          documented_at?: string
          id?: string
          ordinal_for_client?: number | null
          qualification_version?: number
          qualifies?: boolean
          source?: string
          source_event_key?: string | null
          staff_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_qualifying_sessions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_qualifying_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_qualifying_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_qualifying_sessions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_qualifying_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_related_persons: {
        Row: {
          addr_1: string | null
          addr_2: string | null
          city: string | null
          client_id: string
          created_at: string
          email: string | null
          first_name: string
          id: string
          is_form_submitter: boolean
          last_name: string
          phone: string | null
          relationship: Database["public"]["Enums"]["client_relation_type_enum"]
          state: Database["public"]["Enums"]["state_code_enum"] | null
          tenant_id: string
          updated_at: string
          zip: string | null
        }
        Insert: {
          addr_1?: string | null
          addr_2?: string | null
          city?: string | null
          client_id: string
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          is_form_submitter?: boolean
          last_name: string
          phone?: string | null
          relationship: Database["public"]["Enums"]["client_relation_type_enum"]
          state?: Database["public"]["Enums"]["state_code_enum"] | null
          tenant_id: string
          updated_at?: string
          zip?: string | null
        }
        Update: {
          addr_1?: string | null
          addr_2?: string | null
          city?: string | null
          client_id?: string
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          is_form_submitter?: boolean
          last_name?: string
          phone?: string | null
          relationship?: Database["public"]["Enums"]["client_relation_type_enum"]
          state?: Database["public"]["Enums"]["state_code_enum"] | null
          tenant_id?: string
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_related_persons_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_related_persons_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_safety_plans: {
        Row: {
          client_id: string
          created_at: string
          created_by_profile_id: string
          crisis_steps: string | null
          deactivated_at: string | null
          id: string
          internal_coping: string | null
          is_active: boolean
          plan_title: string | null
          plan_version: number
          professional_contacts: string | null
          reasons_for_living: string | null
          restricting_access: string | null
          social_supports: string | null
          tenant_id: string
          updated_at: string
          warning_signs: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by_profile_id: string
          crisis_steps?: string | null
          deactivated_at?: string | null
          id?: string
          internal_coping?: string | null
          is_active?: boolean
          plan_title?: string | null
          plan_version?: number
          professional_contacts?: string | null
          reasons_for_living?: string | null
          restricting_access?: string | null
          social_supports?: string | null
          tenant_id: string
          updated_at?: string
          warning_signs?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by_profile_id?: string
          crisis_steps?: string | null
          deactivated_at?: string | null
          id?: string
          internal_coping?: string | null
          is_active?: boolean
          plan_title?: string | null
          plan_version?: number
          professional_contacts?: string | null
          reasons_for_living?: string | null
          restricting_access?: string | null
          social_supports?: string | null
          tenant_id?: string
          updated_at?: string
          warning_signs?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_safety_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_safety_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_safety_plans_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_safety_plans_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_safety_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_staff_relationships: {
        Row: {
          client_id: string
          created_at: string
          end_reason: string | null
          ended_at: string | null
          first_scheduled_appointment_id: string | null
          id: string
          relationship_type: string
          scheduling_branch: string | null
          scheduling_expected_by: string | null
          scheduling_moved_at: string | null
          source: string
          staff_id: string
          started_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          first_scheduled_appointment_id?: string | null
          id?: string
          relationship_type?: string
          scheduling_branch?: string | null
          scheduling_expected_by?: string | null
          scheduling_moved_at?: string | null
          source: string
          staff_id: string
          started_at?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          first_scheduled_appointment_id?: string | null
          id?: string
          relationship_type?: string
          scheduling_branch?: string | null
          scheduling_expected_by?: string | null
          scheduling_moved_at?: string | null
          source?: string
          staff_id?: string
          started_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_staff_relationship_first_appointment_fkey"
            columns: ["first_scheduled_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_staff_relationships_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_staff_relationships_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_staff_relationships_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      client_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          client_id: string
          created_at: string
          id: string
          new_status: string | null
          old_status: string | null
          reason: string | null
          source: string
          state_dimension: Database["public"]["Enums"]["client_state_dimension_enum"]
          tenant_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          client_id: string
          created_at?: string
          id?: string
          new_status?: string | null
          old_status?: string | null
          reason?: string | null
          source?: string
          state_dimension?: Database["public"]["Enums"]["client_state_dimension_enum"]
          tenant_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          client_id?: string
          created_at?: string
          id?: string
          new_status?: string | null
          old_status?: string | null
          reason?: string | null
          source?: string
          state_dimension?: Database["public"]["Enums"]["client_state_dimension_enum"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_status_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_status_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_telehealth_consents: {
        Row: {
          client_id: string
          consent_template_key: string
          consent_template_version: string
          created_at: string
          document_id: string | null
          document_storage_path: string | null
          id: string
          is_revoked: boolean
          revoked_at: string | null
          signature_date: string
          signature_text: string
          signed_at: string
          signed_by_profile_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          consent_template_key?: string
          consent_template_version?: string
          created_at?: string
          document_id?: string | null
          document_storage_path?: string | null
          id?: string
          is_revoked?: boolean
          revoked_at?: string | null
          signature_date: string
          signature_text: string
          signed_at?: string
          signed_by_profile_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          consent_template_key?: string
          consent_template_version?: string
          created_at?: string
          document_id?: string | null
          document_storage_path?: string | null
          id?: string
          is_revoked?: boolean
          revoked_at?: string | null
          signature_date?: string
          signature_text?: string
          signed_at?: string
          signed_by_profile_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_telehealth_consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_telehealth_consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_telehealth_consents_signed_by_profile_id_fkey"
            columns: ["signed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_telehealth_consents_signed_by_profile_id_fkey"
            columns: ["signed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_telehealth_consents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_treatment_plans: {
        Row: {
          client_id: string
          created_at: string
          created_by_profile_id: string
          id: string
          intervention1: string | null
          intervention2: string | null
          intervention3: string | null
          intervention4: string | null
          intervention5: string | null
          intervention6: string | null
          is_active: boolean
          next_treatmentplan_update: string | null
          plan_narrative: string | null
          plan_version: number
          planlength: string | null
          primaryobjective: string | null
          problem: string | null
          secondaryobjective: string | null
          staff_id: string
          supersedes_plan_id: string | null
          tenant_id: string
          tertiaryobjective: string | null
          treatmentfrequency: string | null
          treatmentgoal: string | null
          treatmentplan_startdate: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by_profile_id: string
          id?: string
          intervention1?: string | null
          intervention2?: string | null
          intervention3?: string | null
          intervention4?: string | null
          intervention5?: string | null
          intervention6?: string | null
          is_active?: boolean
          next_treatmentplan_update?: string | null
          plan_narrative?: string | null
          plan_version?: number
          planlength?: string | null
          primaryobjective?: string | null
          problem?: string | null
          secondaryobjective?: string | null
          staff_id: string
          supersedes_plan_id?: string | null
          tenant_id: string
          tertiaryobjective?: string | null
          treatmentfrequency?: string | null
          treatmentgoal?: string | null
          treatmentplan_startdate?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by_profile_id?: string
          id?: string
          intervention1?: string | null
          intervention2?: string | null
          intervention3?: string | null
          intervention4?: string | null
          intervention5?: string | null
          intervention6?: string | null
          is_active?: boolean
          next_treatmentplan_update?: string | null
          plan_narrative?: string | null
          plan_version?: number
          planlength?: string | null
          primaryobjective?: string | null
          problem?: string | null
          secondaryobjective?: string | null
          staff_id?: string
          supersedes_plan_id?: string | null
          tenant_id?: string
          tertiaryobjective?: string | null
          treatmentfrequency?: string | null
          treatmentgoal?: string | null
          treatmentplan_startdate?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_treatment_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_treatment_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_treatment_plans_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_treatment_plans_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_treatment_plans_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_treatment_plans_supersedes_plan_id_fkey"
            columns: ["supersedes_plan_id"]
            isOneToOne: false
            referencedRelation: "client_treatment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_treatment_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          at_risk: boolean
          at_risk_anchor_at: string | null
          at_risk_since: string | null
          care_cadence: Database["public"]["Enums"]["client_care_cadence_enum"]
          care_cadence_changed_at: string
          clickup_synced_at: string | null
          clickup_task_id: string | null
          closed_at: string | null
          closure_reason:
            | Database["public"]["Enums"]["client_closure_reason_enum"]
            | null
          contact_policy: Database["public"]["Enums"]["client_contact_policy_enum"]
          contact_policy_changed_at: string
          contract_version: number
          created_at: string
          eligibility_state: Database["public"]["Enums"]["client_eligibility_state_enum"]
          eligibility_state_changed_at: string
          email: string | null
          engagement_state: Database["public"]["Enums"]["client_engagement_state_enum"]
          engagement_state_changed_at: string
          id: string
          last_contact_at: string | null
          last_contact_channel: string | null
          last_contact_direction: string | null
          lifecycle_stage: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
          lifecycle_stage_changed_at: string
          pat_addr_1: string | null
          pat_addr_2: string | null
          pat_age: number | null
          pat_city: string | null
          pat_country: string
          pat_dob: string | null
          pat_gender_identity:
            | Database["public"]["Enums"]["gender_identity_enum"]
            | null
          pat_goal: string | null
          pat_marital_status: string | null
          pat_name_f: string | null
          pat_name_l: string | null
          pat_name_m: string | null
          pat_name_preferred: string | null
          pat_sex: Database["public"]["Enums"]["sex_enum"] | null
          pat_ssn: string | null
          pat_state: Database["public"]["Enums"]["state_code_enum"] | null
          pat_status: Database["public"]["Enums"]["pat_status_enum"] | null
          pat_time_zone: Database["public"]["Enums"]["time_zones"] | null
          pat_zip: string | null
          phone: string | null
          primary_staff_id: string | null
          profile_id: string
          referral_source: string | null
          service_policy: Database["public"]["Enums"]["client_service_policy_enum"]
          service_policy_changed_at: string
          status_changed_at: string | null
          tags: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          at_risk?: boolean
          at_risk_anchor_at?: string | null
          at_risk_since?: string | null
          care_cadence?: Database["public"]["Enums"]["client_care_cadence_enum"]
          care_cadence_changed_at?: string
          clickup_synced_at?: string | null
          clickup_task_id?: string | null
          closed_at?: string | null
          closure_reason?:
            | Database["public"]["Enums"]["client_closure_reason_enum"]
            | null
          contact_policy?: Database["public"]["Enums"]["client_contact_policy_enum"]
          contact_policy_changed_at?: string
          contract_version?: number
          created_at?: string
          eligibility_state?: Database["public"]["Enums"]["client_eligibility_state_enum"]
          eligibility_state_changed_at?: string
          email?: string | null
          engagement_state?: Database["public"]["Enums"]["client_engagement_state_enum"]
          engagement_state_changed_at?: string
          id?: string
          last_contact_at?: string | null
          last_contact_channel?: string | null
          last_contact_direction?: string | null
          lifecycle_stage?: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
          lifecycle_stage_changed_at?: string
          pat_addr_1?: string | null
          pat_addr_2?: string | null
          pat_age?: number | null
          pat_city?: string | null
          pat_country?: string
          pat_dob?: string | null
          pat_gender_identity?:
            | Database["public"]["Enums"]["gender_identity_enum"]
            | null
          pat_goal?: string | null
          pat_marital_status?: string | null
          pat_name_f?: string | null
          pat_name_l?: string | null
          pat_name_m?: string | null
          pat_name_preferred?: string | null
          pat_sex?: Database["public"]["Enums"]["sex_enum"] | null
          pat_ssn?: string | null
          pat_state?: Database["public"]["Enums"]["state_code_enum"] | null
          pat_status?: Database["public"]["Enums"]["pat_status_enum"] | null
          pat_time_zone?: Database["public"]["Enums"]["time_zones"] | null
          pat_zip?: string | null
          phone?: string | null
          primary_staff_id?: string | null
          profile_id: string
          referral_source?: string | null
          service_policy?: Database["public"]["Enums"]["client_service_policy_enum"]
          service_policy_changed_at?: string
          status_changed_at?: string | null
          tags?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          at_risk?: boolean
          at_risk_anchor_at?: string | null
          at_risk_since?: string | null
          care_cadence?: Database["public"]["Enums"]["client_care_cadence_enum"]
          care_cadence_changed_at?: string
          clickup_synced_at?: string | null
          clickup_task_id?: string | null
          closed_at?: string | null
          closure_reason?:
            | Database["public"]["Enums"]["client_closure_reason_enum"]
            | null
          contact_policy?: Database["public"]["Enums"]["client_contact_policy_enum"]
          contact_policy_changed_at?: string
          contract_version?: number
          created_at?: string
          eligibility_state?: Database["public"]["Enums"]["client_eligibility_state_enum"]
          eligibility_state_changed_at?: string
          email?: string | null
          engagement_state?: Database["public"]["Enums"]["client_engagement_state_enum"]
          engagement_state_changed_at?: string
          id?: string
          last_contact_at?: string | null
          last_contact_channel?: string | null
          last_contact_direction?: string | null
          lifecycle_stage?: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
          lifecycle_stage_changed_at?: string
          pat_addr_1?: string | null
          pat_addr_2?: string | null
          pat_age?: number | null
          pat_city?: string | null
          pat_country?: string
          pat_dob?: string | null
          pat_gender_identity?:
            | Database["public"]["Enums"]["gender_identity_enum"]
            | null
          pat_goal?: string | null
          pat_marital_status?: string | null
          pat_name_f?: string | null
          pat_name_l?: string | null
          pat_name_m?: string | null
          pat_name_preferred?: string | null
          pat_sex?: Database["public"]["Enums"]["sex_enum"] | null
          pat_ssn?: string | null
          pat_state?: Database["public"]["Enums"]["state_code_enum"] | null
          pat_status?: Database["public"]["Enums"]["pat_status_enum"] | null
          pat_time_zone?: Database["public"]["Enums"]["time_zones"] | null
          pat_zip?: string | null
          phone?: string | null
          primary_staff_id?: string | null
          profile_id?: string
          referral_source?: string | null
          service_policy?: Database["public"]["Enums"]["client_service_policy_enum"]
          service_policy_changed_at?: string
          status_changed_at?: string | null
          tags?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_primary_staff_id_fkey"
            columns: ["primary_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "clients_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cliniclevel_license_types: {
        Row: {
          id: string
          license_code: string
          license_label: string
          specialty: string | null
        }
        Insert: {
          id?: string
          license_code: string
          license_label: string
          specialty?: string | null
        }
        Update: {
          id?: string
          license_code?: string
          license_label?: string
          specialty?: string | null
        }
        Relationships: []
      }
      consent_templates: {
        Row: {
          consent_type: string
          content: Json
          created_at: string
          created_by_profile_id: string | null
          id: string
          is_active: boolean
          is_required: boolean | null
          required_for: string | null
          tenant_id: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          consent_type: string
          content: Json
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          is_active?: boolean
          is_required?: boolean | null
          required_for?: string | null
          tenant_id?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          consent_type?: string
          content?: Json
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          is_active?: boolean
          is_required?: boolean | null
          required_for?: string | null
          tenant_id?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "consent_templates_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "consent_templates_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_action_requests: {
        Row: {
          actor_profile_id: string | null
          client_action_id: string
          created_at: string
          error_code: string | null
          id: string
          operation: string
          request_hash: string
          result: Json | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          actor_profile_id?: string | null
          client_action_id: string
          created_at?: string
          error_code?: string | null
          id?: string
          operation: string
          request_hash: string
          result?: Json | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          actor_profile_id?: string | null
          client_action_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          operation?: string
          request_hash?: string
          result?: Json | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_action_requests_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "contract_action_requests_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_action_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cpt_codes: {
        Row: {
          category: string | null
          code: string
          created_at: string
          description: string
          id: string
          is_active: boolean
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          description: string
          id?: string
          is_active?: boolean
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
        }
        Relationships: []
      }
      crm_activity_events: {
        Row: {
          client_id: string
          created_at: string
          created_by_profile_id: string | null
          event_type: string
          id: string
          metadata: Json | null
          new_value: string | null
          old_value: string | null
          tenant_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by_profile_id?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          tenant_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by_profile_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activity_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activity_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_activity_events_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "crm_activity_events_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activity_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_bulk_send_logs: {
        Row: {
          body_html: string
          completed_at: string | null
          created_at: string
          created_by_profile_id: string
          failed_count: number
          heartbeat_at: string | null
          id: string
          recipient_count: number
          recipient_type: string
          sent_count: number
          status: string
          subject: string
          template_id: string | null
          tenant_id: string
        }
        Insert: {
          body_html: string
          completed_at?: string | null
          created_at?: string
          created_by_profile_id: string
          failed_count?: number
          heartbeat_at?: string | null
          id?: string
          recipient_count?: number
          recipient_type?: string
          sent_count?: number
          status?: string
          subject: string
          template_id?: string | null
          tenant_id: string
        }
        Update: {
          body_html?: string
          completed_at?: string | null
          created_at?: string
          created_by_profile_id?: string
          failed_count?: number
          heartbeat_at?: string | null
          id?: string
          recipient_count?: number
          recipient_type?: string
          sent_count?: number
          status?: string
          subject?: string
          template_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_bulk_send_logs_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "crm_bulk_send_logs_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_bulk_send_logs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "crm_email_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_bulk_send_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_bulk_send_recipients: {
        Row: {
          bulk_send_id: string
          client_id: string
          error_message: string | null
          id: string
          sent_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          bulk_send_id: string
          client_id: string
          error_message?: string | null
          id?: string
          sent_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          bulk_send_id?: string
          client_id?: string
          error_message?: string | null
          id?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_bulk_send_recipients_bulk_send_id_fkey"
            columns: ["bulk_send_id"]
            isOneToOne: false
            referencedRelation: "crm_bulk_send_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_bulk_send_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_bulk_send_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_bulk_send_recipients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_bulk_send_staff_recipients: {
        Row: {
          bulk_send_id: string
          created_at: string | null
          error_message: string | null
          id: string
          sent_at: string | null
          staff_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          bulk_send_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          sent_at?: string | null
          staff_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          bulk_send_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          sent_at?: string | null
          staff_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_bulk_send_staff_recipients_bulk_send_id_fkey"
            columns: ["bulk_send_id"]
            isOneToOne: false
            referencedRelation: "crm_bulk_send_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_bulk_send_staff_recipients_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_bulk_send_staff_recipients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_bulk_sms_logs: {
        Row: {
          body_text: string
          completed_at: string | null
          created_at: string
          created_by_profile_id: string
          failed_count: number
          heartbeat_at: string | null
          id: string
          recipient_count: number
          recipient_type: string
          sent_count: number
          status: string
          tenant_id: string
        }
        Insert: {
          body_text: string
          completed_at?: string | null
          created_at?: string
          created_by_profile_id: string
          failed_count?: number
          heartbeat_at?: string | null
          id?: string
          recipient_count?: number
          recipient_type?: string
          sent_count?: number
          status?: string
          tenant_id: string
        }
        Update: {
          body_text?: string
          completed_at?: string | null
          created_at?: string
          created_by_profile_id?: string
          failed_count?: number
          heartbeat_at?: string | null
          id?: string
          recipient_count?: number
          recipient_type?: string
          sent_count?: number
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_bulk_sms_logs_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "crm_bulk_sms_logs_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_bulk_sms_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_bulk_sms_recipients: {
        Row: {
          bulk_sms_id: string
          client_id: string
          created_at: string
          error_message: string | null
          id: string
          sent_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          bulk_sms_id: string
          client_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          sent_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          bulk_sms_id?: string
          client_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_bulk_sms_recipients_bulk_sms_id_fkey"
            columns: ["bulk_sms_id"]
            isOneToOne: false
            referencedRelation: "crm_bulk_sms_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_bulk_sms_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_bulk_sms_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_bulk_sms_recipients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_bulk_sms_staff_recipients: {
        Row: {
          bulk_sms_id: string
          created_at: string
          error_message: string | null
          id: string
          sent_at: string | null
          staff_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          bulk_sms_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          sent_at?: string | null
          staff_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          bulk_sms_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          sent_at?: string | null
          staff_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_bulk_sms_staff_recipients_bulk_sms_id_fkey"
            columns: ["bulk_sms_id"]
            isOneToOne: false
            referencedRelation: "crm_bulk_sms_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_bulk_sms_staff_recipients_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_bulk_sms_staff_recipients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaign_enrollments: {
        Row: {
          campaign_id: string
          client_id: string
          completed_at: string | null
          created_at: string
          current_step: number
          enrolled_at: string
          enrolled_by_profile_id: string | null
          id: string
          pause_reason: string | null
          paused_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          client_id: string
          completed_at?: string | null
          created_at?: string
          current_step?: number
          enrolled_at?: string
          enrolled_by_profile_id?: string | null
          id?: string
          pause_reason?: string | null
          paused_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          client_id?: string
          completed_at?: string | null
          created_at?: string
          current_step?: number
          enrolled_at?: string
          enrolled_by_profile_id?: string | null
          id?: string
          pause_reason?: string | null
          paused_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaign_enrollments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_enrollments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_enrollments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_campaign_enrollments_enrolled_by_profile_id_fkey"
            columns: ["enrolled_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "crm_campaign_enrollments_enrolled_by_profile_id_fkey"
            columns: ["enrolled_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_enrollments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaign_step_logs: {
        Row: {
          channel: string
          claim_attempts: number
          claim_token: string | null
          claimed_at: string | null
          client_id: string
          created_at: string
          enrollment_id: string
          error_message: string | null
          helpscout_conversation_id: string | null
          id: string
          scheduled_for: string
          sent_at: string | null
          skip_reason: string | null
          status: string
          step_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          channel: string
          claim_attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          client_id: string
          created_at?: string
          enrollment_id: string
          error_message?: string | null
          helpscout_conversation_id?: string | null
          id?: string
          scheduled_for: string
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          step_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          channel?: string
          claim_attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          client_id?: string
          created_at?: string
          enrollment_id?: string
          error_message?: string | null
          helpscout_conversation_id?: string | null
          id?: string
          scheduled_for?: string
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          step_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaign_step_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_step_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_campaign_step_logs_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "crm_campaign_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_step_logs_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "crm_campaign_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_step_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaign_steps: {
        Row: {
          campaign_id: string
          channel: string
          created_at: string
          delay_days: number
          delay_hours: number
          email_body_html: string | null
          email_subject: string | null
          id: string
          is_active: boolean
          signature_id: string | null
          sms_body_text: string | null
          step_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          channel: string
          created_at?: string
          delay_days?: number
          delay_hours?: number
          email_body_html?: string | null
          email_subject?: string | null
          id?: string
          is_active?: boolean
          signature_id?: string | null
          sms_body_text?: string | null
          step_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          channel?: string
          created_at?: string
          delay_days?: number
          delay_hours?: number
          email_body_html?: string | null
          email_subject?: string | null
          id?: string
          is_active?: boolean
          signature_id?: string | null
          sms_body_text?: string | null
          step_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaign_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_steps_signature_id_fkey"
            columns: ["signature_id"]
            isOneToOne: false
            referencedRelation: "crm_email_signatures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaign_triggers: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          is_active: boolean
          is_manual_only: boolean
          tenant_id: string
          trigger_dimension: string | null
          trigger_event: string | null
          trigger_on_status: string
          trigger_operator: string
          trigger_value: string | null
          trigger_version: number
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_manual_only?: boolean
          tenant_id: string
          trigger_dimension?: string | null
          trigger_event?: string | null
          trigger_on_status: string
          trigger_operator?: string
          trigger_value?: string | null
          trigger_version?: number
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_manual_only?: boolean
          tenant_id?: string
          trigger_dimension?: string | null
          trigger_event?: string | null
          trigger_on_status?: string
          trigger_operator?: string
          trigger_value?: string | null
          trigger_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaign_triggers_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "crm_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaigns: {
        Row: {
          created_at: string
          created_by_profile_id: string | null
          default_timezone: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          on_complete_action: string
          on_complete_status: string | null
          send_window_end: string
          send_window_start: string
          tenant_id: string
          updated_at: string
          weekdays_only: boolean
        }
        Insert: {
          created_at?: string
          created_by_profile_id?: string | null
          default_timezone?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          on_complete_action?: string
          on_complete_status?: string | null
          send_window_end?: string
          send_window_start?: string
          tenant_id: string
          updated_at?: string
          weekdays_only?: boolean
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string | null
          default_timezone?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          on_complete_action?: string
          on_complete_status?: string | null
          send_window_end?: string
          send_window_start?: string
          tenant_id?: string
          updated_at?: string
          weekdays_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaigns_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "crm_campaigns_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_clickup_field_map: {
        Row: {
          created_at: string
          field_id: string
          field_name: string
          field_type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          field_id: string
          field_name: string
          field_type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          field_id?: string
          field_name?: string
          field_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      crm_clickup_sync_runs: {
        Row: {
          created_at: string
          created_count: number
          failed_count: number
          finished_at: string | null
          id: string
          last_error: string | null
          options: Json
          processed: number
          recreated_count: number
          skipped_count: number
          started_at: string
          status: string
          tenant_id: string | null
          total: number
          triggered_by: string | null
          updated_at: string
          updated_count: number
        }
        Insert: {
          created_at?: string
          created_count?: number
          failed_count?: number
          finished_at?: string | null
          id?: string
          last_error?: string | null
          options?: Json
          processed?: number
          recreated_count?: number
          skipped_count?: number
          started_at?: string
          status?: string
          tenant_id?: string | null
          total?: number
          triggered_by?: string | null
          updated_at?: string
          updated_count?: number
        }
        Update: {
          created_at?: string
          created_count?: number
          failed_count?: number
          finished_at?: string | null
          id?: string
          last_error?: string | null
          options?: Json
          processed?: number
          recreated_count?: number
          skipped_count?: number
          started_at?: string
          status?: string
          tenant_id?: string | null
          total?: number
          triggered_by?: string | null
          updated_at?: string
          updated_count?: number
        }
        Relationships: []
      }
      crm_client_canonical_meta: {
        Row: {
          at_risk_marked_at: string | null
          client_id: string
          concurrency_token: string
          created_at: string
          risk_reason: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          at_risk_marked_at?: string | null
          client_id: string
          concurrency_token?: string
          created_at?: string
          risk_reason?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          at_risk_marked_at?: string | null
          client_id?: string
          concurrency_token?: string
          created_at?: string
          risk_reason?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_canonical_meta_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_client_canonical_meta_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
        ]
      }
      crm_client_state_audit: {
        Row: {
          actor_label: string | null
          actor_profile_id: string | null
          client_id: string
          correlation_id: string | null
          created_at: string
          dimension: Database["public"]["Enums"]["client_state_dimension_enum"]
          disposition_reason: string | null
          from_value: string | null
          id: string
          reason: string | null
          source: string
          tenant_id: string
          to_value: string | null
        }
        Insert: {
          actor_label?: string | null
          actor_profile_id?: string | null
          client_id: string
          correlation_id?: string | null
          created_at?: string
          dimension: Database["public"]["Enums"]["client_state_dimension_enum"]
          disposition_reason?: string | null
          from_value?: string | null
          id?: string
          reason?: string | null
          source?: string
          tenant_id: string
          to_value?: string | null
        }
        Update: {
          actor_label?: string | null
          actor_profile_id?: string | null
          client_id?: string
          correlation_id?: string | null
          created_at?: string
          dimension?: Database["public"]["Enums"]["client_state_dimension_enum"]
          disposition_reason?: string | null
          from_value?: string | null
          id?: string
          reason?: string | null
          source?: string
          tenant_id?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_client_state_audit_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_client_state_audit_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
        ]
      }
      crm_conversation_cache: {
        Row: {
          cached_at: string
          customer_email: string | null
          customer_name: string | null
          helpscout_conversation_id: string
          id: string
          last_thread_at: string | null
          needs_reply: boolean | null
          preview_text: string | null
          status: string | null
          subject: string | null
          tenant_id: string
        }
        Insert: {
          cached_at?: string
          customer_email?: string | null
          customer_name?: string | null
          helpscout_conversation_id: string
          id?: string
          last_thread_at?: string | null
          needs_reply?: boolean | null
          preview_text?: string | null
          status?: string | null
          subject?: string | null
          tenant_id: string
        }
        Update: {
          cached_at?: string
          customer_email?: string | null
          customer_name?: string | null
          helpscout_conversation_id?: string
          id?: string
          last_thread_at?: string | null
          needs_reply?: boolean | null
          preview_text?: string | null
          status?: string | null
          subject?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_conversation_cache_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_conversation_links: {
        Row: {
          client_id: string
          created_at: string
          helpscout_conversation_id: string
          id: string
          link_type: string
          linked_at: string
          linked_by_profile_id: string | null
          tenant_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          helpscout_conversation_id: string
          id?: string
          link_type?: string
          linked_at?: string
          linked_by_profile_id?: string | null
          tenant_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          helpscout_conversation_id?: string
          id?: string
          link_type?: string
          linked_at?: string
          linked_by_profile_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_conversation_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversation_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_conversation_links_linked_by_profile_id_fkey"
            columns: ["linked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "crm_conversation_links_linked_by_profile_id_fkey"
            columns: ["linked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversation_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_eligibility_manual_reviews: {
        Row: {
          active: boolean
          client_id: string
          closed_at: string | null
          created_at: string
          next_action: string
          owner: string
          reason: string | null
          review_due_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          client_id: string
          closed_at?: string | null
          created_at?: string
          next_action: string
          owner: string
          reason?: string | null
          review_due_at: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          client_id?: string
          closed_at?: string | null
          created_at?: string
          next_action?: string
          owner?: string
          reason?: string | null
          review_due_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_eligibility_manual_reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_eligibility_manual_reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_eligibility_manual_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_email_signatures: {
        Row: {
          body_html: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          image_url: string | null
          is_default: boolean
          name: string
          signature_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          body_html?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          image_url?: string | null
          is_default?: boolean
          name: string
          signature_type: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          body_html?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          image_url?: string | null
          is_default?: boolean
          name?: string
          signature_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_email_signatures_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "crm_email_signatures_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_email_signatures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_email_templates: {
        Row: {
          body_html: string
          created_at: string
          created_by_profile_id: string
          id: string
          is_active: boolean
          name: string
          subject: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          body_html: string
          created_at?: string
          created_by_profile_id: string
          id?: string
          is_active?: boolean
          name: string
          subject: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          created_at?: string
          created_by_profile_id?: string
          id?: string
          is_active?: boolean
          name?: string
          subject?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_email_templates_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "crm_email_templates_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_email_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_exceptions: {
        Row: {
          campaign_id: string | null
          client_id: string | null
          created_at: string
          due_at: string | null
          id: string
          last_activity_at: string
          owner_id: string | null
          recommended_resolution: string | null
          resolution_history: Json
          severity: Database["public"]["Enums"]["crm_exception_severity_enum"]
          status: Database["public"]["Enums"]["crm_exception_status_enum"]
          summary: string
          tenant_id: string
          type: Database["public"]["Enums"]["crm_exception_type_enum"]
          updated_at: string
          workflow: string | null
        }
        Insert: {
          campaign_id?: string | null
          client_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          last_activity_at?: string
          owner_id?: string | null
          recommended_resolution?: string | null
          resolution_history?: Json
          severity?: Database["public"]["Enums"]["crm_exception_severity_enum"]
          status?: Database["public"]["Enums"]["crm_exception_status_enum"]
          summary: string
          tenant_id: string
          type: Database["public"]["Enums"]["crm_exception_type_enum"]
          updated_at?: string
          workflow?: string | null
        }
        Update: {
          campaign_id?: string | null
          client_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          last_activity_at?: string
          owner_id?: string | null
          recommended_resolution?: string | null
          resolution_history?: Json
          severity?: Database["public"]["Enums"]["crm_exception_severity_enum"]
          status?: Database["public"]["Enums"]["crm_exception_status_enum"]
          summary?: string
          tenant_id?: string
          type?: Database["public"]["Enums"]["crm_exception_type_enum"]
          updated_at?: string
          workflow?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_exceptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_exceptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
        ]
      }
      crm_helpscout_settings: {
        Row: {
          connection_status: string
          created_at: string
          from_email: string | null
          from_name: string | null
          id: string
          last_sync_at: string | null
          mailbox_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          connection_status?: string
          created_at?: string
          from_email?: string | null
          from_name?: string | null
          id?: string
          last_sync_at?: string | null
          mailbox_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          connection_status?: string
          created_at?: string
          from_email?: string | null
          from_name?: string | null
          id?: string
          last_sync_at?: string | null
          mailbox_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_helpscout_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_idempotency_keys: {
        Row: {
          action_key: string | null
          actor_id: string | null
          created_at: string
          expires_at: string
          key: string
          operation: string
          result_json: Json | null
          status: string
          target_id: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          action_key?: string | null
          actor_id?: string | null
          created_at?: string
          expires_at?: string
          key: string
          operation: string
          result_json?: Json | null
          status?: string
          target_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          action_key?: string | null
          actor_id?: string | null
          created_at?: string
          expires_at?: string
          key?: string
          operation?: string
          result_json?: Json | null
          status?: string
          target_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      crm_inbound_sms_logs: {
        Row: {
          client_id: string | null
          created_at: string
          from_phone: string
          id: string
          is_read: boolean
          message_body: string | null
          received_at: string
          ringcentral_message_id: string | null
          tenant_id: string | null
          to_phone: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          from_phone: string
          id?: string
          is_read?: boolean
          message_body?: string | null
          received_at?: string
          ringcentral_message_id?: string | null
          tenant_id?: string | null
          to_phone: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          from_phone?: string
          id?: string
          is_read?: boolean
          message_body?: string | null
          received_at?: string
          ringcentral_message_id?: string | null
          tenant_id?: string | null
          to_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_inbound_sms_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_inbound_sms_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_inbound_sms_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_kanban_config: {
        Row: {
          created_at: string
          id: string
          tenant_id: string
          updated_at: string
          visible_statuses: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          tenant_id: string
          updated_at?: string
          visible_statuses?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          tenant_id?: string
          updated_at?: string
          visible_statuses?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "crm_kanban_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_missive_settings: {
        Row: {
          connection_status: string | null
          created_at: string
          from_email: string | null
          from_name: string | null
          id: string
          is_connected: boolean
          last_sync_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          connection_status?: string | null
          created_at?: string
          from_email?: string | null
          from_name?: string | null
          id?: string
          is_connected?: boolean
          last_sync_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          connection_status?: string | null
          created_at?: string
          from_email?: string | null
          from_name?: string | null
          id?: string
          is_connected?: boolean
          last_sync_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_missive_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notes: {
        Row: {
          client_id: string | null
          conversation_id: string | null
          created_at: string
          created_by_profile_id: string
          id: string
          is_pinned: boolean
          note_content: string
          note_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by_profile_id: string
          id?: string
          is_pinned?: boolean
          note_content: string
          note_type?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by_profile_id?: string
          id?: string
          is_pinned?: boolean
          note_content?: string
          note_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_notes_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "crm_notes_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tasks: {
        Row: {
          campaign_id: string | null
          checklist: Json
          client_id: string | null
          collaborator_ids: string[]
          completed_at: string | null
          created_at: string
          created_by_profile_id: string
          description: string | null
          due_at: string | null
          exception_id: string | null
          id: string
          owner_id: string | null
          priority: Database["public"]["Enums"]["crm_task_priority_enum"]
          recurrence: string | null
          staff_id: string | null
          start_at: string | null
          status: Database["public"]["Enums"]["crm_task_status_enum"]
          tags: string[]
          tenant_id: string
          title: string
          type: Database["public"]["Enums"]["crm_task_type_enum"]
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          checklist?: Json
          client_id?: string | null
          collaborator_ids?: string[]
          completed_at?: string | null
          created_at?: string
          created_by_profile_id: string
          description?: string | null
          due_at?: string | null
          exception_id?: string | null
          id?: string
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["crm_task_priority_enum"]
          recurrence?: string | null
          staff_id?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["crm_task_status_enum"]
          tags?: string[]
          tenant_id: string
          title: string
          type?: Database["public"]["Enums"]["crm_task_type_enum"]
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          checklist?: Json
          client_id?: string | null
          collaborator_ids?: string[]
          completed_at?: string | null
          created_at?: string
          created_by_profile_id?: string
          description?: string | null
          due_at?: string | null
          exception_id?: string | null
          id?: string
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["crm_task_priority_enum"]
          recurrence?: string | null
          staff_id?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["crm_task_status_enum"]
          tags?: string[]
          tenant_id?: string
          title?: string
          type?: Database["public"]["Enums"]["crm_task_type_enum"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
        ]
      }
      crm_user_capabilities: {
        Row: {
          crm_role: Database["public"]["Enums"]["crm_capability_role"]
          granted_at: string
          granted_by: string | null
          id: string
          profile_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          crm_role?: Database["public"]["Enums"]["crm_capability_role"]
          granted_at?: string
          granted_by?: string | null
          id?: string
          profile_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          crm_role?: Database["public"]["Enums"]["crm_capability_role"]
          granted_at?: string
          granted_by?: string | null
          id?: string
          profile_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      data_fields: {
        Row: {
          client_editable_default: boolean
          client_visible_default: boolean
          clinician_editable_default: boolean
          clinician_visible_default: boolean
          column_name: string | null
          computed_source: string | null
          description: string | null
          id: number
          key: string
          label: string
          meta: Json | null
          source_type: string
          table_name: string | null
        }
        Insert: {
          client_editable_default?: boolean
          client_visible_default?: boolean
          clinician_editable_default?: boolean
          clinician_visible_default?: boolean
          column_name?: string | null
          computed_source?: string | null
          description?: string | null
          id?: number
          key: string
          label: string
          meta?: Json | null
          source_type: string
          table_name?: string | null
        }
        Update: {
          client_editable_default?: boolean
          client_visible_default?: boolean
          clinician_editable_default?: boolean
          clinician_visible_default?: boolean
          column_name?: string | null
          computed_source?: string | null
          description?: string | null
          id?: number
          key?: string
          label?: string
          meta?: Json | null
          source_type?: string
          table_name?: string | null
        }
        Relationships: []
      }
      diagnosis_codes: {
        Row: {
          code: string
          created_at: string
          description: string
          id: string
          is_active: boolean
          is_billable: boolean
          system: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          id?: string
          is_active?: boolean
          is_billable?: boolean
          system?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          is_billable?: boolean
          system?: string
          updated_at?: string
        }
        Relationships: []
      }
      donation_attribution: {
        Row: {
          created_at: string
          gbraid: string | null
          gclid: string | null
          token: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          wbraid: string | null
        }
        Insert: {
          created_at?: string
          gbraid?: string | null
          gclid?: string | null
          token: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          wbraid?: string | null
        }
        Update: {
          created_at?: string
          gbraid?: string | null
          gclid?: string | null
          token?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          wbraid?: string | null
        }
        Relationships: []
      }
      edge_function_executions: {
        Row: {
          duration_ms: number | null
          error_message: string | null
          executed_at: string | null
          function_name: string
          id: string
          items_processed: number | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          duration_ms?: number | null
          error_message?: string | null
          executed_at?: string | null
          function_name: string
          id?: string
          items_processed?: number | null
          status: string
          tenant_id?: string | null
        }
        Update: {
          duration_ms?: number | null
          error_message?: string | null
          executed_at?: string | null
          function_name?: string
          id?: string
          items_processed?: number | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "edge_function_executions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      eligibility_checks: {
        Row: {
          claimmd_eligibility_id: string | null
          client_id: string
          client_insurance_id: string
          coverage_end: string | null
          coverage_start: string | null
          created_at: string
          eligibility_status: string
          error_codes: string[]
          has_other_coverage: boolean | null
          id: string
          insurance_updated_at_snapshot: string
          insurance_verification_version: number
          normalized_outcome: Database["public"]["Enums"]["insurance_eligibility_outcome_enum"]
          payer_order_detected: string | null
          recorded_by_profile_id: string | null
          request_fingerprint: Json
          requested_at: string
          response_message: string | null
          result_metadata: Json
          service_date: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          claimmd_eligibility_id?: string | null
          client_id: string
          client_insurance_id: string
          coverage_end?: string | null
          coverage_start?: string | null
          created_at?: string
          eligibility_status: string
          error_codes?: string[]
          has_other_coverage?: boolean | null
          id?: string
          insurance_updated_at_snapshot: string
          insurance_verification_version: number
          normalized_outcome: Database["public"]["Enums"]["insurance_eligibility_outcome_enum"]
          payer_order_detected?: string | null
          recorded_by_profile_id?: string | null
          request_fingerprint?: Json
          requested_at?: string
          response_message?: string | null
          result_metadata?: Json
          service_date: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          claimmd_eligibility_id?: string | null
          client_id?: string
          client_insurance_id?: string
          coverage_end?: string | null
          coverage_start?: string | null
          created_at?: string
          eligibility_status?: string
          error_codes?: string[]
          has_other_coverage?: boolean | null
          id?: string
          insurance_updated_at_snapshot?: string
          insurance_verification_version?: number
          normalized_outcome?: Database["public"]["Enums"]["insurance_eligibility_outcome_enum"]
          payer_order_detected?: string | null
          recorded_by_profile_id?: string | null
          request_fingerprint?: Json
          requested_at?: string
          response_message?: string | null
          result_metadata?: Json
          service_date?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eligibility_checks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_checks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "eligibility_checks_client_insurance_id_fkey"
            columns: ["client_insurance_id"]
            isOneToOne: false
            referencedRelation: "client_insurance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_checks_client_insurance_id_fkey"
            columns: ["client_insurance_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_operations"
            referencedColumns: ["current_insurance_id"]
          },
          {
            foreignKeyName: "eligibility_checks_recorded_by_profile_id_fkey"
            columns: ["recorded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "eligibility_checks_recorded_by_profile_id_fkey"
            columns: ["recorded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_checks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      era_adjustments: {
        Row: {
          adjustment_group: string | null
          amount: number
          created_at: string
          era_service_line_id: string
          id: string
          reason_code: string | null
          remark_code: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          adjustment_group?: string | null
          amount: number
          created_at?: string
          era_service_line_id: string
          id?: string
          reason_code?: string | null
          remark_code?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          adjustment_group?: string | null
          amount?: number
          created_at?: string
          era_service_line_id?: string
          id?: string
          reason_code?: string | null
          remark_code?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "era_adjustments_era_service_line_id_fkey"
            columns: ["era_service_line_id"]
            isOneToOne: false
            referencedRelation: "era_service_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "era_adjustments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      era_claims: {
        Row: {
          allowed_amount: number | null
          claim_amount: number | null
          claim_id: string | null
          claim_status_code: string | null
          created_at: string
          era_id: string
          id: string
          paid_amount: number | null
          patient_responsibility_amt: number | null
          payer_claim_control_no: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allowed_amount?: number | null
          claim_amount?: number | null
          claim_id?: string | null
          claim_status_code?: string | null
          created_at?: string
          era_id: string
          id?: string
          paid_amount?: number | null
          patient_responsibility_amt?: number | null
          payer_claim_control_no?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allowed_amount?: number | null
          claim_amount?: number | null
          claim_id?: string | null
          claim_status_code?: string | null
          created_at?: string
          era_id?: string
          id?: string
          paid_amount?: number | null
          patient_responsibility_amt?: number | null
          payer_claim_control_no?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "era_claims_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "era_claims_era_id_fkey"
            columns: ["era_id"]
            isOneToOne: false
            referencedRelation: "eras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "era_claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      era_report_reconciliation_links: {
        Row: {
          created_at: string
          discrepancy: Json | null
          era_service_line_id: string
          id: string
          linked_at: string
          payment_source_row_id: string
          reconciliation_status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          discrepancy?: Json | null
          era_service_line_id: string
          id?: string
          linked_at?: string
          payment_source_row_id: string
          reconciliation_status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          discrepancy?: Json | null
          era_service_line_id?: string
          id?: string
          linked_at?: string
          payment_source_row_id?: string
          reconciliation_status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "era_report_reconciliation_links_era_service_line_id_fkey"
            columns: ["era_service_line_id"]
            isOneToOne: false
            referencedRelation: "era_service_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "era_report_reconciliation_links_payment_source_row_id_fkey"
            columns: ["payment_source_row_id"]
            isOneToOne: false
            referencedRelation: "payment_source_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      era_service_line_copay_reconciliation: {
        Row: {
          auto_created_charge: boolean
          charge_amount: number | null
          copay_reconciled: boolean
          copay_variance_amount: number | null
          created_at: string
          era_service_line_id: string
          id: string
          matched_client_charge_id: string | null
          notes: string | null
          pr3_amount: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auto_created_charge?: boolean
          charge_amount?: number | null
          copay_reconciled?: boolean
          copay_variance_amount?: number | null
          created_at?: string
          era_service_line_id: string
          id?: string
          matched_client_charge_id?: string | null
          notes?: string | null
          pr3_amount?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auto_created_charge?: boolean
          charge_amount?: number | null
          copay_reconciled?: boolean
          copay_variance_amount?: number | null
          created_at?: string
          era_service_line_id?: string
          id?: string
          matched_client_charge_id?: string | null
          notes?: string | null
          pr3_amount?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "era_service_line_copay_reconcilia_matched_client_charge_id_fkey"
            columns: ["matched_client_charge_id"]
            isOneToOne: false
            referencedRelation: "client_charge_balances"
            referencedColumns: ["charge_id"]
          },
          {
            foreignKeyName: "era_service_line_copay_reconcilia_matched_client_charge_id_fkey"
            columns: ["matched_client_charge_id"]
            isOneToOne: false
            referencedRelation: "client_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "era_service_line_copay_reconciliation_era_service_line_id_fkey"
            columns: ["era_service_line_id"]
            isOneToOne: true
            referencedRelation: "era_service_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      era_service_lines: {
        Row: {
          allowed_amount: number | null
          billed_amount: number | null
          claim_line_id: string | null
          created_at: string
          era_claim_id: string
          id: string
          match_confidence: number | null
          match_method: string | null
          mod1: string | null
          mod2: string | null
          mod3: string | null
          mod4: string | null
          paid_amount: number | null
          patient_responsibility_amt: number | null
          procedure_code: string | null
          service_date_from: string | null
          service_date_to: string | null
          source_record_hash: string | null
          source_system: string | null
          tenant_id: string
          units: number | null
          updated_at: string
        }
        Insert: {
          allowed_amount?: number | null
          billed_amount?: number | null
          claim_line_id?: string | null
          created_at?: string
          era_claim_id: string
          id?: string
          match_confidence?: number | null
          match_method?: string | null
          mod1?: string | null
          mod2?: string | null
          mod3?: string | null
          mod4?: string | null
          paid_amount?: number | null
          patient_responsibility_amt?: number | null
          procedure_code?: string | null
          service_date_from?: string | null
          service_date_to?: string | null
          source_record_hash?: string | null
          source_system?: string | null
          tenant_id: string
          units?: number | null
          updated_at?: string
        }
        Update: {
          allowed_amount?: number | null
          billed_amount?: number | null
          claim_line_id?: string | null
          created_at?: string
          era_claim_id?: string
          id?: string
          match_confidence?: number | null
          match_method?: string | null
          mod1?: string | null
          mod2?: string | null
          mod3?: string | null
          mod4?: string | null
          paid_amount?: number | null
          patient_responsibility_amt?: number | null
          procedure_code?: string | null
          service_date_from?: string | null
          service_date_to?: string | null
          source_record_hash?: string | null
          source_system?: string | null
          tenant_id?: string
          units?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "era_service_lines_claim_line_id_fkey"
            columns: ["claim_line_id"]
            isOneToOne: false
            referencedRelation: "claim_line_balances"
            referencedColumns: ["claim_line_id"]
          },
          {
            foreignKeyName: "era_service_lines_claim_line_id_fkey"
            columns: ["claim_line_id"]
            isOneToOne: false
            referencedRelation: "claim_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "era_service_lines_era_claim_id_fkey"
            columns: ["era_claim_id"]
            isOneToOne: false
            referencedRelation: "era_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "era_service_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      eras: {
        Row: {
          committed_at: string | null
          created_at: string
          id: string
          import_status: Database["public"]["Enums"]["era_import_status"] | null
          payer_id: string | null
          payer_name: string | null
          payment_date: string | null
          payment_reference: string | null
          practice_id: string
          source_era_id: string | null
          source_record_hash: string | null
          source_system: string | null
          superseded_by_era_id: string | null
          tenant_id: string
          total_payment_amount: number | null
          updated_at: string
        }
        Insert: {
          committed_at?: string | null
          created_at?: string
          id?: string
          import_status?:
            | Database["public"]["Enums"]["era_import_status"]
            | null
          payer_id?: string | null
          payer_name?: string | null
          payment_date?: string | null
          payment_reference?: string | null
          practice_id: string
          source_era_id?: string | null
          source_record_hash?: string | null
          source_system?: string | null
          superseded_by_era_id?: string | null
          tenant_id: string
          total_payment_amount?: number | null
          updated_at?: string
        }
        Update: {
          committed_at?: string | null
          created_at?: string
          id?: string
          import_status?:
            | Database["public"]["Enums"]["era_import_status"]
            | null
          payer_id?: string | null
          payer_name?: string | null
          payment_date?: string | null
          payment_reference?: string | null
          practice_id?: string
          source_era_id?: string | null
          source_record_hash?: string | null
          source_system?: string | null
          superseded_by_era_id?: string | null
          tenant_id?: string
          total_payment_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eras_practice_id_fkey"
            columns: ["practice_id"]
            isOneToOne: false
            referencedRelation: "practice_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eras_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      form_assignment_rules: {
        Row: {
          active: boolean
          applies_to_client_type: string | null
          applies_to_new_clients: boolean
          assign_after_days: number | null
          due_after_days: number | null
          form_id: number
          id: number
          tenant_id: string
        }
        Insert: {
          active?: boolean
          applies_to_client_type?: string | null
          applies_to_new_clients?: boolean
          assign_after_days?: number | null
          due_after_days?: number | null
          form_id: number
          id?: number
          tenant_id: string
        }
        Update: {
          active?: boolean
          applies_to_client_type?: string | null
          applies_to_new_clients?: boolean
          assign_after_days?: number | null
          due_after_days?: number | null
          form_id?: number
          id?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_assignment_rules_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          client_id: string
          completed_at: string | null
          due_at: string | null
          form_id: number
          id: number
          status: string
          tenant_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          client_id: string
          completed_at?: string | null
          due_at?: string | null
          form_id: number
          id?: number
          status?: string
          tenant_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          client_id?: string
          completed_at?: string | null
          due_at?: string | null
          form_id?: number
          id?: number
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_assignments_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_fields: {
        Row: {
          client_editable: boolean | null
          client_visible: boolean | null
          clinician_editable: boolean | null
          clinician_visible: boolean | null
          data_field_id: number
          field_type: string
          form_id: number
          help_text: string | null
          id: number
          label_override: string | null
          required: boolean
          sort_order: number
        }
        Insert: {
          client_editable?: boolean | null
          client_visible?: boolean | null
          clinician_editable?: boolean | null
          clinician_visible?: boolean | null
          data_field_id: number
          field_type: string
          form_id: number
          help_text?: string | null
          id?: number
          label_override?: string | null
          required?: boolean
          sort_order?: number
        }
        Update: {
          client_editable?: boolean | null
          client_visible?: boolean | null
          clinician_editable?: boolean | null
          clinician_visible?: boolean | null
          data_field_id?: number
          field_type?: string
          form_id?: number
          help_text?: string | null
          id?: number
          label_override?: string | null
          required?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_fields_data_field_id_fkey"
            columns: ["data_field_id"]
            isOneToOne: false
            referencedRelation: "data_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_fields_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_response_values: {
        Row: {
          created_at: string
          data_field_id: number
          form_field_id: number
          id: number
          response_id: number
          tenant_id: string
          value: Json | null
        }
        Insert: {
          created_at?: string
          data_field_id: number
          form_field_id: number
          id?: number
          response_id: number
          tenant_id: string
          value?: Json | null
        }
        Update: {
          created_at?: string
          data_field_id?: number
          form_field_id?: number
          id?: number
          response_id?: number
          tenant_id?: string
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "form_response_values_data_field_id_fkey"
            columns: ["data_field_id"]
            isOneToOne: false
            referencedRelation: "data_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_response_values_form_field_id_fkey"
            columns: ["form_field_id"]
            isOneToOne: false
            referencedRelation: "form_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_response_values_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      form_responses: {
        Row: {
          created_at: string
          customer_id: string | null
          form_template_id: string
          id: string
          response_data: Json
          submitted_at: string
          submitted_by_user_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          form_template_id: string
          id?: string
          response_data?: Json
          submitted_at?: string
          submitted_by_user_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          form_template_id?: string
          id?: string
          response_data?: Json
          submitted_at?: string
          submitted_by_user_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_responses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_responses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "form_responses_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      form_template_fields: {
        Row: {
          conditional_logic: Json | null
          created_at: string
          field_key: string
          field_type: string
          form_template_id: string
          help_text: string | null
          id: string
          is_required: boolean
          label: string
          options: Json | null
          order_index: number
          placeholder: string | null
          updated_at: string
          validation_rules: Json | null
        }
        Insert: {
          conditional_logic?: Json | null
          created_at?: string
          field_key: string
          field_type: string
          form_template_id: string
          help_text?: string | null
          id?: string
          is_required?: boolean
          label: string
          options?: Json | null
          order_index?: number
          placeholder?: string | null
          updated_at?: string
          validation_rules?: Json | null
        }
        Update: {
          conditional_logic?: Json | null
          created_at?: string
          field_key?: string
          field_type?: string
          form_template_id?: string
          help_text?: string | null
          id?: string
          is_required?: boolean
          label?: string
          options?: Json | null
          order_index?: number
          placeholder?: string | null
          updated_at?: string
          validation_rules?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "form_template_fields_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      form_templates: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          description: string | null
          form_type: string | null
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          form_type?: string | null
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          form_type?: string | null
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_templates_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "form_templates_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      forms: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          form_type: string | null
          id: number
          is_system_form: boolean
          name: string
          system_form_key: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          form_type?: string | null
          id?: number
          is_system_form?: boolean
          name: string
          system_form_key?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          form_type?: string | null
          id?: number
          is_system_form?: boolean
          name?: string
          system_form_key?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      givebutter_donations: {
        Row: {
          ads_upload_error: string | null
          ads_upload_status: string
          ads_uploaded_at: string | null
          amount: number
          currency: string
          donated_at: string
          raw: Json
          token: string | null
          transaction_id: string
        }
        Insert: {
          ads_upload_error?: string | null
          ads_upload_status?: string
          ads_uploaded_at?: string | null
          amount: number
          currency?: string
          donated_at: string
          raw: Json
          token?: string | null
          transaction_id: string
        }
        Update: {
          ads_upload_error?: string | null
          ads_upload_status?: string
          ads_uploaded_at?: string | null
          amount?: number
          currency?: string
          donated_at?: string
          raw?: Json
          token?: string | null
          transaction_id?: string
        }
        Relationships: []
      }
      ignore: {
        Row: {
          created_at: string
          updated: string | null
        }
        Insert: {
          created_at?: string
          updated?: string | null
        }
        Update: {
          created_at?: string
          updated?: string | null
        }
        Relationships: []
      }
      integration_delivery_attempts: {
        Row: {
          attempt_number: number
          attempted_at: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_detail: string | null
          id: string
          outbox_id: string
          response_code: string | null
          response_metadata: Json
          result_status: Database["public"]["Enums"]["integration_outbox_status_enum"]
          worker_id: string | null
        }
        Insert: {
          attempt_number: number
          attempted_at?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          id?: string
          outbox_id: string
          response_code?: string | null
          response_metadata?: Json
          result_status: Database["public"]["Enums"]["integration_outbox_status_enum"]
          worker_id?: string | null
        }
        Update: {
          attempt_number?: number
          attempted_at?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          id?: string
          outbox_id?: string
          response_code?: string | null
          response_metadata?: Json
          result_status?: Database["public"]["Enums"]["integration_outbox_status_enum"]
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_delivery_attempts_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "integration_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_outbox: {
        Row: {
          actor_profile_id: string | null
          aggregate_id: string | null
          aggregate_type: string
          attempt_count: number
          available_at: string
          causation_id: string | null
          contains_phi: boolean
          correlation_id: string | null
          created_at: string
          dead_lettered_at: string | null
          delivered_at: string | null
          destination: string
          event_type: string
          event_version: number
          id: string
          idempotency_key: string
          last_error_code: string | null
          last_error_detail: string | null
          locked_at: string | null
          locked_by: string | null
          occurred_at: string
          payload: Json
          source: string
          status: Database["public"]["Enums"]["integration_outbox_status_enum"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          actor_profile_id?: string | null
          aggregate_id?: string | null
          aggregate_type: string
          attempt_count?: number
          available_at?: string
          causation_id?: string | null
          contains_phi?: boolean
          correlation_id?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          delivered_at?: string | null
          destination: string
          event_type: string
          event_version?: number
          id?: string
          idempotency_key: string
          last_error_code?: string | null
          last_error_detail?: string | null
          locked_at?: string | null
          locked_by?: string | null
          occurred_at?: string
          payload?: Json
          source: string
          status?: Database["public"]["Enums"]["integration_outbox_status_enum"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          actor_profile_id?: string | null
          aggregate_id?: string | null
          aggregate_type?: string
          attempt_count?: number
          available_at?: string
          causation_id?: string | null
          contains_phi?: boolean
          correlation_id?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          delivered_at?: string | null
          destination?: string
          event_type?: string
          event_version?: number
          id?: string
          idempotency_key?: string
          last_error_code?: string | null
          last_error_detail?: string | null
          locked_at?: string | null
          locked_by?: string | null
          occurred_at?: string
          payload?: Json
          source?: string
          status?: Database["public"]["Enums"]["integration_outbox_status_enum"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_outbox_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "integration_outbox_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_outbox_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jarvis_approvals: {
        Row: {
          approval_type: string
          id: string
          payload: Json
          requested_at: string
          requested_by: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          task_id: string | null
        }
        Insert: {
          approval_type?: string
          id?: string
          payload?: Json
          requested_at?: string
          requested_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          task_id?: string | null
        }
        Update: {
          approval_type?: string
          id?: string
          payload?: Json
          requested_at?: string
          requested_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          task_id?: string | null
        }
        Relationships: []
      }
      jarvis_events: {
        Row: {
          actor: string
          created_at: string
          event_type: string
          id: string
          metadata: Json
          severity: string
          task_id: string | null
        }
        Insert: {
          actor: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          severity?: string
          task_id?: string | null
        }
        Update: {
          actor?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          severity?: string
          task_id?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          client_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
          sender_type: string
          staff_id: string
          tenant_id: string
        }
        Insert: {
          body: string
          client_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
          sender_type: string
          staff_id: string
          tenant_id: string
        }
        Update: {
          body?: string
          client_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
          sender_type?: string
          staff_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "messages_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      missive_conversation_links: {
        Row: {
          client_id: string
          conversation_id: string
          created_at: string
          id: string
          link_type: string
          linked_by_profile_id: string
          tenant_id: string
        }
        Insert: {
          client_id: string
          conversation_id: string
          created_at?: string
          id?: string
          link_type?: string
          linked_by_profile_id: string
          tenant_id: string
        }
        Update: {
          client_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          link_type?: string
          linked_by_profile_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "missive_conversation_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missive_conversation_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "missive_conversation_links_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "missive_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missive_conversation_links_linked_by_profile_id_fkey"
            columns: ["linked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "missive_conversation_links_linked_by_profile_id_fkey"
            columns: ["linked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missive_conversation_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      missive_conversations: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          last_message_at: string | null
          missive_conversation_id: string
          needs_reply: boolean
          participants: Json | null
          snippet: string | null
          subject: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          last_message_at?: string | null
          missive_conversation_id: string
          needs_reply?: boolean
          participants?: Json | null
          snippet?: string | null
          subject?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          last_message_at?: string | null
          missive_conversation_id?: string
          needs_reply?: boolean
          participants?: Json | null
          snippet?: string | null
          subject?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "missive_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pat_rel: {
        Row: {
          created_at: string
          description: string | null
          id: number
          pat_rel: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: number
          pat_rel?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: number
          pat_rel?: string | null
        }
        Relationships: []
      }
      payment_allocations: {
        Row: {
          allocated_amount: number
          claim_line_id: string
          created_at: string
          id: string
          payment_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allocated_amount: number
          claim_line_id: string
          created_at?: string
          id?: string
          payment_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allocated_amount?: number
          claim_line_id?: string
          created_at?: string
          id?: string
          payment_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_claim_line_id_fkey"
            columns: ["claim_line_id"]
            isOneToOne: false
            referencedRelation: "claim_line_balances"
            referencedColumns: ["claim_line_id"]
          },
          {
            foreignKeyName: "payment_allocations_claim_line_id_fkey"
            columns: ["claim_line_id"]
            isOneToOne: false
            referencedRelation: "claim_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "client_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_source_documents: {
        Row: {
          ambiguous_row_count: number
          committed_at: string | null
          created_at: string
          document_type: string
          duplicate_row_count: number
          error_count: number
          file_sha256: string
          filename: string
          id: string
          import_status: Database["public"]["Enums"]["payment_source_document_status"]
          imported_row_count: number
          matched_row_count: number
          payer_id: string | null
          practice_id: string | null
          raw_metadata: Json
          report_date: string | null
          source_system: string
          source_system_value: string | null
          storage_path: string | null
          tenant_id: string
          total_rows_reported: number | null
          unmatched_row_count: number
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          vendor_id: string | null
        }
        Insert: {
          ambiguous_row_count?: number
          committed_at?: string | null
          created_at?: string
          document_type: string
          duplicate_row_count?: number
          error_count?: number
          file_sha256: string
          filename: string
          id?: string
          import_status?: Database["public"]["Enums"]["payment_source_document_status"]
          imported_row_count?: number
          matched_row_count?: number
          payer_id?: string | null
          practice_id?: string | null
          raw_metadata?: Json
          report_date?: string | null
          source_system: string
          source_system_value?: string | null
          storage_path?: string | null
          tenant_id: string
          total_rows_reported?: number | null
          unmatched_row_count?: number
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          vendor_id?: string | null
        }
        Update: {
          ambiguous_row_count?: number
          committed_at?: string | null
          created_at?: string
          document_type?: string
          duplicate_row_count?: number
          error_count?: number
          file_sha256?: string
          filename?: string
          id?: string
          import_status?: Database["public"]["Enums"]["payment_source_document_status"]
          imported_row_count?: number
          matched_row_count?: number
          payer_id?: string | null
          practice_id?: string | null
          raw_metadata?: Json
          report_date?: string | null
          source_system?: string
          source_system_value?: string | null
          storage_path?: string | null
          tenant_id?: string
          total_rows_reported?: number | null
          unmatched_row_count?: number
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          vendor_id?: string | null
        }
        Relationships: []
      }
      payment_source_rows: {
        Row: {
          amount_discrepancy_notes: string | null
          certified_amount: number | null
          check_eft_date: string | null
          check_number: string | null
          created_at: string
          discount_amount: number | null
          dismissed_at: string | null
          dismissed_by: string | null
          dismissed_reason: string | null
          id: string
          interest_amount: number | null
          invoice_number: string | null
          manually_matched_at: string | null
          manually_matched_by: string | null
          match_confidence: number | null
          match_method: string | null
          match_state: Database["public"]["Enums"]["payment_source_row_state"]
          matched_claim_id: string | null
          matched_claim_line_id: string | null
          matched_client_id: string | null
          payer_id: string | null
          payment_amount: number | null
          payment_doc_number: string | null
          po_number: string | null
          posted_payment_id: string | null
          raw_row: Json
          reconciliation_notes: string | null
          reconciliation_state: string | null
          row_number: number | null
          service_date: string | null
          source_document_id: string
          source_row_hash: string | null
          source_system: string
          source_system_value: string | null
          tenant_id: string
          updated_at: string
          vendor_code: string | null
          vendor_id: string | null
          vet_name_first_prefix: string | null
          vet_name_last_norm: string | null
          vet_name_raw: string | null
          zero_payment_flag: string | null
        }
        Insert: {
          amount_discrepancy_notes?: string | null
          certified_amount?: number | null
          check_eft_date?: string | null
          check_number?: string | null
          created_at?: string
          discount_amount?: number | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          dismissed_reason?: string | null
          id?: string
          interest_amount?: number | null
          invoice_number?: string | null
          manually_matched_at?: string | null
          manually_matched_by?: string | null
          match_confidence?: number | null
          match_method?: string | null
          match_state?: Database["public"]["Enums"]["payment_source_row_state"]
          matched_claim_id?: string | null
          matched_claim_line_id?: string | null
          matched_client_id?: string | null
          payer_id?: string | null
          payment_amount?: number | null
          payment_doc_number?: string | null
          po_number?: string | null
          posted_payment_id?: string | null
          raw_row?: Json
          reconciliation_notes?: string | null
          reconciliation_state?: string | null
          row_number?: number | null
          service_date?: string | null
          source_document_id: string
          source_row_hash?: string | null
          source_system: string
          source_system_value?: string | null
          tenant_id: string
          updated_at?: string
          vendor_code?: string | null
          vendor_id?: string | null
          vet_name_first_prefix?: string | null
          vet_name_last_norm?: string | null
          vet_name_raw?: string | null
          zero_payment_flag?: string | null
        }
        Update: {
          amount_discrepancy_notes?: string | null
          certified_amount?: number | null
          check_eft_date?: string | null
          check_number?: string | null
          created_at?: string
          discount_amount?: number | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          dismissed_reason?: string | null
          id?: string
          interest_amount?: number | null
          invoice_number?: string | null
          manually_matched_at?: string | null
          manually_matched_by?: string | null
          match_confidence?: number | null
          match_method?: string | null
          match_state?: Database["public"]["Enums"]["payment_source_row_state"]
          matched_claim_id?: string | null
          matched_claim_line_id?: string | null
          matched_client_id?: string | null
          payer_id?: string | null
          payment_amount?: number | null
          payment_doc_number?: string | null
          po_number?: string | null
          posted_payment_id?: string | null
          raw_row?: Json
          reconciliation_notes?: string | null
          reconciliation_state?: string | null
          row_number?: number | null
          service_date?: string | null
          source_document_id?: string
          source_row_hash?: string | null
          source_system?: string
          source_system_value?: string | null
          tenant_id?: string
          updated_at?: string
          vendor_code?: string | null
          vendor_id?: string | null
          vet_name_first_prefix?: string | null
          vet_name_last_norm?: string | null
          vet_name_raw?: string | null
          zero_payment_flag?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_source_rows_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "payment_source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_appointment_log: {
        Row: {
          appointment_id: string
          created_at: string
          id: string
          payroll_line_item_id: string
          rate_applied: number
          status_at_processing: string
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          id?: string
          payroll_line_item_id: string
          rate_applied: number
          status_at_processing: string
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          id?: string
          payroll_line_item_id?: string
          rate_applied?: number
          status_at_processing?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_appointment_log_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_appointment_log_payroll_line_item_id_fkey"
            columns: ["payroll_line_item_id"]
            isOneToOne: false
            referencedRelation: "payroll_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_appointment_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_execution_log: {
        Row: {
          created_at: string
          ended_at: string | null
          error_message: string | null
          execution_request_id: string | null
          id: string
          line_items_failed: number
          line_items_sent: number
          line_items_skipped: number
          line_items_total: number
          payroll_run_id: string
          started_at: string
          status: string
          tenant_id: string
          triggered_by: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          error_message?: string | null
          execution_request_id?: string | null
          id?: string
          line_items_failed?: number
          line_items_sent?: number
          line_items_skipped?: number
          line_items_total?: number
          payroll_run_id: string
          started_at?: string
          status?: string
          tenant_id: string
          triggered_by?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          error_message?: string | null
          execution_request_id?: string | null
          id?: string
          line_items_failed?: number
          line_items_sent?: number
          line_items_skipped?: number
          line_items_total?: number
          payroll_run_id?: string
          started_at?: string
          status?: string
          tenant_id?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_execution_log_execution_request_id_fkey"
            columns: ["execution_request_id"]
            isOneToOne: false
            referencedRelation: "payroll_execution_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_execution_log_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_execution_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_execution_requests: {
        Row: {
          client_action_id: string
          created_at: string
          id: string
          payroll_run_id: string
          requested_by_profile_id: string | null
          result: Json | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_action_id: string
          created_at?: string
          id?: string
          payroll_run_id: string
          requested_by_profile_id?: string | null
          result?: Json | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_action_id?: string
          created_at?: string
          id?: string
          payroll_run_id?: string
          requested_by_profile_id?: string | null
          result?: Json | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_execution_requests_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_execution_requests_requested_by_profile_id_fkey"
            columns: ["requested_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "payroll_execution_requests_requested_by_profile_id_fkey"
            columns: ["requested_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_execution_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_line_items: {
        Row: {
          admin_approval_status: string
          admin_approved_at: string | null
          admin_approved_by: string | null
          created_at: string
          documented_amount: number
          documented_count: number
          documented_rate: number
          error_message: string | null
          id: string
          late_cancel_amount: number
          late_cancel_count: number
          late_cancel_rate: number
          mercury_status: string | null
          mercury_transaction_id: string | null
          noshow_amount: number
          noshow_count: number
          noshow_rate: number
          payroll_run_id: string
          recipient_id: string | null
          staff_approval_status: string
          staff_approved_at: string | null
          staff_dispute_reason: string | null
          staff_id: string
          tenant_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          admin_approval_status?: string
          admin_approved_at?: string | null
          admin_approved_by?: string | null
          created_at?: string
          documented_amount?: number
          documented_count?: number
          documented_rate?: number
          error_message?: string | null
          id?: string
          late_cancel_amount?: number
          late_cancel_count?: number
          late_cancel_rate?: number
          mercury_status?: string | null
          mercury_transaction_id?: string | null
          noshow_amount?: number
          noshow_count?: number
          noshow_rate?: number
          payroll_run_id: string
          recipient_id?: string | null
          staff_approval_status?: string
          staff_approved_at?: string | null
          staff_dispute_reason?: string | null
          staff_id: string
          tenant_id: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          admin_approval_status?: string
          admin_approved_at?: string | null
          admin_approved_by?: string | null
          created_at?: string
          documented_amount?: number
          documented_count?: number
          documented_rate?: number
          error_message?: string | null
          id?: string
          late_cancel_amount?: number
          late_cancel_count?: number
          late_cancel_rate?: number
          mercury_status?: string | null
          mercury_transaction_id?: string | null
          noshow_amount?: number
          noshow_count?: number
          noshow_rate?: number
          payroll_run_id?: string
          recipient_id?: string | null
          staff_approval_status?: string
          staff_approved_at?: string | null
          staff_dispute_reason?: string | null
          staff_id?: string
          tenant_id?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_line_items_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_line_items_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "payroll_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_line_items_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "payroll_recipients_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_line_items_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_line_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_payment_attempts: {
        Row: {
          attempt_ended_at: string | null
          attempt_started_at: string
          body_preview: string | null
          created_at: string
          duration_ms: number | null
          error_class: string | null
          error_message: string | null
          execution_log_id: string | null
          id: string
          idempotency_key: string
          line_item_id: string
          mercury_transaction_id: string | null
          payroll_run_id: string
          proxy_content_type: string | null
          proxy_http_status: number | null
          tenant_id: string
        }
        Insert: {
          attempt_ended_at?: string | null
          attempt_started_at?: string
          body_preview?: string | null
          created_at?: string
          duration_ms?: number | null
          error_class?: string | null
          error_message?: string | null
          execution_log_id?: string | null
          id?: string
          idempotency_key: string
          line_item_id: string
          mercury_transaction_id?: string | null
          payroll_run_id: string
          proxy_content_type?: string | null
          proxy_http_status?: number | null
          tenant_id: string
        }
        Update: {
          attempt_ended_at?: string | null
          attempt_started_at?: string
          body_preview?: string | null
          created_at?: string
          duration_ms?: number | null
          error_class?: string | null
          error_message?: string | null
          execution_log_id?: string | null
          id?: string
          idempotency_key?: string
          line_item_id?: string
          mercury_transaction_id?: string | null
          payroll_run_id?: string
          proxy_content_type?: string | null
          proxy_http_status?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_payment_attempts_execution_log_id_fkey"
            columns: ["execution_log_id"]
            isOneToOne: false
            referencedRelation: "payroll_execution_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payment_attempts_line_item_id_fkey"
            columns: ["line_item_id"]
            isOneToOne: false
            referencedRelation: "payroll_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payment_attempts_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payment_attempts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_rate_configs: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          rate_amount: number
          status_code: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          rate_amount: number
          status_code: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          rate_amount?: number
          status_code?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_rate_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_recipients: {
        Row: {
          account_nickname: string | null
          account_number_encrypted: string | null
          account_number_last4: string | null
          account_type: string
          created_at: string
          deposit_addr_1: string | null
          deposit_addr_2: string | null
          deposit_city: string | null
          deposit_state: Database["public"]["Enums"]["state_code_enum"] | null
          deposit_zip: string | null
          id: string
          is_active: boolean
          mercury_account_id: string | null
          mercury_recipient_id: string | null
          recipient_name: string | null
          routing_number_encrypted: string | null
          routing_number_last4: string | null
          staff_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_nickname?: string | null
          account_number_encrypted?: string | null
          account_number_last4?: string | null
          account_type: string
          created_at?: string
          deposit_addr_1?: string | null
          deposit_addr_2?: string | null
          deposit_city?: string | null
          deposit_state?: Database["public"]["Enums"]["state_code_enum"] | null
          deposit_zip?: string | null
          id?: string
          is_active?: boolean
          mercury_account_id?: string | null
          mercury_recipient_id?: string | null
          recipient_name?: string | null
          routing_number_encrypted?: string | null
          routing_number_last4?: string | null
          staff_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_nickname?: string | null
          account_number_encrypted?: string | null
          account_number_last4?: string | null
          account_type?: string
          created_at?: string
          deposit_addr_1?: string | null
          deposit_addr_2?: string | null
          deposit_city?: string | null
          deposit_state?: Database["public"]["Enums"]["state_code_enum"] | null
          deposit_zip?: string | null
          id?: string
          is_active?: boolean
          mercury_account_id?: string | null
          mercury_recipient_id?: string | null
          recipient_name?: string | null
          routing_number_encrypted?: string | null
          routing_number_last4?: string | null
          staff_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_recipients_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_recipients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_reconciliation_findings: {
        Row: {
          created_at: string
          details: Json
          finding_type: string
          id: string
          payroll_line_item_id: string | null
          payroll_payment_attempt_id: string | null
          payroll_run_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          finding_type: string
          id?: string
          payroll_line_item_id?: string | null
          payroll_payment_attempt_id?: string | null
          payroll_run_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          finding_type?: string
          id?: string
          payroll_line_item_id?: string | null
          payroll_payment_attempt_id?: string | null
          payroll_run_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      payroll_runs: {
        Row: {
          created_at: string
          error_message: string | null
          external_reference: string | null
          id: string
          period_end: string
          period_start: string
          processed_at: string | null
          run_type: string
          staff_approval_deadline: string | null
          staff_paid_count: number
          staff_skipped_count: number
          status: string
          tenant_id: string
          total_amount: number
          total_documented: number
          total_late_cancel: number
          total_noshow: number
          triggered_by: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          external_reference?: string | null
          id?: string
          period_end: string
          period_start: string
          processed_at?: string | null
          run_type?: string
          staff_approval_deadline?: string | null
          staff_paid_count?: number
          staff_skipped_count?: number
          status?: string
          tenant_id: string
          total_amount?: number
          total_documented?: number
          total_late_cancel?: number
          total_noshow?: number
          triggered_by?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          external_reference?: string | null
          id?: string
          period_end?: string
          period_start?: string
          processed_at?: string | null
          run_type?: string
          staff_approval_deadline?: string | null
          staff_paid_count?: number
          staff_skipped_count?: number
          status?: string
          tenant_id?: string
          total_amount?: number
          total_documented?: number
          total_late_cancel?: number
          total_noshow?: number
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_settings: {
        Row: {
          auto_approve_enabled: boolean
          created_at: string
          id: string
          pay_period_anchor_day: number
          pay_period_start_date: string | null
          pay_period_type: string
          staff_approval_deadline_days: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auto_approve_enabled?: boolean
          created_at?: string
          id?: string
          pay_period_anchor_day?: number
          pay_period_start_date?: string | null
          pay_period_type?: string
          staff_approval_deadline_days?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auto_approve_enabled?: boolean
          created_at?: string
          id?: string
          pay_period_anchor_day?: number
          pay_period_start_date?: string | null
          pay_period_type?: string
          staff_approval_deadline_days?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      place_of_service: {
        Row: {
          description: string
          pos_code: string
        }
        Insert: {
          description: string
          pos_code: string
        }
        Update: {
          description?: string
          pos_code?: string
        }
        Relationships: []
      }
      practice_info: {
        Row: {
          allow_privatepay: boolean
          bill_addr_1: string | null
          bill_addr_2: string | null
          bill_city: string | null
          bill_email: string | null
          bill_name: string
          bill_npi: string | null
          bill_phone: string | null
          bill_state: Database["public"]["Enums"]["state_code_enum"] | null
          bill_taxid: string
          bill_taxid_type: string | null
          bill_taxonomy: string | null
          bill_zip: string | null
          created_at: string
          id: string
          is_default: boolean
          pay_addr_1: string | null
          pay_addr_2: string | null
          pay_city: string | null
          pay_state: Database["public"]["Enums"]["state_code_enum"] | null
          pay_zip: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allow_privatepay?: boolean
          bill_addr_1?: string | null
          bill_addr_2?: string | null
          bill_city?: string | null
          bill_email?: string | null
          bill_name: string
          bill_npi?: string | null
          bill_phone?: string | null
          bill_state?: Database["public"]["Enums"]["state_code_enum"] | null
          bill_taxid: string
          bill_taxid_type?: string | null
          bill_taxonomy?: string | null
          bill_zip?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          pay_addr_1?: string | null
          pay_addr_2?: string | null
          pay_city?: string | null
          pay_state?: Database["public"]["Enums"]["state_code_enum"] | null
          pay_zip?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allow_privatepay?: boolean
          bill_addr_1?: string | null
          bill_addr_2?: string | null
          bill_city?: string | null
          bill_email?: string | null
          bill_name?: string
          bill_npi?: string | null
          bill_phone?: string | null
          bill_state?: Database["public"]["Enums"]["state_code_enum"] | null
          bill_taxid?: string
          bill_taxid_type?: string | null
          bill_taxonomy?: string | null
          bill_zip?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          pay_addr_1?: string | null
          pay_addr_2?: string | null
          pay_city?: string | null
          pay_state?: Database["public"]["Enums"]["state_code_enum"] | null
          pay_zip?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_info_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_locations: {
        Row: {
          accept_medicaid: boolean | null
          accept_medicare: boolean | null
          accept_new_patients: boolean | null
          ada_accessible: boolean | null
          addr_1: string | null
          addr_2: string | null
          city: string | null
          created_at: string
          credentialing_contact_email: string | null
          credentialing_contact_name: string | null
          credentialing_contact_phone: string | null
          email: string | null
          fax: string | null
          handicap_parking: boolean | null
          handicap_restroom: boolean | null
          id: string
          is_default: boolean
          is_telehealth_only: boolean
          name: string
          office_hours: Json | null
          office_manager_name: string | null
          office_manager_phone: string | null
          phone: string | null
          practice_type: string | null
          public_transportation: boolean | null
          state: Database["public"]["Enums"]["state_code_enum"] | null
          svc_npi: string | null
          svc_taxid: string | null
          svc_taxid_type: string | null
          svc_taxonomy: string | null
          tenant_id: string
          updated_at: string
          zip: string | null
        }
        Insert: {
          accept_medicaid?: boolean | null
          accept_medicare?: boolean | null
          accept_new_patients?: boolean | null
          ada_accessible?: boolean | null
          addr_1?: string | null
          addr_2?: string | null
          city?: string | null
          created_at?: string
          credentialing_contact_email?: string | null
          credentialing_contact_name?: string | null
          credentialing_contact_phone?: string | null
          email?: string | null
          fax?: string | null
          handicap_parking?: boolean | null
          handicap_restroom?: boolean | null
          id?: string
          is_default?: boolean
          is_telehealth_only?: boolean
          name: string
          office_hours?: Json | null
          office_manager_name?: string | null
          office_manager_phone?: string | null
          phone?: string | null
          practice_type?: string | null
          public_transportation?: boolean | null
          state?: Database["public"]["Enums"]["state_code_enum"] | null
          svc_npi?: string | null
          svc_taxid?: string | null
          svc_taxid_type?: string | null
          svc_taxonomy?: string | null
          tenant_id: string
          updated_at?: string
          zip?: string | null
        }
        Update: {
          accept_medicaid?: boolean | null
          accept_medicare?: boolean | null
          accept_new_patients?: boolean | null
          ada_accessible?: boolean | null
          addr_1?: string | null
          addr_2?: string | null
          city?: string | null
          created_at?: string
          credentialing_contact_email?: string | null
          credentialing_contact_name?: string | null
          credentialing_contact_phone?: string | null
          email?: string | null
          fax?: string | null
          handicap_parking?: boolean | null
          handicap_restroom?: boolean | null
          id?: string
          is_default?: boolean
          is_telehealth_only?: boolean
          name?: string
          office_hours?: Json | null
          office_manager_name?: string | null
          office_manager_phone?: string | null
          phone?: string | null
          practice_type?: string | null
          public_transportation?: boolean | null
          state?: Database["public"]["Enums"]["state_code_enum"] | null
          svc_npi?: string | null
          svc_taxid?: string | null
          svc_taxid_type?: string | null
          svc_taxonomy?: string | null
          tenant_id?: string
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "practice_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          email_verified: boolean
          failed_login_attempts: number
          id: string
          is_active: boolean
          last_login_at: string | null
          last_login_ip: string | null
          locked_until: string | null
          password: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          email_verified?: boolean
          failed_login_attempts?: number
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          last_login_ip?: string | null
          locked_until?: string | null
          password?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          email_verified?: boolean
          failed_login_attempts?: number
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          last_login_ip?: string | null
          locked_until?: string | null
          password?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      provider_applicant_followups: {
        Row: {
          applicant_id: string
          channel: string | null
          completed_at: string | null
          completed_by_profile_id: string | null
          completion_note: string | null
          created_at: string
          failure_code: string | null
          failure_detail: string | null
          followup_sequence: number
          followup_type: string
          id: string
          idempotency_key: string
          owner_profile_id: string | null
          scheduled_for: string
          source: string
          status: Database["public"]["Enums"]["provider_followup_status_enum"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          applicant_id: string
          channel?: string | null
          completed_at?: string | null
          completed_by_profile_id?: string | null
          completion_note?: string | null
          created_at?: string
          failure_code?: string | null
          failure_detail?: string | null
          followup_sequence: number
          followup_type: string
          id?: string
          idempotency_key: string
          owner_profile_id?: string | null
          scheduled_for: string
          source: string
          status?: Database["public"]["Enums"]["provider_followup_status_enum"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          applicant_id?: string
          channel?: string | null
          completed_at?: string | null
          completed_by_profile_id?: string | null
          completion_note?: string | null
          created_at?: string
          failure_code?: string | null
          failure_detail?: string | null
          followup_sequence?: number
          followup_type?: string
          id?: string
          idempotency_key?: string
          owner_profile_id?: string | null
          scheduled_for?: string
          source?: string
          status?: Database["public"]["Enums"]["provider_followup_status_enum"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_applicant_followups_applicant_id_fkey"
            columns: ["applicant_id"]
            isOneToOne: false
            referencedRelation: "provider_applicants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_applicant_followups_completed_by_profile_id_fkey"
            columns: ["completed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_applicant_followups_completed_by_profile_id_fkey"
            columns: ["completed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_applicant_followups_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_applicant_followups_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_applicant_followups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_applicants: {
        Row: {
          application_data: Json
          close_reason: string | null
          closed_at: string | null
          converted_staff_id: string | null
          created_at: string
          email: string
          first_contact_due_at: string | null
          first_contacted_at: string | null
          first_name: string
          id: string
          last_activity_at: string | null
          last_name: string
          license_type: string | null
          next_action: string | null
          next_action_due_at: string | null
          owner_profile_id: string | null
          phone: string | null
          primary_state: Database["public"]["Enums"]["state_code_enum"] | null
          profile_id: string | null
          referral_source: string | null
          source: string
          source_record_key: string | null
          status: Database["public"]["Enums"]["provider_applicant_status_enum"]
          target_states: Database["public"]["Enums"]["state_code_enum"][]
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          application_data?: Json
          close_reason?: string | null
          closed_at?: string | null
          converted_staff_id?: string | null
          created_at?: string
          email: string
          first_contact_due_at?: string | null
          first_contacted_at?: string | null
          first_name: string
          id?: string
          last_activity_at?: string | null
          last_name: string
          license_type?: string | null
          next_action?: string | null
          next_action_due_at?: string | null
          owner_profile_id?: string | null
          phone?: string | null
          primary_state?: Database["public"]["Enums"]["state_code_enum"] | null
          profile_id?: string | null
          referral_source?: string | null
          source: string
          source_record_key?: string | null
          status?: Database["public"]["Enums"]["provider_applicant_status_enum"]
          target_states?: Database["public"]["Enums"]["state_code_enum"][]
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          application_data?: Json
          close_reason?: string | null
          closed_at?: string | null
          converted_staff_id?: string | null
          created_at?: string
          email?: string
          first_contact_due_at?: string | null
          first_contacted_at?: string | null
          first_name?: string
          id?: string
          last_activity_at?: string | null
          last_name?: string
          license_type?: string | null
          next_action?: string | null
          next_action_due_at?: string | null
          owner_profile_id?: string | null
          phone?: string | null
          primary_state?: Database["public"]["Enums"]["state_code_enum"] | null
          profile_id?: string | null
          referral_source?: string | null
          source?: string
          source_record_key?: string | null
          status?: Database["public"]["Enums"]["provider_applicant_status_enum"]
          target_states?: Database["public"]["Enums"]["state_code_enum"][]
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_applicants_converted_staff_id_fkey"
            columns: ["converted_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_applicants_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_applicants_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_applicants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_applicants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_applicants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_availability_confirmations: {
        Row: {
          capacity_snapshot_id: string | null
          confirmation_cycle_key: string
          confirmed_accepting_new_clients: boolean | null
          confirmed_at: string | null
          confirmed_by_profile_id: string | null
          confirmed_preferences_version: number | null
          created_at: string
          due_at: string
          evidence: Json
          expiration_action_applied_at: string | null
          expiration_due_at: string | null
          expired_at: string | null
          id: string
          reminder_due_at: string | null
          reminder_sent_at: string | null
          requested_at: string | null
          source: string
          staff_id: string
          state: Database["public"]["Enums"]["provider_availability_confirmation_state_enum"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          capacity_snapshot_id?: string | null
          confirmation_cycle_key: string
          confirmed_accepting_new_clients?: boolean | null
          confirmed_at?: string | null
          confirmed_by_profile_id?: string | null
          confirmed_preferences_version?: number | null
          created_at?: string
          due_at: string
          evidence?: Json
          expiration_action_applied_at?: string | null
          expiration_due_at?: string | null
          expired_at?: string | null
          id?: string
          reminder_due_at?: string | null
          reminder_sent_at?: string | null
          requested_at?: string | null
          source: string
          staff_id: string
          state?: Database["public"]["Enums"]["provider_availability_confirmation_state_enum"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          capacity_snapshot_id?: string | null
          confirmation_cycle_key?: string
          confirmed_accepting_new_clients?: boolean | null
          confirmed_at?: string | null
          confirmed_by_profile_id?: string | null
          confirmed_preferences_version?: number | null
          created_at?: string
          due_at?: string
          evidence?: Json
          expiration_action_applied_at?: string | null
          expiration_due_at?: string | null
          expired_at?: string | null
          id?: string
          reminder_due_at?: string | null
          reminder_sent_at?: string | null
          requested_at?: string | null
          source?: string
          staff_id?: string
          state?: Database["public"]["Enums"]["provider_availability_confirmation_state_enum"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_availability_confirmation_confirmed_by_profile_id_fkey"
            columns: ["confirmed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_availability_confirmation_confirmed_by_profile_id_fkey"
            columns: ["confirmed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_availability_confirmations_capacity_snapshot_id_fkey"
            columns: ["capacity_snapshot_id"]
            isOneToOne: false
            referencedRelation: "provider_capacity_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_availability_confirmations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_availability_confirmations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_capacity_snapshots: {
        Row: {
          active_regular_client_count: number
          assigned_as_needed_client_count: number
          blocking_reason_codes: string[]
          calculated_at: string
          calculation_version: number
          created_at: string
          current_month_scheduled_sessions: number
          current_week_scheduled_sessions: number
          has_30_day_session_capacity: boolean
          has_active_client_capacity: boolean
          id: string
          input_hash: string
          inputs: Json
          max_active_clients: number | null
          max_daily_appointments: number | null
          max_monthly_sessions: number | null
          max_weekly_appointments: number | null
          max_weekly_sessions: number | null
          next_30_day_open_session_capacity: number | null
          next_30_day_scheduled_sessions: number
          source: string
          staff_id: string
          tenant_id: string
        }
        Insert: {
          active_regular_client_count?: number
          assigned_as_needed_client_count?: number
          blocking_reason_codes?: string[]
          calculated_at?: string
          calculation_version?: number
          created_at?: string
          current_month_scheduled_sessions?: number
          current_week_scheduled_sessions?: number
          has_30_day_session_capacity: boolean
          has_active_client_capacity: boolean
          id?: string
          input_hash: string
          inputs?: Json
          max_active_clients?: number | null
          max_daily_appointments?: number | null
          max_monthly_sessions?: number | null
          max_weekly_appointments?: number | null
          max_weekly_sessions?: number | null
          next_30_day_open_session_capacity?: number | null
          next_30_day_scheduled_sessions?: number
          source: string
          staff_id: string
          tenant_id: string
        }
        Update: {
          active_regular_client_count?: number
          assigned_as_needed_client_count?: number
          blocking_reason_codes?: string[]
          calculated_at?: string
          calculation_version?: number
          created_at?: string
          current_month_scheduled_sessions?: number
          current_week_scheduled_sessions?: number
          has_30_day_session_capacity?: boolean
          has_active_client_capacity?: boolean
          id?: string
          input_hash?: string
          inputs?: Json
          max_active_clients?: number | null
          max_daily_appointments?: number | null
          max_monthly_sessions?: number | null
          max_weekly_appointments?: number | null
          max_weekly_sessions?: number | null
          next_30_day_open_session_capacity?: number | null
          next_30_day_scheduled_sessions?: number
          source?: string
          staff_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_capacity_snapshots_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_capacity_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_contact_failure_history: {
        Row: {
          actor_profile_id: string | null
          contact_failure_id: string
          created_at: string
          event_type: string
          evidence: Json
          id: string
          new_status:
            | Database["public"]["Enums"]["provider_contact_failure_status_enum"]
            | null
          occurred_at: string
          prior_status:
            | Database["public"]["Enums"]["provider_contact_failure_status_enum"]
            | null
          reason: string | null
          source: string
          tenant_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          contact_failure_id: string
          created_at?: string
          event_type: string
          evidence?: Json
          id?: string
          new_status?:
            | Database["public"]["Enums"]["provider_contact_failure_status_enum"]
            | null
          occurred_at?: string
          prior_status?:
            | Database["public"]["Enums"]["provider_contact_failure_status_enum"]
            | null
          reason?: string | null
          source: string
          tenant_id: string
        }
        Update: {
          actor_profile_id?: string | null
          contact_failure_id?: string
          created_at?: string
          event_type?: string
          evidence?: Json
          id?: string
          new_status?:
            | Database["public"]["Enums"]["provider_contact_failure_status_enum"]
            | null
          occurred_at?: string
          prior_status?:
            | Database["public"]["Enums"]["provider_contact_failure_status_enum"]
            | null
          reason?: string | null
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_contact_failure_history_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_contact_failure_history_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_contact_failure_history_contact_failure_id_fkey"
            columns: ["contact_failure_id"]
            isOneToOne: false
            referencedRelation: "provider_contact_failures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_contact_failure_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_contact_failures: {
        Row: {
          accepting_suspension_applied_at: string | null
          client_exception_id: string | null
          client_id: string
          corrected_at: string | null
          corrected_by_profile_id: string | null
          correction_reason: string | null
          created_at: string
          evaluated_at: string
          evidence: Json
          expected_by: string
          failure_number_in_window: number
          id: string
          provider_exception_id: string | null
          qualifying_movement_at: string | null
          relationship_id: string
          source: string
          source_event_key: string
          staff_id: string
          status: Database["public"]["Enums"]["provider_contact_failure_status_enum"]
          tenant_id: string
          updated_at: string
          window_ends_at: string
          window_started_at: string
        }
        Insert: {
          accepting_suspension_applied_at?: string | null
          client_exception_id?: string | null
          client_id: string
          corrected_at?: string | null
          corrected_by_profile_id?: string | null
          correction_reason?: string | null
          created_at?: string
          evaluated_at?: string
          evidence?: Json
          expected_by: string
          failure_number_in_window: number
          id?: string
          provider_exception_id?: string | null
          qualifying_movement_at?: string | null
          relationship_id: string
          source: string
          source_event_key: string
          staff_id: string
          status?: Database["public"]["Enums"]["provider_contact_failure_status_enum"]
          tenant_id: string
          updated_at?: string
          window_ends_at: string
          window_started_at: string
        }
        Update: {
          accepting_suspension_applied_at?: string | null
          client_exception_id?: string | null
          client_id?: string
          corrected_at?: string | null
          corrected_by_profile_id?: string | null
          correction_reason?: string | null
          created_at?: string
          evaluated_at?: string
          evidence?: Json
          expected_by?: string
          failure_number_in_window?: number
          id?: string
          provider_exception_id?: string | null
          qualifying_movement_at?: string | null
          relationship_id?: string
          source?: string
          source_event_key?: string
          staff_id?: string
          status?: Database["public"]["Enums"]["provider_contact_failure_status_enum"]
          tenant_id?: string
          updated_at?: string
          window_ends_at?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_contact_failures_client_exception_id_fkey"
            columns: ["client_exception_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_contact_failures_client_exception_id_fkey"
            columns: ["client_exception_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exceptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_contact_failures_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_contact_failures_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "provider_contact_failures_corrected_by_profile_id_fkey"
            columns: ["corrected_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_contact_failures_corrected_by_profile_id_fkey"
            columns: ["corrected_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_contact_failures_provider_exception_id_fkey"
            columns: ["provider_exception_id"]
            isOneToOne: false
            referencedRelation: "provider_network_exceptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_contact_failures_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "client_staff_relationships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_contact_failures_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_contact_failures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_lifecycle_history: {
        Row: {
          actor_profile_id: string | null
          client_action_id: string
          continuity_result: Json
          created_at: string
          from_status: Database["public"]["Enums"]["clinician_status_enum"]
          id: string
          prior_version: number
          reason: string
          resulting_version: number
          staff_id: string
          tenant_id: string
          to_status: Database["public"]["Enums"]["clinician_status_enum"]
        }
        Insert: {
          actor_profile_id?: string | null
          client_action_id: string
          continuity_result?: Json
          created_at?: string
          from_status: Database["public"]["Enums"]["clinician_status_enum"]
          id?: string
          prior_version: number
          reason: string
          resulting_version: number
          staff_id: string
          tenant_id: string
          to_status: Database["public"]["Enums"]["clinician_status_enum"]
        }
        Update: {
          actor_profile_id?: string | null
          client_action_id?: string
          continuity_result?: Json
          created_at?: string
          from_status?: Database["public"]["Enums"]["clinician_status_enum"]
          id?: string
          prior_version?: number
          reason?: string
          resulting_version?: number
          staff_id?: string
          tenant_id?: string
          to_status?: Database["public"]["Enums"]["clinician_status_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "provider_lifecycle_history_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_lifecycle_history_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_lifecycle_history_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_lifecycle_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_matchability_evaluation_options: {
        Row: {
          capacity_snapshot_id: string | null
          client_id: string
          created_at: string
          evaluation_id: string
          id: string
          ranking_components: Json
          ranking_score: number | null
          reason_codes: string[]
          result_state: Database["public"]["Enums"]["provider_match_evaluation_state_enum"]
          staff_id: string
          tenant_id: string
        }
        Insert: {
          capacity_snapshot_id?: string | null
          client_id: string
          created_at?: string
          evaluation_id: string
          id?: string
          ranking_components?: Json
          ranking_score?: number | null
          reason_codes?: string[]
          result_state: Database["public"]["Enums"]["provider_match_evaluation_state_enum"]
          staff_id: string
          tenant_id: string
        }
        Update: {
          capacity_snapshot_id?: string | null
          client_id?: string
          created_at?: string
          evaluation_id?: string
          id?: string
          ranking_components?: Json
          ranking_score?: number | null
          reason_codes?: string[]
          result_state?: Database["public"]["Enums"]["provider_match_evaluation_state_enum"]
          staff_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_matchability_evaluation_opti_capacity_snapshot_id_fkey"
            columns: ["capacity_snapshot_id"]
            isOneToOne: false
            referencedRelation: "provider_capacity_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_matchability_evaluation_options_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_matchability_evaluation_options_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "provider_matchability_evaluation_options_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "provider_matchability_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_matchability_evaluation_options_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_matchability_evaluation_options_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_matchability_evaluations: {
        Row: {
          care_readiness_version: string | null
          client_age: number | null
          client_id: string
          client_state: Database["public"]["Enums"]["state_code_enum"] | null
          created_at: string
          evaluated_at: string
          evaluation_key: string
          evaluation_version: number
          expires_at: string | null
          id: string
          input_hash: string
          inputs: Json
          option_count: number
          pathway_code: string
          reason_codes: string[]
          result_state: Database["public"]["Enums"]["provider_match_evaluation_state_enum"]
          source: string
          tenant_id: string
        }
        Insert: {
          care_readiness_version?: string | null
          client_age?: number | null
          client_id: string
          client_state?: Database["public"]["Enums"]["state_code_enum"] | null
          created_at?: string
          evaluated_at?: string
          evaluation_key: string
          evaluation_version?: number
          expires_at?: string | null
          id?: string
          input_hash: string
          inputs?: Json
          option_count?: number
          pathway_code: string
          reason_codes?: string[]
          result_state: Database["public"]["Enums"]["provider_match_evaluation_state_enum"]
          source: string
          tenant_id: string
        }
        Update: {
          care_readiness_version?: string | null
          client_age?: number | null
          client_id?: string
          client_state?: Database["public"]["Enums"]["state_code_enum"] | null
          created_at?: string
          evaluated_at?: string
          evaluation_key?: string
          evaluation_version?: number
          expires_at?: string | null
          id?: string
          input_hash?: string
          inputs?: Json
          option_count?: number
          pathway_code?: string
          reason_codes?: string[]
          result_state?: Database["public"]["Enums"]["provider_match_evaluation_state_enum"]
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_matchability_evaluations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_matchability_evaluations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "provider_matchability_evaluations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_network_exception_history: {
        Row: {
          actor_profile_id: string | null
          created_at: string
          event_type: string
          evidence: Json
          exception_id: string
          id: string
          new_owner_profile_id: string | null
          new_status:
            | Database["public"]["Enums"]["provider_network_exception_status_enum"]
            | null
          occurred_at: string
          prior_owner_profile_id: string | null
          prior_status:
            | Database["public"]["Enums"]["provider_network_exception_status_enum"]
            | null
          reason: string | null
          source: string
          tenant_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          created_at?: string
          event_type: string
          evidence?: Json
          exception_id: string
          id?: string
          new_owner_profile_id?: string | null
          new_status?:
            | Database["public"]["Enums"]["provider_network_exception_status_enum"]
            | null
          occurred_at?: string
          prior_owner_profile_id?: string | null
          prior_status?:
            | Database["public"]["Enums"]["provider_network_exception_status_enum"]
            | null
          reason?: string | null
          source: string
          tenant_id: string
        }
        Update: {
          actor_profile_id?: string | null
          created_at?: string
          event_type?: string
          evidence?: Json
          exception_id?: string
          id?: string
          new_owner_profile_id?: string | null
          new_status?:
            | Database["public"]["Enums"]["provider_network_exception_status_enum"]
            | null
          occurred_at?: string
          prior_owner_profile_id?: string | null
          prior_status?:
            | Database["public"]["Enums"]["provider_network_exception_status_enum"]
            | null
          reason?: string | null
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_network_exception_history_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_network_exception_history_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_network_exception_history_exception_id_fkey"
            columns: ["exception_id"]
            isOneToOne: false
            referencedRelation: "provider_network_exceptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_network_exception_history_new_owner_profile_id_fkey"
            columns: ["new_owner_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_network_exception_history_new_owner_profile_id_fkey"
            columns: ["new_owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_network_exception_history_prior_owner_profile_id_fkey"
            columns: ["prior_owner_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_network_exception_history_prior_owner_profile_id_fkey"
            columns: ["prior_owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_network_exception_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_network_exception_reason_catalog: {
        Row: {
          applies_to_applicant: boolean
          applies_to_pathway: boolean
          applies_to_staff: boolean
          applies_to_state: boolean
          blocks_new_routing: boolean
          category: string
          created_at: string
          default_severity: Database["public"]["Enums"]["provider_network_exception_severity_enum"]
          description: string
          display_name: string
          is_active: boolean
          reason_code: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          applies_to_applicant?: boolean
          applies_to_pathway?: boolean
          applies_to_staff?: boolean
          applies_to_state?: boolean
          blocks_new_routing?: boolean
          category: string
          created_at?: string
          default_severity?: Database["public"]["Enums"]["provider_network_exception_severity_enum"]
          description: string
          display_name: string
          is_active?: boolean
          reason_code: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          applies_to_applicant?: boolean
          applies_to_pathway?: boolean
          applies_to_staff?: boolean
          applies_to_state?: boolean
          blocks_new_routing?: boolean
          category?: string
          created_at?: string
          default_severity?: Database["public"]["Enums"]["provider_network_exception_severity_enum"]
          description?: string
          display_name?: string
          is_active?: boolean
          reason_code?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      provider_network_exceptions: {
        Row: {
          applicant_id: string | null
          created_at: string
          created_by_profile_id: string | null
          dismissal_note: string | null
          dismissed_at: string | null
          dismissed_by_profile_id: string | null
          evidence: Json
          id: string
          next_action: string
          opened_at: string
          owner_profile_id: string | null
          pathway_code: string | null
          reason_code: string
          related_entity_id: string | null
          related_entity_type: string | null
          reopened_at: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by_profile_id: string | null
          review_due_at: string | null
          severity: Database["public"]["Enums"]["provider_network_exception_severity_enum"]
          source: string
          source_event_key: string | null
          staff_id: string | null
          started_at: string | null
          state_code: Database["public"]["Enums"]["state_code_enum"] | null
          status: Database["public"]["Enums"]["provider_network_exception_status_enum"]
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          applicant_id?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          dismissal_note?: string | null
          dismissed_at?: string | null
          dismissed_by_profile_id?: string | null
          evidence?: Json
          id?: string
          next_action: string
          opened_at?: string
          owner_profile_id?: string | null
          pathway_code?: string | null
          reason_code: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          reopened_at?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by_profile_id?: string | null
          review_due_at?: string | null
          severity: Database["public"]["Enums"]["provider_network_exception_severity_enum"]
          source: string
          source_event_key?: string | null
          staff_id?: string | null
          started_at?: string | null
          state_code?: Database["public"]["Enums"]["state_code_enum"] | null
          status?: Database["public"]["Enums"]["provider_network_exception_status_enum"]
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          applicant_id?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          dismissal_note?: string | null
          dismissed_at?: string | null
          dismissed_by_profile_id?: string | null
          evidence?: Json
          id?: string
          next_action?: string
          opened_at?: string
          owner_profile_id?: string | null
          pathway_code?: string | null
          reason_code?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          reopened_at?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by_profile_id?: string | null
          review_due_at?: string | null
          severity?: Database["public"]["Enums"]["provider_network_exception_severity_enum"]
          source?: string
          source_event_key?: string | null
          staff_id?: string | null
          started_at?: string | null
          state_code?: Database["public"]["Enums"]["state_code_enum"] | null
          status?: Database["public"]["Enums"]["provider_network_exception_status_enum"]
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_network_exceptions_applicant_fk"
            columns: ["applicant_id"]
            isOneToOne: false
            referencedRelation: "provider_applicants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_network_exceptions_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_network_exceptions_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_network_exceptions_dismissed_by_profile_id_fkey"
            columns: ["dismissed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_network_exceptions_dismissed_by_profile_id_fkey"
            columns: ["dismissed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_network_exceptions_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_network_exceptions_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_network_exceptions_reason_code_fkey"
            columns: ["reason_code"]
            isOneToOne: false
            referencedRelation: "provider_network_exception_reason_catalog"
            referencedColumns: ["reason_code"]
          },
          {
            foreignKeyName: "provider_network_exceptions_resolved_by_profile_id_fkey"
            columns: ["resolved_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_network_exceptions_resolved_by_profile_id_fkey"
            columns: ["resolved_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_network_exceptions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_network_exceptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_state_intelligence_configuration: {
        Row: {
          active_min_matchable_providers: number
          configuration_version: number
          created_at: string
          created_by_profile_id: string | null
          demand_weight: number
          effective_at: string
          exception_weight: number
          hold_service_block_threshold: number
          id: string
          is_active: boolean
          pathway_gap_weight: number
          recruiting_demand_threshold: number
          retired_at: string | null
          supply_gap_weight: number
          tenant_id: string
          thresholds: Json
          updated_at: string
          wait_time_weight: number
          warm_min_matchable_providers: number
        }
        Insert: {
          active_min_matchable_providers?: number
          configuration_version: number
          created_at?: string
          created_by_profile_id?: string | null
          demand_weight?: number
          effective_at?: string
          exception_weight?: number
          hold_service_block_threshold?: number
          id?: string
          is_active?: boolean
          pathway_gap_weight?: number
          recruiting_demand_threshold?: number
          retired_at?: string | null
          supply_gap_weight?: number
          tenant_id: string
          thresholds?: Json
          updated_at?: string
          wait_time_weight?: number
          warm_min_matchable_providers?: number
        }
        Update: {
          active_min_matchable_providers?: number
          configuration_version?: number
          created_at?: string
          created_by_profile_id?: string | null
          demand_weight?: number
          effective_at?: string
          exception_weight?: number
          hold_service_block_threshold?: number
          id?: string
          is_active?: boolean
          pathway_gap_weight?: number
          recruiting_demand_threshold?: number
          retired_at?: string | null
          supply_gap_weight?: number
          tenant_id?: string
          thresholds?: Json
          updated_at?: string
          wait_time_weight?: number
          warm_min_matchable_providers?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_state_intelligence_configur_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_state_intelligence_configur_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_state_intelligence_configuration_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_state_market_overrides: {
        Row: {
          created_at: string
          created_by_profile_id: string | null
          effective_at: string
          evidence: Json
          expires_at: string | null
          id: string
          override_status: Database["public"]["Enums"]["provider_state_launch_status_enum"]
          pathway_code: string | null
          reason: string
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by_profile_id: string | null
          state_code: Database["public"]["Enums"]["state_code_enum"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id?: string | null
          effective_at?: string
          evidence?: Json
          expires_at?: string | null
          id?: string
          override_status: Database["public"]["Enums"]["provider_state_launch_status_enum"]
          pathway_code?: string | null
          reason: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          state_code: Database["public"]["Enums"]["state_code_enum"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string | null
          effective_at?: string
          evidence?: Json
          expires_at?: string | null
          id?: string
          override_status?: Database["public"]["Enums"]["provider_state_launch_status_enum"]
          pathway_code?: string | null
          reason?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          state_code?: Database["public"]["Enums"]["state_code_enum"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_state_market_overrides_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_state_market_overrides_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_state_market_overrides_revoked_by_profile_id_fkey"
            columns: ["revoked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "provider_state_market_overrides_revoked_by_profile_id_fkey"
            columns: ["revoked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_state_market_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_state_market_snapshots: {
        Row: {
          accepting_provider_count: number
          active_regular_client_count: number
          average_wait_days: number | null
          blocking_exception_count: number
          calculated_at: string
          calculated_status: Database["public"]["Enums"]["provider_state_launch_status_enum"]
          calculation_version: number
          configuration_version: number
          created_at: string
          id: string
          input_hash: string
          inputs: Json
          matchable_provider_count: number
          open_provider_demand_count: number
          pathway_code: string | null
          ready_bench_provider_count: number
          reason_codes: string[]
          recruiting_priority_score: number
          source: string
          state_code: Database["public"]["Enums"]["state_code_enum"]
          tenant_id: string
          waiting_client_count: number
        }
        Insert: {
          accepting_provider_count?: number
          active_regular_client_count?: number
          average_wait_days?: number | null
          blocking_exception_count?: number
          calculated_at?: string
          calculated_status: Database["public"]["Enums"]["provider_state_launch_status_enum"]
          calculation_version: number
          configuration_version: number
          created_at?: string
          id?: string
          input_hash: string
          inputs?: Json
          matchable_provider_count?: number
          open_provider_demand_count?: number
          pathway_code?: string | null
          ready_bench_provider_count?: number
          reason_codes?: string[]
          recruiting_priority_score: number
          source: string
          state_code: Database["public"]["Enums"]["state_code_enum"]
          tenant_id: string
          waiting_client_count?: number
        }
        Update: {
          accepting_provider_count?: number
          active_regular_client_count?: number
          average_wait_days?: number | null
          blocking_exception_count?: number
          calculated_at?: string
          calculated_status?: Database["public"]["Enums"]["provider_state_launch_status_enum"]
          calculation_version?: number
          configuration_version?: number
          created_at?: string
          id?: string
          input_hash?: string
          inputs?: Json
          matchable_provider_count?: number
          open_provider_demand_count?: number
          pathway_code?: string | null
          ready_bench_provider_count?: number
          reason_codes?: string[]
          recruiting_priority_score?: number
          source?: string
          state_code?: Database["public"]["Enums"]["state_code_enum"]
          tenant_id?: string
          waiting_client_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_state_market_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_state_market_status: {
        Row: {
          accepting_provider_count: number
          active_regular_client_count: number
          average_wait_days: number | null
          blocking_exception_count: number
          calculated_at: string
          calculated_status: Database["public"]["Enums"]["provider_state_launch_status_enum"]
          calculation_version: number
          configuration_version: number
          created_at: string
          effective_status: Database["public"]["Enums"]["provider_state_launch_status_enum"]
          id: string
          input_hash: string
          matchable_provider_count: number
          open_provider_demand_count: number
          override_id: string | null
          pathway_code: string | null
          ready_bench_provider_count: number
          reason_codes: string[]
          recruiting_priority_score: number
          state_code: Database["public"]["Enums"]["state_code_enum"]
          tenant_id: string
          updated_at: string
          waiting_client_count: number
        }
        Insert: {
          accepting_provider_count?: number
          active_regular_client_count?: number
          average_wait_days?: number | null
          blocking_exception_count?: number
          calculated_at?: string
          calculated_status: Database["public"]["Enums"]["provider_state_launch_status_enum"]
          calculation_version?: number
          configuration_version: number
          created_at?: string
          effective_status: Database["public"]["Enums"]["provider_state_launch_status_enum"]
          id?: string
          input_hash: string
          matchable_provider_count?: number
          open_provider_demand_count?: number
          override_id?: string | null
          pathway_code?: string | null
          ready_bench_provider_count?: number
          reason_codes?: string[]
          recruiting_priority_score: number
          state_code: Database["public"]["Enums"]["state_code_enum"]
          tenant_id: string
          updated_at?: string
          waiting_client_count?: number
        }
        Update: {
          accepting_provider_count?: number
          active_regular_client_count?: number
          average_wait_days?: number | null
          blocking_exception_count?: number
          calculated_at?: string
          calculated_status?: Database["public"]["Enums"]["provider_state_launch_status_enum"]
          calculation_version?: number
          configuration_version?: number
          created_at?: string
          effective_status?: Database["public"]["Enums"]["provider_state_launch_status_enum"]
          id?: string
          input_hash?: string
          matchable_provider_count?: number
          open_provider_demand_count?: number
          override_id?: string | null
          pathway_code?: string | null
          ready_bench_provider_count?: number
          reason_codes?: string[]
          recruiting_priority_score?: number
          state_code?: Database["public"]["Enums"]["state_code_enum"]
          tenant_id?: string
          updated_at?: string
          waiting_client_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_state_market_status_override_fk"
            columns: ["override_id"]
            isOneToOne: false
            referencedRelation: "provider_state_market_overrides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_state_market_status_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          client_id: string
          created_at: string
          expiration_date: string | null
          id: string
          ref_name_f: string | null
          ref_name_l: string | null
          ref_name_m: string | null
          ref_npi: string | null
          referral_date: string | null
          referral_reason: string | null
          tenant_id: string
          updated_at: string
          visit_limit: number | null
        }
        Insert: {
          client_id: string
          created_at?: string
          expiration_date?: string | null
          id?: string
          ref_name_f?: string | null
          ref_name_l?: string | null
          ref_name_m?: string | null
          ref_npi?: string | null
          referral_date?: string | null
          referral_reason?: string | null
          tenant_id: string
          updated_at?: string
          visit_limit?: number | null
        }
        Update: {
          client_id?: string
          created_at?: string
          expiration_date?: string | null
          id?: string
          ref_name_f?: string | null
          ref_name_l?: string | null
          ref_name_m?: string | null
          ref_npi?: string | null
          referral_date?: string | null
          referral_reason?: string | null
          tenant_id?: string
          updated_at?: string
          visit_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "referrals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      security_password_remediation_log: {
        Row: {
          had_plaintext: boolean
          id: string
          notes: string | null
          nulled_at: string
          plaintext_length: number
          profile_id: string
          reset_email_completed_at: string | null
          reset_email_requested_at: string | null
        }
        Insert: {
          had_plaintext: boolean
          id?: string
          notes?: string | null
          nulled_at?: string
          plaintext_length: number
          profile_id: string
          reset_email_completed_at?: string | null
          reset_email_requested_at?: string | null
        }
        Update: {
          had_plaintext?: boolean
          id?: string
          notes?: string | null
          nulled_at?: string
          plaintext_length?: number
          profile_id?: string
          reset_email_completed_at?: string | null
          reset_email_requested_at?: string | null
        }
        Relationships: []
      }
      services: {
        Row: {
          category: string | null
          cpt_code: string | null
          created_at: string
          created_by_profile_id: string
          description: string | null
          duration_minutes: number | null
          id: string
          is_active: boolean
          name: string
          price_per_unit: number | null
          schedulable: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          cpt_code?: string | null
          created_at?: string
          created_by_profile_id: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean
          name: string
          price_per_unit?: number | null
          schedulable?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          cpt_code?: string | null
          created_at?: string
          created_by_profile_id?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean
          name?: string
          price_per_unit?: number | null
          schedulable?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "services_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          contract_version: number
          created_at: string
          id: string
          intl: boolean
          profile_id: string
          prov_accepting_changed_at: string | null
          prov_accepting_changed_by_profile_id: string | null
          prov_accepting_confirmation_version: number
          prov_accepting_confirmed_at: string | null
          prov_accepting_new_clients: boolean
          prov_accepting_source: string | null
          prov_addr_1: string | null
          prov_addr_2: string | null
          prov_bio: string | null
          prov_buffer_minutes: number
          prov_capacity_updated_at: string | null
          prov_city: string | null
          prov_degree: string | null
          prov_dob: string | null
          prov_field: Database["public"]["Enums"]["specialty_enum"] | null
          prov_image_alt_text: string | null
          prov_image_url: string | null
          prov_license_number: string | null
          prov_license_type: string | null
          prov_max_appointments_per_day: number | null
          prov_max_appointments_per_week: number | null
          prov_max_client_age: number | null
          prov_max_clients: number | null
          prov_max_monthly_sessions: number | null
          prov_max_weekly_sessions: number | null
          prov_min_client_age: number
          prov_name_f: string | null
          prov_name_for_clients: string | null
          prov_name_l: string | null
          prov_name_m: string | null
          prov_npi: string | null
          prov_phone: string | null
          prov_preferences_version: number
          prov_qualifier: string | null
          prov_scheduling_interval_minutes: number
          prov_self_scheduling_enabled: boolean
          prov_state: Database["public"]["Enums"]["state_code_enum"] | null
          prov_status:
            | Database["public"]["Enums"]["clinician_status_enum"]
            | null
          prov_taxid: string | null
          prov_taxid_type: string | null
          prov_taxonomy: string | null
          prov_time_zone: Database["public"]["Enums"]["time_zones"] | null
          prov_treatment_approaches: string[] | null
          prov_zip: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          contract_version?: number
          created_at?: string
          id?: string
          intl?: boolean
          profile_id: string
          prov_accepting_changed_at?: string | null
          prov_accepting_changed_by_profile_id?: string | null
          prov_accepting_confirmation_version?: number
          prov_accepting_confirmed_at?: string | null
          prov_accepting_new_clients?: boolean
          prov_accepting_source?: string | null
          prov_addr_1?: string | null
          prov_addr_2?: string | null
          prov_bio?: string | null
          prov_buffer_minutes?: number
          prov_capacity_updated_at?: string | null
          prov_city?: string | null
          prov_degree?: string | null
          prov_dob?: string | null
          prov_field?: Database["public"]["Enums"]["specialty_enum"] | null
          prov_image_alt_text?: string | null
          prov_image_url?: string | null
          prov_license_number?: string | null
          prov_license_type?: string | null
          prov_max_appointments_per_day?: number | null
          prov_max_appointments_per_week?: number | null
          prov_max_client_age?: number | null
          prov_max_clients?: number | null
          prov_max_monthly_sessions?: number | null
          prov_max_weekly_sessions?: number | null
          prov_min_client_age?: number
          prov_name_f?: string | null
          prov_name_for_clients?: string | null
          prov_name_l?: string | null
          prov_name_m?: string | null
          prov_npi?: string | null
          prov_phone?: string | null
          prov_preferences_version?: number
          prov_qualifier?: string | null
          prov_scheduling_interval_minutes?: number
          prov_self_scheduling_enabled?: boolean
          prov_state?: Database["public"]["Enums"]["state_code_enum"] | null
          prov_status?:
            | Database["public"]["Enums"]["clinician_status_enum"]
            | null
          prov_taxid?: string | null
          prov_taxid_type?: string | null
          prov_taxonomy?: string | null
          prov_time_zone?: Database["public"]["Enums"]["time_zones"] | null
          prov_treatment_approaches?: string[] | null
          prov_zip?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          contract_version?: number
          created_at?: string
          id?: string
          intl?: boolean
          profile_id?: string
          prov_accepting_changed_at?: string | null
          prov_accepting_changed_by_profile_id?: string | null
          prov_accepting_confirmation_version?: number
          prov_accepting_confirmed_at?: string | null
          prov_accepting_new_clients?: boolean
          prov_accepting_source?: string | null
          prov_addr_1?: string | null
          prov_addr_2?: string | null
          prov_bio?: string | null
          prov_buffer_minutes?: number
          prov_capacity_updated_at?: string | null
          prov_city?: string | null
          prov_degree?: string | null
          prov_dob?: string | null
          prov_field?: Database["public"]["Enums"]["specialty_enum"] | null
          prov_image_alt_text?: string | null
          prov_image_url?: string | null
          prov_license_number?: string | null
          prov_license_type?: string | null
          prov_max_appointments_per_day?: number | null
          prov_max_appointments_per_week?: number | null
          prov_max_client_age?: number | null
          prov_max_clients?: number | null
          prov_max_monthly_sessions?: number | null
          prov_max_weekly_sessions?: number | null
          prov_min_client_age?: number
          prov_name_f?: string | null
          prov_name_for_clients?: string | null
          prov_name_l?: string | null
          prov_name_m?: string | null
          prov_npi?: string | null
          prov_phone?: string | null
          prov_preferences_version?: number
          prov_qualifier?: string | null
          prov_scheduling_interval_minutes?: number
          prov_self_scheduling_enabled?: boolean
          prov_state?: Database["public"]["Enums"]["state_code_enum"] | null
          prov_status?:
            | Database["public"]["Enums"]["clinician_status_enum"]
            | null
          prov_taxid?: string | null
          prov_taxid_type?: string | null
          prov_taxonomy?: string | null
          prov_time_zone?: Database["public"]["Enums"]["time_zones"] | null
          prov_treatment_approaches?: string[] | null
          prov_zip?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "staff_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_prov_accepting_changed_by_profile_id_fkey"
            columns: ["prov_accepting_changed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "staff_prov_accepting_changed_by_profile_id_fkey"
            columns: ["prov_accepting_changed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_affiliations: {
        Row: {
          addr_1: string | null
          addr_2: string | null
          admission_percentage: number | null
          admitting_arrangement: string | null
          city: string | null
          created_at: string
          department: string | null
          end_date: string | null
          hospital_name: string
          id: string
          is_temporary: boolean | null
          is_unrestricted: boolean | null
          phone: string | null
          privilege_status: string | null
          privilege_type: string | null
          sort_order: number | null
          staff_id: string
          start_date: string | null
          state: string | null
          tenant_id: string
          updated_at: string
          zip: string | null
        }
        Insert: {
          addr_1?: string | null
          addr_2?: string | null
          admission_percentage?: number | null
          admitting_arrangement?: string | null
          city?: string | null
          created_at?: string
          department?: string | null
          end_date?: string | null
          hospital_name: string
          id?: string
          is_temporary?: boolean | null
          is_unrestricted?: boolean | null
          phone?: string | null
          privilege_status?: string | null
          privilege_type?: string | null
          sort_order?: number | null
          staff_id: string
          start_date?: string | null
          state?: string | null
          tenant_id: string
          updated_at?: string
          zip?: string | null
        }
        Update: {
          addr_1?: string | null
          addr_2?: string | null
          admission_percentage?: number | null
          admitting_arrangement?: string | null
          city?: string | null
          created_at?: string
          department?: string | null
          end_date?: string | null
          hospital_name?: string
          id?: string
          is_temporary?: boolean | null
          is_unrestricted?: boolean | null
          phone?: string | null
          privilege_status?: string | null
          privilege_type?: string | null
          sort_order?: number | null
          staff_id?: string
          start_date?: string | null
          state?: string | null
          tenant_id?: string
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_affiliations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_affiliations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_availability_schedules: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean
          staff_id: string
          start_time: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          is_active?: boolean
          staff_id: string
          start_time: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean
          staff_id?: string
          start_time?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_availability_schedules_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_availability_schedules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_calendar_blocks: {
        Row: {
          created_at: string
          end_at: string
          external_event_id: string | null
          id: string
          source: string
          staff_id: string
          start_at: string
          summary: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_at: string
          external_event_id?: string | null
          id?: string
          source?: string
          staff_id: string
          start_at: string
          summary?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_at?: string
          external_event_id?: string | null
          id?: string
          source?: string
          staff_id?: string
          start_at?: string
          summary?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_calendar_blocks_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_calendar_blocks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_calendar_connections: {
        Row: {
          access_token_encrypted: string | null
          connection_status: string
          created_at: string
          id: string
          last_error: string | null
          last_sync_at: string | null
          provider: string
          refresh_token_encrypted: string | null
          selected_calendar_id: string | null
          staff_id: string
          tenant_id: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token_encrypted?: string | null
          connection_status?: string
          created_at?: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          provider?: string
          refresh_token_encrypted?: string | null
          selected_calendar_id?: string | null
          staff_id: string
          tenant_id: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token_encrypted?: string | null
          connection_status?: string
          created_at?: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          provider?: string
          refresh_token_encrypted?: string | null
          selected_calendar_id?: string | null
          staff_id?: string
          tenant_id?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_calendar_connections_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_calendar_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_caqh_demographics: {
        Row: {
          birth_city: string | null
          birth_country: string | null
          birth_state: string | null
          caqh_id: string | null
          created_at: string
          gender: string | null
          home_addr_1: string | null
          home_addr_2: string | null
          home_city: string | null
          home_email: string | null
          home_state: string | null
          home_zip: string | null
          id: string
          is_rendering_tricare: boolean | null
          languages_spoken: string[] | null
          medicaid_number: string | null
          medicaid_provider: boolean | null
          medicare_number: string | null
          medicare_provider: boolean | null
          other_names: Json | null
          race_ethnicity: string | null
          ssn: string | null
          staff_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          birth_city?: string | null
          birth_country?: string | null
          birth_state?: string | null
          caqh_id?: string | null
          created_at?: string
          gender?: string | null
          home_addr_1?: string | null
          home_addr_2?: string | null
          home_city?: string | null
          home_email?: string | null
          home_state?: string | null
          home_zip?: string | null
          id?: string
          is_rendering_tricare?: boolean | null
          languages_spoken?: string[] | null
          medicaid_number?: string | null
          medicaid_provider?: boolean | null
          medicare_number?: string | null
          medicare_provider?: boolean | null
          other_names?: Json | null
          race_ethnicity?: string | null
          ssn?: string | null
          staff_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          birth_city?: string | null
          birth_country?: string | null
          birth_state?: string | null
          caqh_id?: string | null
          created_at?: string
          gender?: string | null
          home_addr_1?: string | null
          home_addr_2?: string | null
          home_city?: string | null
          home_email?: string | null
          home_state?: string | null
          home_zip?: string | null
          id?: string
          is_rendering_tricare?: boolean | null
          languages_spoken?: string[] | null
          medicaid_number?: string | null
          medicaid_provider?: boolean | null
          medicare_number?: string | null
          medicare_provider?: boolean | null
          other_names?: Json | null
          race_ethnicity?: string | null
          ssn?: string | null
          staff_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_caqh_demographics_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_caqh_demographics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_care_pathway_readiness: {
        Row: {
          created_at: string
          effective_at: string
          evidence: Json
          expires_at: string | null
          id: string
          pathway_code: string
          payer_code: string | null
          readiness_state: string
          region_code: string | null
          review_due_at: string | null
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by_profile_id: string | null
          source: string
          staff_id: string
          state_code: Database["public"]["Enums"]["state_code_enum"] | null
          tenant_id: string
          updated_at: string
          verified_at: string
          verified_by_profile_id: string | null
          version: number
        }
        Insert: {
          created_at?: string
          effective_at?: string
          evidence?: Json
          expires_at?: string | null
          id?: string
          pathway_code: string
          payer_code?: string | null
          readiness_state?: string
          region_code?: string | null
          review_due_at?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          source: string
          staff_id: string
          state_code?: Database["public"]["Enums"]["state_code_enum"] | null
          tenant_id: string
          updated_at?: string
          verified_at?: string
          verified_by_profile_id?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          effective_at?: string
          evidence?: Json
          expires_at?: string | null
          id?: string
          pathway_code?: string
          payer_code?: string | null
          readiness_state?: string
          region_code?: string | null
          review_due_at?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          source?: string
          staff_id?: string
          state_code?: Database["public"]["Enums"]["state_code_enum"] | null
          tenant_id?: string
          updated_at?: string
          verified_at?: string
          verified_by_profile_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_care_pathway_readiness_revoked_by_profile_id_fkey"
            columns: ["revoked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "staff_care_pathway_readiness_revoked_by_profile_id_fkey"
            columns: ["revoked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_care_pathway_readiness_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_care_pathway_readiness_verified_by_profile_id_fkey"
            columns: ["verified_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "staff_care_pathway_readiness_verified_by_profile_id_fkey"
            columns: ["verified_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_certifications: {
        Row: {
          certification_date: string | null
          certification_number: string | null
          certifying_board_code: string | null
          certifying_board_name: string
          created_at: string
          directory_listing_hmo: boolean | null
          directory_listing_pos: boolean | null
          directory_listing_ppo: boolean | null
          expiration_date: string | null
          id: string
          intended_exam_date: string | null
          is_board_certified: boolean | null
          not_certified_reason: string | null
          ranking: string | null
          recertification_date: string | null
          sort_order: number | null
          specialty: string
          specialty_code: string | null
          staff_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          certification_date?: string | null
          certification_number?: string | null
          certifying_board_code?: string | null
          certifying_board_name: string
          created_at?: string
          directory_listing_hmo?: boolean | null
          directory_listing_pos?: boolean | null
          directory_listing_ppo?: boolean | null
          expiration_date?: string | null
          id?: string
          intended_exam_date?: string | null
          is_board_certified?: boolean | null
          not_certified_reason?: string | null
          ranking?: string | null
          recertification_date?: string | null
          sort_order?: number | null
          specialty: string
          specialty_code?: string | null
          staff_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          certification_date?: string | null
          certification_number?: string | null
          certifying_board_code?: string | null
          certifying_board_name?: string
          created_at?: string
          directory_listing_hmo?: boolean | null
          directory_listing_pos?: boolean | null
          directory_listing_ppo?: boolean | null
          expiration_date?: string | null
          id?: string
          intended_exam_date?: string | null
          is_board_certified?: boolean | null
          not_certified_reason?: string | null
          ranking?: string | null
          recertification_date?: string | null
          sort_order?: number | null
          specialty?: string
          specialty_code?: string | null
          staff_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_certifications_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_certifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_clinical_routing_readiness: {
        Row: {
          created_at: string
          effective_at: string
          evidence: Json
          expires_at: string | null
          id: string
          readiness_state: Database["public"]["Enums"]["provider_clinical_readiness_state_enum"]
          reason_codes: string[]
          review_due_at: string | null
          reviewed_at: string | null
          reviewed_by_profile_id: string | null
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by_profile_id: string | null
          source: string
          staff_id: string
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          effective_at?: string
          evidence?: Json
          expires_at?: string | null
          id?: string
          readiness_state?: Database["public"]["Enums"]["provider_clinical_readiness_state_enum"]
          reason_codes?: string[]
          review_due_at?: string | null
          reviewed_at?: string | null
          reviewed_by_profile_id?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          source: string
          staff_id: string
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          effective_at?: string
          evidence?: Json
          expires_at?: string | null
          id?: string
          readiness_state?: Database["public"]["Enums"]["provider_clinical_readiness_state_enum"]
          reason_codes?: string[]
          review_due_at?: string | null
          reviewed_at?: string | null
          reviewed_by_profile_id?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          source?: string
          staff_id?: string
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_clinical_routing_readiness_reviewed_by_profile_id_fkey"
            columns: ["reviewed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "staff_clinical_routing_readiness_reviewed_by_profile_id_fkey"
            columns: ["reviewed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_clinical_routing_readiness_revoked_by_profile_id_fkey"
            columns: ["revoked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "staff_clinical_routing_readiness_revoked_by_profile_id_fkey"
            columns: ["revoked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_clinical_routing_readiness_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_clinical_routing_readiness_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_disclosures: {
        Row: {
          answer: boolean
          category: string
          created_at: string
          explanation: string | null
          explanation_date: string | null
          id: string
          question_number: number
          question_text: string
          staff_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          answer: boolean
          category: string
          created_at?: string
          explanation?: string | null
          explanation_date?: string | null
          id?: string
          question_number: number
          question_text: string
          staff_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          answer?: boolean
          category?: string
          created_at?: string
          explanation?: string | null
          explanation_date?: string | null
          id?: string
          question_number?: number
          question_text?: string
          staff_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_disclosures_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_disclosures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_education_training: {
        Row: {
          addr_1: string | null
          city: string | null
          country: string | null
          created_at: string
          degree_awarded: string | null
          department_specialty: string | null
          end_date: string | null
          entry_type: string
          graduate_type: string | null
          id: string
          institution_name: string
          is_completed: boolean | null
          program_director_name: string | null
          school_code: string | null
          sort_order: number | null
          staff_id: string
          start_date: string | null
          state: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          addr_1?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          degree_awarded?: string | null
          department_specialty?: string | null
          end_date?: string | null
          entry_type: string
          graduate_type?: string | null
          id?: string
          institution_name: string
          is_completed?: boolean | null
          program_director_name?: string | null
          school_code?: string | null
          sort_order?: number | null
          staff_id: string
          start_date?: string | null
          state?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          addr_1?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          degree_awarded?: string | null
          department_specialty?: string | null
          end_date?: string | null
          entry_type?: string
          graduate_type?: string | null
          id?: string
          institution_name?: string
          is_completed?: boolean | null
          program_director_name?: string | null
          school_code?: string | null
          sort_order?: number | null
          staff_id?: string
          start_date?: string | null
          state?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_education_training_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_education_training_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_licenses: {
        Row: {
          created_at: string
          expiration_date: string | null
          id: string
          is_active: boolean
          issue_date: string | null
          license_number: string
          license_state: Database["public"]["Enums"]["state_code_enum"]
          license_type: string
          review_due_at: string | null
          revocation_reason: string | null
          revoked_at: string | null
          staff_id: string
          tenant_id: string
          updated_at: string
          verification_evidence: Json
          verification_source: string | null
          verification_state: string
          verified_at: string | null
          verified_by_profile_id: string | null
        }
        Insert: {
          created_at?: string
          expiration_date?: string | null
          id?: string
          is_active?: boolean
          issue_date?: string | null
          license_number: string
          license_state: Database["public"]["Enums"]["state_code_enum"]
          license_type: string
          review_due_at?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          staff_id: string
          tenant_id: string
          updated_at?: string
          verification_evidence?: Json
          verification_source?: string | null
          verification_state?: string
          verified_at?: string | null
          verified_by_profile_id?: string | null
        }
        Update: {
          created_at?: string
          expiration_date?: string | null
          id?: string
          is_active?: boolean
          issue_date?: string | null
          license_number?: string
          license_state?: Database["public"]["Enums"]["state_code_enum"]
          license_type?: string
          review_due_at?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          staff_id?: string
          tenant_id?: string
          updated_at?: string
          verification_evidence?: Json
          verification_source?: string | null
          verification_state?: string
          verified_at?: string | null
          verified_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_licenses_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_licenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_licenses_verified_by_profile_id_fkey"
            columns: ["verified_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "staff_licenses_verified_by_profile_id_fkey"
            columns: ["verified_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_malpractice: {
        Row: {
          carrier_addr_1: string | null
          carrier_city: string | null
          carrier_name: string | null
          carrier_state: string | null
          carrier_zip: string | null
          claim_date_of_incident: string | null
          claim_description: string | null
          claim_settlement_amount: number | null
          claim_status: string | null
          coverage_aggregate: number | null
          coverage_per_occurrence: number | null
          coverage_type: string | null
          created_at: string
          effective_date: string | null
          entry_type: string
          expiration_date: string | null
          has_unlimited_coverage: boolean | null
          id: string
          is_self_insured: boolean | null
          original_effective_date: string | null
          policy_number: string | null
          sort_order: number | null
          staff_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          carrier_addr_1?: string | null
          carrier_city?: string | null
          carrier_name?: string | null
          carrier_state?: string | null
          carrier_zip?: string | null
          claim_date_of_incident?: string | null
          claim_description?: string | null
          claim_settlement_amount?: number | null
          claim_status?: string | null
          coverage_aggregate?: number | null
          coverage_per_occurrence?: number | null
          coverage_type?: string | null
          created_at?: string
          effective_date?: string | null
          entry_type: string
          expiration_date?: string | null
          has_unlimited_coverage?: boolean | null
          id?: string
          is_self_insured?: boolean | null
          original_effective_date?: string | null
          policy_number?: string | null
          sort_order?: number | null
          staff_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          carrier_addr_1?: string | null
          carrier_city?: string | null
          carrier_name?: string | null
          carrier_state?: string | null
          carrier_zip?: string | null
          claim_date_of_incident?: string | null
          claim_description?: string | null
          claim_settlement_amount?: number | null
          claim_status?: string | null
          coverage_aggregate?: number | null
          coverage_per_occurrence?: number | null
          coverage_type?: string | null
          created_at?: string
          effective_date?: string | null
          entry_type?: string
          expiration_date?: string | null
          has_unlimited_coverage?: boolean | null
          id?: string
          is_self_insured?: boolean | null
          original_effective_date?: string | null
          policy_number?: string | null
          sort_order?: number | null
          staff_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_malpractice_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_malpractice_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_note_preferences: {
        Row: {
          created_at: string
          id: string
          staff_id: string
          style_instructions: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          staff_id: string
          style_instructions: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          staff_id?: string
          style_instructions?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_note_preferences_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_payer_enrollments: {
        Row: {
          claim_md_response: Json | null
          created_at: string
          enroll_type: string
          enrollment_link: string | null
          error_message: string | null
          id: string
          last_attempted_at: string
          payer_id: string
          payer_name: string | null
          staff_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          claim_md_response?: Json | null
          created_at?: string
          enroll_type: string
          enrollment_link?: string | null
          error_message?: string | null
          id?: string
          last_attempted_at?: string
          payer_id: string
          payer_name?: string | null
          staff_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          claim_md_response?: Json | null
          created_at?: string
          enroll_type?: string
          enrollment_link?: string | null
          error_message?: string | null
          id?: string
          last_attempted_at?: string
          payer_id?: string
          payer_name?: string | null
          staff_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_payer_enrollments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_payer_enrollments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_rate_overrides: {
        Row: {
          created_at: string
          id: string
          rate_amount: number
          staff_id: string
          status_code: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          rate_amount: number
          staff_id: string
          status_code: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          rate_amount?: number
          staff_id?: string
          status_code?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_rate_overrides_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_rate_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_role_assignments: {
        Row: {
          created_at: string
          id: string
          staff_id: string
          staff_role_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          staff_id: string
          staff_role_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          staff_id?: string
          staff_role_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_role_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_role_assignments_staff_role_id_fkey"
            columns: ["staff_role_id"]
            isOneToOne: false
            referencedRelation: "staff_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_role_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_roles: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_clinical: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_clinical?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_clinical?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_work_history: {
        Row: {
          addr_1: string | null
          addr_2: string | null
          city: string | null
          country: string | null
          created_at: string
          employer_name: string
          end_date: string | null
          gap_explanation: string | null
          id: string
          is_current: boolean | null
          is_gap: boolean | null
          position_title: string | null
          sort_order: number | null
          staff_id: string
          start_date: string
          state: string | null
          tenant_id: string
          updated_at: string
          zip: string | null
        }
        Insert: {
          addr_1?: string | null
          addr_2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          employer_name: string
          end_date?: string | null
          gap_explanation?: string | null
          id?: string
          is_current?: boolean | null
          is_gap?: boolean | null
          position_title?: string | null
          sort_order?: number | null
          staff_id: string
          start_date: string
          state?: string | null
          tenant_id: string
          updated_at?: string
          zip?: string | null
        }
        Update: {
          addr_1?: string | null
          addr_2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          employer_name?: string
          end_date?: string | null
          gap_explanation?: string | null
          id?: string
          is_current?: boolean | null
          is_gap?: boolean | null
          position_title?: string | null
          sort_order?: number | null
          staff_id?: string
          start_date?: string
          state?: string | null
          tenant_id?: string
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_work_history_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_work_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_cpt_codes: {
        Row: {
          cpt_code_id: string
          created_at: string
          custom_rate: number | null
          id: string
          is_enabled: boolean
          modifier: string[] | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cpt_code_id: string
          created_at?: string
          custom_rate?: number | null
          id?: string
          is_enabled?: boolean
          modifier?: string[] | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cpt_code_id?: string
          created_at?: string
          custom_rate?: number | null
          id?: string
          is_enabled?: boolean
          modifier?: string[] | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_cpt_codes_cpt_code_id_fkey"
            columns: ["cpt_code_id"]
            isOneToOne: false
            referencedRelation: "cpt_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_cpt_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_financial_settings: {
        Row: {
          auto_charge_copay_on_booking: boolean
          auto_void_copay_on_cancel: boolean
          created_at: string
          max_patient_coinsurance_per_line: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auto_charge_copay_on_booking?: boolean
          auto_void_copay_on_cancel?: boolean
          created_at?: string
          max_patient_coinsurance_per_line?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auto_charge_copay_on_booking?: boolean
          auto_void_copay_on_cancel?: boolean
          created_at?: string
          max_patient_coinsurance_per_line?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_financial_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          tenant_id: string
          tenant_role: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          tenant_id: string
          tenant_role?: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          tenant_id?: string
          tenant_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "tenant_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          at_risk_days: number
          brand_accent_color: string | null
          brand_primary_color: string | null
          brand_secondary_color: string | null
          created_at: string
          display_name: string | null
          established_session_threshold: number
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          slug: string
          trial_end_date: string | null
          updated_at: string
        }
        Insert: {
          at_risk_days?: number
          brand_accent_color?: string | null
          brand_primary_color?: string | null
          brand_secondary_color?: string | null
          created_at?: string
          display_name?: string | null
          established_session_threshold?: number
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          slug: string
          trial_end_date?: string | null
          updated_at?: string
        }
        Update: {
          at_risk_days?: number
          brand_accent_color?: string | null
          brand_primary_color?: string | null
          brand_secondary_color?: string | null
          created_at?: string
          display_name?: string | null
          established_session_threshold?: number
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          slug?: string
          trial_end_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      training_videos: {
        Row: {
          cover_image_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          drive_file_id: string
          id: string
          is_active: boolean
          sort_order: number
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          drive_file_id: string
          id?: string
          is_active?: boolean
          sort_order?: number
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          drive_file_id?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_videos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_approaches: {
        Row: {
          approaches: string | null
          created_at: string
          id: number
          specialty: Database["public"]["Enums"]["specialty_enum"] | null
        }
        Insert: {
          approaches?: string | null
          created_at?: string
          id?: number
          specialty?: Database["public"]["Enums"]["specialty_enum"] | null
        }
        Update: {
          approaches?: string | null
          created_at?: string
          id?: number
          specialty?: Database["public"]["Enums"]["specialty_enum"] | null
        }
        Relationships: []
      }
      treatment_plan_private_notes: {
        Row: {
          created_at: string
          created_by_profile_id: string
          id: string
          note_content: string | null
          tenant_id: string
          treatment_plan_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          id?: string
          note_content?: string | null
          tenant_id: string
          treatment_plan_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          id?: string
          note_content?: string | null
          tenant_id?: string
          treatment_plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plan_private_notes_treatment_plan_id_fkey"
            columns: ["treatment_plan_id"]
            isOneToOne: false
            referencedRelation: "client_treatment_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vaccn_case_step_progress: {
        Row: {
          blocked_reason: string | null
          case_id: string
          completed_at: string | null
          completed_by_profile_id: string | null
          completion_note: string | null
          created_at: string
          due_at: string | null
          evidence: Json
          id: string
          owner_profile_id: string | null
          skipped_reason: string | null
          sop_step_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["vaccn_case_step_status_enum"]
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          blocked_reason?: string | null
          case_id: string
          completed_at?: string | null
          completed_by_profile_id?: string | null
          completion_note?: string | null
          created_at?: string
          due_at?: string | null
          evidence?: Json
          id?: string
          owner_profile_id?: string | null
          skipped_reason?: string | null
          sop_step_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["vaccn_case_step_status_enum"]
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          blocked_reason?: string | null
          case_id?: string
          completed_at?: string | null
          completed_by_profile_id?: string | null
          completion_note?: string | null
          created_at?: string
          due_at?: string | null
          evidence?: Json
          id?: string
          owner_profile_id?: string | null
          skipped_reason?: string | null
          sop_step_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["vaccn_case_step_status_enum"]
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "vaccn_case_step_progress_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "vaccn_registration_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccn_case_step_progress_completed_by_profile_id_fkey"
            columns: ["completed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "vaccn_case_step_progress_completed_by_profile_id_fkey"
            columns: ["completed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccn_case_step_progress_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "vaccn_case_step_progress_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccn_case_step_progress_sop_step_id_fkey"
            columns: ["sop_step_id"]
            isOneToOne: false
            referencedRelation: "vaccn_sop_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccn_case_step_progress_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccn_registration_case_history: {
        Row: {
          actor_profile_id: string | null
          case_id: string
          created_at: string
          event_type: string
          evidence: Json
          id: string
          new_status:
            | Database["public"]["Enums"]["vaccn_registration_case_status_enum"]
            | null
          occurred_at: string
          prior_status:
            | Database["public"]["Enums"]["vaccn_registration_case_status_enum"]
            | null
          reason: string | null
          source: string
          tenant_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          case_id: string
          created_at?: string
          event_type: string
          evidence?: Json
          id?: string
          new_status?:
            | Database["public"]["Enums"]["vaccn_registration_case_status_enum"]
            | null
          occurred_at?: string
          prior_status?:
            | Database["public"]["Enums"]["vaccn_registration_case_status_enum"]
            | null
          reason?: string | null
          source: string
          tenant_id: string
        }
        Update: {
          actor_profile_id?: string | null
          case_id?: string
          created_at?: string
          event_type?: string
          evidence?: Json
          id?: string
          new_status?:
            | Database["public"]["Enums"]["vaccn_registration_case_status_enum"]
            | null
          occurred_at?: string
          prior_status?:
            | Database["public"]["Enums"]["vaccn_registration_case_status_enum"]
            | null
          reason?: string | null
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vaccn_registration_case_history_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "vaccn_registration_case_history_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccn_registration_case_history_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "vaccn_registration_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccn_registration_case_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccn_registration_cases: {
        Row: {
          blocked_reason_code: string | null
          close_reason: string | null
          closed_at: string | null
          created_at: string
          external_case_reference: string | null
          id: string
          next_action: string | null
          next_action_due_at: string | null
          non_sensitive_evidence: Json
          optum_serve_required: boolean
          owner_profile_id: string | null
          ready_at: string | null
          region_code: string | null
          sensitive_evidence_location: string | null
          sop_version_id: string | null
          source: string
          source_record_key: string | null
          staff_id: string
          state_code: Database["public"]["Enums"]["state_code_enum"]
          status: Database["public"]["Enums"]["vaccn_registration_case_status_enum"]
          submitted_at: string | null
          tenant_id: string
          tpa_code: string | null
          updated_at: string
          vamc_code: string | null
          version: number
        }
        Insert: {
          blocked_reason_code?: string | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          external_case_reference?: string | null
          id?: string
          next_action?: string | null
          next_action_due_at?: string | null
          non_sensitive_evidence?: Json
          optum_serve_required?: boolean
          owner_profile_id?: string | null
          ready_at?: string | null
          region_code?: string | null
          sensitive_evidence_location?: string | null
          sop_version_id?: string | null
          source: string
          source_record_key?: string | null
          staff_id: string
          state_code: Database["public"]["Enums"]["state_code_enum"]
          status?: Database["public"]["Enums"]["vaccn_registration_case_status_enum"]
          submitted_at?: string | null
          tenant_id: string
          tpa_code?: string | null
          updated_at?: string
          vamc_code?: string | null
          version?: number
        }
        Update: {
          blocked_reason_code?: string | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          external_case_reference?: string | null
          id?: string
          next_action?: string | null
          next_action_due_at?: string | null
          non_sensitive_evidence?: Json
          optum_serve_required?: boolean
          owner_profile_id?: string | null
          ready_at?: string | null
          region_code?: string | null
          sensitive_evidence_location?: string | null
          sop_version_id?: string | null
          source?: string
          source_record_key?: string | null
          staff_id?: string
          state_code?: Database["public"]["Enums"]["state_code_enum"]
          status?: Database["public"]["Enums"]["vaccn_registration_case_status_enum"]
          submitted_at?: string | null
          tenant_id?: string
          tpa_code?: string | null
          updated_at?: string
          vamc_code?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "vaccn_registration_cases_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "vaccn_registration_cases_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccn_registration_cases_sop_version_id_fkey"
            columns: ["sop_version_id"]
            isOneToOne: false
            referencedRelation: "vaccn_sop_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccn_registration_cases_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccn_registration_cases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccn_sop_steps: {
        Row: {
          completion_criteria: Json
          created_at: string
          expected_duration_days: number | null
          id: string
          instructions: string
          is_required: boolean
          owning_role: string | null
          required_evidence_schema: Json
          requires_external_response: boolean
          sop_version_id: string
          step_key: string
          step_order: number
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          completion_criteria?: Json
          created_at?: string
          expected_duration_days?: number | null
          id?: string
          instructions: string
          is_required?: boolean
          owning_role?: string | null
          required_evidence_schema?: Json
          requires_external_response?: boolean
          sop_version_id: string
          step_key: string
          step_order: number
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          completion_criteria?: Json
          created_at?: string
          expected_duration_days?: number | null
          id?: string
          instructions?: string
          is_required?: boolean
          owning_role?: string | null
          required_evidence_schema?: Json
          requires_external_response?: boolean
          sop_version_id?: string
          step_key?: string
          step_order?: number
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vaccn_sop_steps_sop_version_id_fkey"
            columns: ["sop_version_id"]
            isOneToOne: false
            referencedRelation: "vaccn_sop_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccn_sop_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccn_sop_versions: {
        Row: {
          applicability: Json
          created_at: string
          description: string | null
          effective_at: string | null
          id: string
          published_at: string | null
          published_by_profile_id: string | null
          region_code: string | null
          retired_at: string | null
          sop_code: string
          source_references: Json
          state_codes: Database["public"]["Enums"]["state_code_enum"][]
          status: Database["public"]["Enums"]["vaccn_sop_status_enum"]
          tenant_id: string
          title: string
          tpa_code: string | null
          updated_at: string
          vamc_codes: string[]
          version_number: number
        }
        Insert: {
          applicability?: Json
          created_at?: string
          description?: string | null
          effective_at?: string | null
          id?: string
          published_at?: string | null
          published_by_profile_id?: string | null
          region_code?: string | null
          retired_at?: string | null
          sop_code: string
          source_references?: Json
          state_codes?: Database["public"]["Enums"]["state_code_enum"][]
          status?: Database["public"]["Enums"]["vaccn_sop_status_enum"]
          tenant_id: string
          title: string
          tpa_code?: string | null
          updated_at?: string
          vamc_codes?: string[]
          version_number: number
        }
        Update: {
          applicability?: Json
          created_at?: string
          description?: string | null
          effective_at?: string | null
          id?: string
          published_at?: string | null
          published_by_profile_id?: string | null
          region_code?: string | null
          retired_at?: string | null
          sop_code?: string
          source_references?: Json
          state_codes?: Database["public"]["Enums"]["state_code_enum"][]
          status?: Database["public"]["Enums"]["vaccn_sop_status_enum"]
          tenant_id?: string
          title?: string
          tpa_code?: string | null
          updated_at?: string
          vamc_codes?: string[]
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "vaccn_sop_versions_published_by_profile_id_fkey"
            columns: ["published_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "vaccn_sop_versions_published_by_profile_id_fkey"
            columns: ["published_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccn_sop_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      valorwell_credits: {
        Row: {
          applied_at: string
          capped_coinsurance: number
          claim_line_id: string
          client_id: string
          credit_amount: number
          era_adjustment_id: string
          id: string
          original_coinsurance: number
          reason: string
          tenant_id: string
        }
        Insert: {
          applied_at?: string
          capped_coinsurance: number
          claim_line_id: string
          client_id: string
          credit_amount: number
          era_adjustment_id: string
          id?: string
          original_coinsurance: number
          reason?: string
          tenant_id: string
        }
        Update: {
          applied_at?: string
          capped_coinsurance?: number
          claim_line_id?: string
          client_id?: string
          credit_amount?: number
          era_adjustment_id?: string
          id?: string
          original_coinsurance?: number
          reason?: string
          tenant_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      champva_payment_totals: {
        Row: {
          ambiguous_rows: number | null
          discrepant_rows: number | null
          era_paid_total: number | null
          period_month: string | null
          posted_rows: number | null
          report_paid_total: number | null
          tenant_id: string | null
          unmatched_rows: number | null
        }
        Relationships: []
      }
      claim_line_balances: {
        Row: {
          claim_id: string | null
          claim_line_id: string | null
          client_id: string | null
          patient_responsibility: number | null
          procedure_code: string | null
          remaining_balance: number | null
          service_date_from: string | null
          tenant_id: string | null
          total_paid: number | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_lines_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_charge_balances: {
        Row: {
          amount: number | null
          appointment_id: string | null
          charge_id: string | null
          charge_type: string | null
          client_id: string | null
          created_at: string | null
          description: string | null
          paid_amount: number | null
          remaining_balance: number | null
          staff_id: string | null
          status: string | null
          tenant_id: string | null
        }
        Insert: {
          amount?: number | null
          appointment_id?: string | null
          charge_id?: string | null
          charge_type?: string | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          paid_amount?: never
          remaining_balance?: never
          staff_id?: string | null
          status?: string | null
          tenant_id?: string | null
        }
        Update: {
          amount?: number | null
          appointment_id?: string | null
          charge_id?: string | null
          charge_type?: string | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          paid_amount?: never
          remaining_balance?: never
          staff_id?: string | null
          status?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_charges_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_charges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_charges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_charges_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_charges_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_journey_exception_current_summary: {
        Row: {
          active_exception_count: number | null
          active_exceptions: Json | null
          categories: string[] | null
          client_id: string | null
          highest_priority_next_action: string | null
          highest_priority_reason_code: string | null
          next_review_due_at: string | null
          overdue_exception_count: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_journey_exceptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_journey_exception_operations: {
        Row: {
          age_provider_fit_exception: boolean | null
          assigned_staff_id: string | null
          assigned_staff_name: string | null
          at_risk: boolean | null
          category: string | null
          client_age: number | null
          client_email: string | null
          client_id: string | null
          client_name: string | null
          client_state: string | null
          contact_policy: string | null
          created_at: string | null
          current_insurance_id: string | null
          eligibility_state: string | null
          engagement_state: string | null
          evidence: Json | null
          exception_type: string | null
          has_other_coverage: boolean | null
          id: string | null
          lifecycle_stage: string | null
          next_action: string | null
          open_duration_hours: number | null
          overdue: boolean | null
          owner_email: string | null
          owner_name: string | null
          owner_profile_id: string | null
          payer_name: string | null
          payer_order: string | null
          payer_pathway: string | null
          reason_code: string | null
          reason_detail: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          resolution_note: string | null
          resolution_state: string | null
          resolved_at: string | null
          resolved_by_profile_id: string | null
          review_due_at: string | null
          run_key: string | null
          service_policy: string | null
          source: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_journey_exceptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_resolved_by_profile_id_fkey"
            columns: ["resolved_by_profile_id"]
            isOneToOne: false
            referencedRelation: "client_journey_exception_owner_options"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_resolved_by_profile_id_fkey"
            columns: ["resolved_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_exceptions_run_key_fkey"
            columns: ["run_key"]
            isOneToOne: false
            referencedRelation: "client_journey_phase4_runs"
            referencedColumns: ["run_key"]
          },
          {
            foreignKeyName: "clients_primary_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      client_journey_exception_owner_options: {
        Row: {
          display_name: string | null
          email: string | null
          profile_id: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_outstanding_charges: {
        Row: {
          amount: number | null
          appointment_id: string | null
          client_id: string | null
          description: string | null
          paid_amount: number | null
          remaining_balance: number | null
          service_date: string | null
          source_id: string | null
          source_type: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      client_provider_demand_operations_v: {
        Row: {
          age_group: string | null
          client_age: number | null
          client_display_name: string | null
          client_id: string | null
          client_state: Database["public"]["Enums"]["state_code_enum"] | null
          contact_policy:
            | Database["public"]["Enums"]["client_contact_policy_enum"]
            | null
          created_at: string | null
          demand_id: string | null
          is_waiting: boolean | null
          last_evaluated_at: string | null
          last_evaluation_source: string | null
          last_option_count: number | null
          lifecycle_stage:
            | Database["public"]["Enums"]["client_lifecycle_stage_enum"]
            | null
          pathway_code: string | null
          provider_fit_context: Json | null
          release_notification_state: string | null
          release_notified_at: string | null
          resolution_reason: string | null
          resolved_at: string | null
          tenant_id: string | null
          updated_at: string | null
          waiting_days: number | null
          waiting_since: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_provider_demand_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_provider_demand_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_provider_demand_summary_v: {
        Row: {
          age_group: string | null
          average_wait_days: number | null
          client_state: Database["public"]["Enums"]["state_code_enum"] | null
          clients_waiting: number | null
          contactable_clients: number | null
          do_not_contact_clients: number | null
          oldest_wait_days: number | null
          oldest_waiting_since: string | null
          pathway_code: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      clinician_client_status_movement_v: {
        Row: {
          changed_at: string | null
          client_id: string | null
          history_id: string | null
          new_status: string | null
          old_status: string | null
          primary_staff_id: string | null
          reason: string | null
          source: string | null
          state_dimension:
            | Database["public"]["Enums"]["client_state_dimension_enum"]
            | null
          tenant_id: string | null
          time_in_previous_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_status_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_status_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "clients_primary_staff_id_fkey"
            columns: ["primary_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      clinician_note_compliance_v: {
        Row: {
          appointment_id: string | null
          appointment_start_at: string | null
          appointment_status:
            | Database["public"]["Enums"]["appointment_status_enum"]
            | null
          client_id: string | null
          documented_at: string | null
          is_late: boolean | null
          note_id: string | null
          note_status:
            | Database["public"]["Enums"]["appointment_note_status_enum"]
            | null
          note_type:
            | Database["public"]["Enums"]["appointment_note_type_enum"]
            | null
          signed_at: string | null
          staff_id: string | null
          tenant_id: string | null
          time_to_sign: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_clinical_notes_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_clinical_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_clinical_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "appointment_clinical_notes_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_clinical_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gad7_assessment_reporting_v: {
        Row: {
          administered_at: string | null
          assessment_date: string | null
          assessment_id: string | null
          assessment_number: number | null
          client_id: string | null
          score_change: number | null
          severity: Database["public"]["Enums"]["gad7_severity_enum"] | null
          staff_id: string | null
          tenant_id: string | null
          total_score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_gad7_assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_gad7_assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_canonical_state"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_gad7_assessments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_gad7_assessments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_recipients_safe: {
        Row: {
          account_nickname: string | null
          account_number_last4: string | null
          account_type: string | null
          created_at: string | null
          deposit_addr_1: string | null
          deposit_addr_2: string | null
          deposit_city: string | null
          deposit_state: Database["public"]["Enums"]["state_code_enum"] | null
          deposit_zip: string | null
          id: string | null
          is_active: boolean | null
          mercury_account_id: string | null
          mercury_recipient_id: string | null
          recipient_name: string | null
          routing_number_last4: string | null
          staff_id: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          account_nickname?: string | null
          account_number_last4?: string | null
          account_type?: string | null
          created_at?: string | null
          deposit_addr_1?: string | null
          deposit_addr_2?: string | null
          deposit_city?: string | null
          deposit_state?: Database["public"]["Enums"]["state_code_enum"] | null
          deposit_zip?: string | null
          id?: string | null
          is_active?: boolean | null
          mercury_account_id?: string | null
          mercury_recipient_id?: string | null
          recipient_name?: string | null
          routing_number_last4?: string | null
          staff_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          account_nickname?: string | null
          account_number_last4?: string | null
          account_type?: string | null
          created_at?: string | null
          deposit_addr_1?: string | null
          deposit_addr_2?: string | null
          deposit_city?: string | null
          deposit_state?: Database["public"]["Enums"]["state_code_enum"] | null
          deposit_zip?: string | null
          id?: string | null
          is_active?: boolean | null
          mercury_account_id?: string | null
          mercury_recipient_id?: string | null
          recipient_name?: string | null
          routing_number_last4?: string | null
          staff_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_recipients_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_recipients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_client_canonical_state: {
        Row: {
          assigned_therapist_id: string | null
          at_risk: Json | null
          care_cadence: string | null
          client_id: string | null
          concurrency_token: string | null
          contact_policy: string | null
          contract_version: string | null
          disposition_at: string | null
          disposition_reason: string | null
          eligibility: string | null
          eligibility_manual_review: Json | null
          engagement: string | null
          lifecycle: string | null
          next_appointment_at: string | null
          provider_demand_state: string | null
          service_policy: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_primary_staff_id_fkey"
            columns: ["assigned_therapist_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_crm_reports_campaigns: {
        Row: {
          bucket_end: string | null
          bucket_start: string | null
          campaign_id: string | null
          cancelled_count: number | null
          completed_count: number | null
          enrolled_count: number | null
          failed_count: number | null
          responded_count: number | null
          suppressed_count: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaign_enrollments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_enrollments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_crm_reports_closure: {
        Row: {
          bucket_end: string | null
          bucket_start: string | null
          closed_count: number | null
          disposition_reason: string | null
          net_closed: number | null
          reopened_count: number | null
          tenant_id: string | null
        }
        Relationships: []
      }
      v_crm_reports_engagement: {
        Row: {
          avg_days_to_normal: number | null
          bucket_end: string | null
          bucket_start: string | null
          current_count: number | null
          engagement: string | null
          entered_count: number | null
          tenant_id: string | null
        }
        Relationships: []
      }
      v_crm_reports_exceptions: {
        Row: {
          bucket_end: string | null
          bucket_start: string | null
          exception_type: string | null
          median_hours_to_resolve: number | null
          open_count: number | null
          raised_count: number | null
          resolved_count: number | null
          tenant_id: string | null
        }
        Relationships: []
      }
      v_crm_reports_funnel: {
        Row: {
          bucket_end: string | null
          bucket_start: string | null
          current_count: number | null
          entered_count: number | null
          exited_count: number | null
          median_days_in_stage: number | null
          stage: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      v_crm_reports_tasks: {
        Row: {
          assignee_id: string | null
          bucket_end: string | null
          bucket_start: string | null
          completed_count: number | null
          median_hours_to_complete: number | null
          open_count: number | null
          overdue_count: number | null
          tenant_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _authorize_staff_calendar_access: {
        Args: { p_staff_id: string }
        Returns: boolean
      }
      _crm_authorize_client_write: {
        Args: { _client_id: string; _concurrency_token: string }
        Returns: {
          current_cadence: Database["public"]["Enums"]["client_care_cadence_enum"]
          current_closure: Database["public"]["Enums"]["client_closure_reason_enum"]
          current_contact: Database["public"]["Enums"]["client_contact_policy_enum"]
          current_eligibility: Database["public"]["Enums"]["client_eligibility_state_enum"]
          current_engagement: Database["public"]["Enums"]["client_engagement_state_enum"]
          current_lifecycle: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
          current_service: Database["public"]["Enums"]["client_service_policy_enum"]
          current_therapist: string
          tenant_id: string
        }[]
      }
      _crm_bump_token: {
        Args: { _client_id: string; _tenant_id: string }
        Returns: undefined
      }
      _crm_cadence_from_label: {
        Args: { _label: string }
        Returns: Database["public"]["Enums"]["client_care_cadence_enum"]
      }
      _crm_closure_from_label: {
        Args: { _label: string }
        Returns: Database["public"]["Enums"]["client_closure_reason_enum"]
      }
      _crm_closure_to_label: {
        Args: { _v: Database["public"]["Enums"]["client_closure_reason_enum"] }
        Returns: string
      }
      _crm_contact_policy_from_label: {
        Args: { _label: string }
        Returns: Database["public"]["Enums"]["client_contact_policy_enum"]
      }
      _crm_contact_policy_to_label: {
        Args: { _v: Database["public"]["Enums"]["client_contact_policy_enum"] }
        Returns: string
      }
      _crm_eligibility_from_label: {
        Args: { _label: string }
        Returns: Database["public"]["Enums"]["client_eligibility_state_enum"]
      }
      _crm_eligibility_to_label: {
        Args: {
          _v: Database["public"]["Enums"]["client_eligibility_state_enum"]
        }
        Returns: string
      }
      _crm_emit_state_change: {
        Args: {
          _activity_event_type: string
          _actor: string
          _client_id: string
          _correlation_id: string
          _dimension: Database["public"]["Enums"]["client_state_dimension_enum"]
          _disposition_reason: string
          _from_value: string
          _reason: string
          _tenant_id: string
          _to_value: string
        }
        Returns: undefined
      }
      _crm_engagement_from_label: {
        Args: { _label: string }
        Returns: Database["public"]["Enums"]["client_engagement_state_enum"]
      }
      _crm_engagement_to_label: {
        Args: {
          _v: Database["public"]["Enums"]["client_engagement_state_enum"]
        }
        Returns: string
      }
      _crm_ensure_meta: {
        Args: { _client_id: string; _tenant_id: string }
        Returns: string
      }
      _crm_idem_check: {
        Args: { _actor: string; _key: string; _op: string }
        Returns: Json
      }
      _crm_idem_store: {
        Args: { _actor: string; _key: string; _op: string; _result: Json }
        Returns: undefined
      }
      _crm_lifecycle_from_label: {
        Args: { _label: string }
        Returns: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
      }
      _crm_lifecycle_to_label: {
        Args: { _v: Database["public"]["Enums"]["client_lifecycle_stage_enum"] }
        Returns: string
      }
      _crm_service_policy_from_label: {
        Args: { _label: string }
        Returns: Database["public"]["Enums"]["client_service_policy_enum"]
      }
      _crm_service_policy_to_label: {
        Args: { _v: Database["public"]["Enums"]["client_service_policy_enum"] }
        Returns: string
      }
      _payroll_line_authorize: {
        Args: { _line_id: string }
        Returns: {
          admin_approval_status: string
          mercury_status: string
          payroll_run_id: string
          staff_approval_status: string
          tenant_id: string
          updated_at: string
        }[]
      }
      _require_current_client_id: { Args: never; Returns: string }
      acknowledge_client_insurance_deferment:
        | {
            Args: { p_client_id: string; p_eligibility_check_id: string }
            Returns: Json
          }
        | { Args: { p_eligibility_check_id: string }; Returns: Json }
      admin_override_client_state: {
        Args: {
          p_actor_profile_id?: string
          p_client_id: string
          p_new_value: string
          p_reason: string
          p_state_dimension: Database["public"]["Enums"]["client_state_dimension_enum"]
        }
        Returns: Json
      }
      admin_set_client_care_cadence: {
        Args: {
          p_care_cadence: Database["public"]["Enums"]["client_care_cadence_enum"]
          p_client_id: string
          p_reason: string
        }
        Returns: undefined
      }
      admin_transition_provider_lifecycle: {
        Args: {
          p_client_action_id: string
          p_from: Database["public"]["Enums"]["clinician_status_enum"]
          p_prior_version: number
          p_reason: string
          p_staff_id: string
          p_to: Database["public"]["Enums"]["clinician_status_enum"]
        }
        Returns: Json
      }
      advance_client_intake_if_ready:
        | { Args: never; Returns: Json }
        | { Args: { p_client_id: string }; Returns: Json }
      approve_payroll_line_item: {
        Args: {
          p_dispute_reason?: string
          p_line_item_id: string
          p_status: string
        }
        Returns: Json
      }
      assign_client_clinician: {
        Args: {
          client_id: string
          concurrency_token: string
          contract_version: string
          idempotency_key?: string
          reason: string
          staff_id: string
          tenant_id: string
        }
        Returns: Json
      }
      assign_client_journey_exception: {
        Args: {
          p_client_action_id: string
          p_exception_id: string
          p_note: string
          p_owner_profile_id: string
          p_prior_version: number
        }
        Returns: Json
      }
      autocreate_copay_for_appointment: {
        Args: { p_appointment_id: string }
        Returns: undefined
      }
      backfill_coinsurance_cap: { Args: { p_tenant_id: string }; Returns: Json }
      backfill_copay_charges: {
        Args: { p_tenant_id?: string }
        Returns: number
      }
      book_client_appointment: {
        Args: { p_slot_end_utc?: string; p_slot_start_utc: string }
        Returns: Json
      }
      cancel_appointment: {
        Args: {
          p_appointment_id: string
          p_client_action_id: string
          p_kind: string
          p_prior_version: number
          p_reason: string
        }
        Returns: Json
      }
      cancel_recurring_appointment_series: {
        Args: {
          p_client_action_id: string
          p_prior_version: number
          p_reason: string
          p_series_id: string
        }
        Returns: Json
      }
      check_assessments_due:
        | {
            Args: never
            Returns: {
              assessment_type: string
              days_since_last: number
              is_due: boolean
              last_completed_at: string
              next_due_at: string
              recurrence_days: number
            }[]
          }
        | {
            Args: { p_client_id: string }
            Returns: {
              assessment_type: string
              days_since_last: number
              is_due: boolean
              last_completed_at: string
              next_due_at: string
              recurrence_days: number
            }[]
          }
      check_staff_availability: {
        Args: { p_end: string; p_staff_id: string; p_start: string }
        Returns: boolean
      }
      claim_pending_campaign_steps: {
        Args: { p_limit?: number }
        Returns: {
          channel: string
          claim_token: string
          client_id: string
          enrollment_id: string
          id: string
          scheduled_for: string
          step_id: string
          tenant_id: string
        }[]
      }
      client_closure:
        | {
            Args: {
              p_client_action_id: string
              p_client_id: string
              p_confirmed: boolean
              p_disposition: string
              p_prior_version: number
              p_reason: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_client_action_id: string
              p_confirmed: boolean
              p_disposition: string
              p_prior_version: number
              p_reason: string
            }
            Returns: Json
          }
      client_correction:
        | {
            Args: {
              p_client_action_id: string
              p_client_id: string
              p_patch: Json
              p_prior_version: number
              p_reason: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_client_action_id: string
              p_patch: Json
              p_prior_version: number
              p_reason: string
            }
            Returns: Json
          }
      client_lifecycle_transition_source_allowed: {
        Args: {
          p_current: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
          p_source: string
          p_target: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
        }
        Returns: boolean
      }
      client_portal_fetch_authenticated_context: { Args: never; Returns: Json }
      client_reactivation:
        | {
            Args: {
              p_client_action_id: string
              p_client_id: string
              p_prior_version: number
              p_reason: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_client_action_id: string
              p_prior_version: number
              p_reason: string
            }
            Returns: Json
          }
      client_reassign:
        | {
            Args: {
              p_client_action_id: string
              p_client_id: string
              p_new_staff_id: string
              p_prior_version: number
              p_reason: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_client_action_id: string
              p_new_staff_id: string
              p_prior_version: number
              p_reason: string
            }
            Returns: Json
          }
      client_state_engine_authorize: {
        Args: {
          p_actor_profile_id: string
          p_admin_override?: boolean
          p_operation: string
          p_reason: string
          p_source: string
        }
        Returns: string
      }
      client_state_engine_begin_context: {
        Args: { p_actor_profile_id: string; p_reason: string; p_source: string }
        Returns: Json
      }
      client_state_engine_restore_context: {
        Args: { p_previous: Json }
        Returns: undefined
      }
      client_state_engine_snapshot: {
        Args: { p_client_id: string }
        Returns: Json
      }
      client_state_engine_source_allowed: {
        Args: { p_operation: string; p_source: string }
        Returns: boolean
      }
      close_client_journey: {
        Args: {
          p_actor_profile_id?: string
          p_admin_override?: boolean
          p_client_id: string
          p_closure_reason: Database["public"]["Enums"]["client_closure_reason_enum"]
          p_reason?: string
          p_source: string
        }
        Returns: Json
      }
      commit_champva_payment_report_rows: {
        Args: { p_document: Json; p_rows: Json; p_tenant_id: string }
        Returns: Json
      }
      commit_claimmd_era: {
        Args: {
          p_adjustments?: Json
          p_claims?: Json
          p_header: Json
          p_service_lines?: Json
          p_source_era_id: string
          p_source_record_hash: string
          p_tenant_id: string
        }
        Returns: Json
      }
      complete_client_registration:
        | {
            Args: {
              p_client_id: string
              p_goals: string
              p_marital_status?: string
              p_referral_source: string
              p_ssn?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_goals: string
              p_marital_status: string
              p_referral_source: string
              p_ssn: string
            }
            Returns: Json
          }
      confirm_accepting_status: {
        Args: { p_client_action_id: string }
        Returns: Json
      }
      convert_local_to_utc: {
        Args: { p_date: string; p_time: string; p_timezone?: string }
        Returns: string
      }
      correct_appointment: {
        Args: {
          p_appointment_id: string
          p_client_action_id: string
          p_patch: Json
          p_prior_version: number
          p_reason: string
        }
        Returns: Json
      }
      create_appointment: {
        Args: {
          p_client_action_id?: string
          p_client_id: string
          p_end_at: string
          p_is_telehealth: boolean
          p_prior_slot_token?: string
          p_service_code: string
          p_staff_id: string
          p_start_at: string
        }
        Returns: Json
      }
      create_claim_draft: {
        Args: { p_client_action_id?: string; p_payload: Json }
        Returns: Json
      }
      create_client_account: {
        Args: {
          p_client_action_id: string
          p_client_id: string
          p_reason: string
        }
        Returns: Json
      }
      create_client_journey_exception:
        | {
            Args: {
              p_client_action_id: string
              p_client_id: string
              p_next_action: string
              p_owner_profile_id: string
              p_reason_code: string
              p_reason_detail: string
              p_review_due_at: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_category: string
              p_client_id: string
              p_evidence?: Json
              p_next_action: string
              p_owner_profile_id?: string
              p_reason_code: string
              p_reason_detail: string
              p_related_entity_id?: string
              p_related_entity_type?: string
              p_review_due_at: string
              p_source?: string
              p_tenant_id: string
            }
            Returns: {
              category: string
              client_id: string
              created_at: string
              created_by_profile_id: string | null
              evidence: Json
              exception_type: string
              id: string
              next_action: string
              owner_profile_id: string | null
              reason_code: string
              reason_detail: string
              related_entity_id: string | null
              related_entity_type: string | null
              resolution_note: string | null
              resolution_state: string
              resolved_at: string | null
              resolved_by_profile_id: string | null
              review_due_at: string
              run_key: string | null
              source: string
              tenant_id: string
              updated_at: string
              version: number
            }
            SetofOptions: {
              from: "*"
              to: "client_journey_exceptions"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      create_corrected_claim: {
        Args: { p_client_action_id: string; p_original_claim_id: string }
        Returns: Json
      }
      create_recurring_appointment_series: {
        Args: {
          p_client_action_id: string
          p_client_id: string
          p_duration_minutes: number
          p_is_telehealth: boolean
          p_max_occurrences: number
          p_rrule: string
          p_series_end_date: string
          p_service_code: string
          p_staff_id: string
          p_start_at: string
          p_time_zone: string
        }
        Returns: Json
      }
      crm_apply_remove: {
        Args: {
          p_client_id: string
          p_correlation_id: string
          p_source: string
          p_tenant_id: string
        }
        Returns: Json
      }
      crm_assign_clinician: {
        Args: {
          p_client_id: string
          p_concurrency_token?: string
          p_contract_version?: string
          p_idempotency_key?: string
          p_reason: string
          p_staff_id: string
        }
        Returns: Json
      }
      crm_bulk_update_client_status: {
        Args: {
          p_actor_profile_id: string
          p_client_ids: string[]
          p_new_status: Database["public"]["Enums"]["pat_status_enum"]
          p_tenant_id: string
        }
        Returns: {
          client_id: string
          new_status: Database["public"]["Enums"]["pat_status_enum"]
          old_status: Database["public"]["Enums"]["pat_status_enum"]
        }[]
      }
      crm_close_client: {
        Args: {
          p_client_id: string
          p_concurrency_token?: string
          p_contract_version?: string
          p_disposition_reason: string
          p_idempotency_key?: string
          p_reason: string
        }
        Returns: Json
      }
      crm_enroll_clients_in_campaign: {
        Args: {
          p_campaign_id: string
          p_client_ids: string[]
          p_contract_version: string
          p_idempotency_key: string
          p_reason: string
        }
        Returns: Json
      }
      crm_evaluate_communication_policy: {
        Args: {
          p_channel: string
          p_client_id: string
          p_message_class: string
        }
        Returns: Json
      }
      crm_has_role:
        | {
            Args: { _roles: string[]; _tenant_id: string; _user_id: string }
            Returns: boolean
          }
        | { Args: { _tenant_id: string; _user_id: string }; Returns: boolean }
      crm_reopen_client: {
        Args: {
          p_client_id: string
          p_concurrency_token?: string
          p_contract_version?: string
          p_idempotency_key?: string
          p_reason: string
        }
        Returns: Json
      }
      crm_save_campaign_steps: {
        Args: { p_campaign_id: string; p_steps: Json; p_tenant_id: string }
        Returns: {
          campaign_id: string
          channel: string
          created_at: string
          delay_days: number
          delay_hours: number
          email_body_html: string | null
          email_subject: string | null
          id: string
          is_active: boolean
          signature_id: string | null
          sms_body_text: string | null
          step_order: number
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "crm_campaign_steps"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      crm_select_operating_tenant: {
        Args: { p_tenant_id: string }
        Returns: Json
      }
      crm_set_care_cadence: {
        Args: {
          p_client_id: string
          p_concurrency_token?: string
          p_contract_version?: string
          p_idempotency_key?: string
          p_reason: string
          p_to_cadence: string
        }
        Returns: Json
      }
      crm_set_contact_policy: {
        Args: {
          p_client_id: string
          p_concurrency_token?: string
          p_contract_version?: string
          p_idempotency_key?: string
          p_reason: string
          p_to_policy: string
        }
        Returns: Json
      }
      crm_set_eligibility: {
        Args: {
          p_client_id: string
          p_concurrency_token?: string
          p_contract_version?: string
          p_idempotency_key?: string
          p_manual_review?: Json
          p_reason?: string
          p_to_state: string
        }
        Returns: Json
      }
      crm_set_engagement: {
        Args: {
          p_client_id: string
          p_concurrency_token?: string
          p_contract_version?: string
          p_idempotency_key?: string
          p_reason: string
          p_to_state: string
        }
        Returns: Json
      }
      crm_set_service_policy: {
        Args: {
          p_client_id: string
          p_concurrency_token?: string
          p_contract_version?: string
          p_idempotency_key?: string
          p_reason: string
          p_to_policy: string
        }
        Returns: Json
      }
      crm_transition_lifecycle: {
        Args: {
          p_client_id: string
          p_concurrency_token?: string
          p_contract_version?: string
          p_disposition_reason?: string
          p_idempotency_key?: string
          p_reason: string
          p_to_stage: string
        }
        Returns: Json
      }
      current_client_id: { Args: never; Returns: string }
      dismiss_champva_row: {
        Args: { p_reason: string; p_row_id: string }
        Returns: undefined
      }
      document_appointment: {
        Args: {
          p_appointment_id: string
          p_client_action_id: string
          p_prior_version: number
        }
        Returns: Json
      }
      evaluate_intake_screening: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      execute_payroll_payment: {
        Args: { p_client_action_id: string; p_payroll_run_id: string }
        Returns: Json
      }
      execute_payroll_payment_v2: {
        Args: {
          p_actor_profile_id: string
          p_client_action_id: string
          p_payroll_run_id: string
        }
        Returns: Json
      }
      finalize_claim_submission: {
        Args: { p_request_id: string; p_result?: Json; p_status: string }
        Returns: undefined
      }
      find_clients_by_emails_insensitive: {
        Args: { p_emails: string[]; p_tenant_id: string }
        Returns: {
          email: string
          id: string
        }[]
      }
      format_timestamp_in_timezone: {
        Args: { p_format?: string; p_timestamp: string; p_timezone: string }
        Returns: string
      }
      generate_payroll_run:
        | {
            Args: {
              p_appointment_logs: Json
              p_line_items: Json
              p_period_end: string
              p_period_start: string
              p_staff_approval_deadline: string
              p_tenant_id: string
              p_totals: Json
              p_triggered_by: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_appointment_logs: Json
              p_external_reference?: string
              p_line_items: Json
              p_period_end: string
              p_period_start: string
              p_run_type?: string
              p_staff_approval_deadline: string
              p_tenant_id: string
              p_totals: Json
              p_triggered_by: string
            }
            Returns: Json
          }
      get_assigned_clients: { Args: never; Returns: Json }
      get_available_appointment_slots:
        | {
            Args: {
              p_client_id: string
              p_duration_minutes: number
              p_from_date: string
              p_service_code: string
              p_staff_id: string
              p_to_date: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_client_timezone: string
              p_duration_minutes?: number
              p_staff_id: string
              p_target_date: string
            }
            Returns: {
              display_date: string
              display_end_time: string
              display_time: string
              slot_end_utc: string
              slot_start_utc: string
            }[]
          }
      get_billing_identity_context: { Args: never; Returns: Json }
      get_claim_line_pr_breakdown: {
        Args: { p_claim_line_id: string }
        Returns: Json
      }
      get_client_appointments_display:
        | {
            Args: {
              p_client_id: string
              p_days_ahead?: number
              p_target_timezone?: string
            }
            Returns: {
              display_date: string
              display_end_time: string
              display_time: string
              display_timezone: string
              end_at: string
              id: string
              is_telehealth: boolean
              is_today: boolean
              location_name: string
              service_duration: number
              service_id: string
              service_name: string
              staff_id: string
              start_at: string
              status: Database["public"]["Enums"]["appointment_status_enum"]
              tenant_id: string
              therapist_name: string
              videoroom_url: string
            }[]
          }
        | {
            Args: {
              p_client_id: string
              p_from_date?: string
              p_target_timezone?: string
              p_to_date?: string
            }
            Returns: {
              display_date: string
              display_end_time: string
              display_time: string
              display_timezone: string
              end_at: string
              id: string
              is_telehealth: boolean
              location_name: string
              service_duration: number
              service_id: string
              service_name: string
              staff_id: string
              start_at: string
              status: Database["public"]["Enums"]["appointment_status_enum"]
              tenant_id: string
              therapist_name: string
              videoroom_url: string
            }[]
          }
      get_client_appointments_display_self: {
        Args: { p_days_ahead?: number; p_target_timezone?: string }
        Returns: {
          display_date: string
          display_end_time: string
          display_time: string
          display_timezone: string
          end_at: string
          id: string
          is_telehealth: boolean
          is_today: boolean
          location_name: string
          service_duration: number
          service_id: string
          service_name: string
          staff_id: string
          start_at: string
          status: Database["public"]["Enums"]["appointment_status_enum"]
          tenant_id: string
          therapist_name: string
          videoroom_url: string
        }[]
      }
      get_client_balance_summary:
        | {
            Args: never
            Returns: {
              claim_count: number
              newest_service_date: string
              oldest_service_date: string
              remaining_balance: number
              total_paid: number
              total_responsibility: number
            }[]
          }
        | {
            Args: { p_client_id: string }
            Returns: {
              claim_count: number
              newest_service_date: string
              oldest_service_date: string
              remaining_balance: number
              total_paid: number
              total_responsibility: number
            }[]
          }
      get_client_canonical_state: {
        Args: { p_client_id: string }
        Returns: Json
      }
      get_client_care_readiness:
        | {
            Args: never
            Returns: {
              care_requirements_complete: boolean
              client_id: string
              emergency_contact_complete: boolean
              evidence: Json
              insurance_pathway_ready: boolean
              intake_complete: boolean
              intake_form_complete: boolean
              is_minor: boolean
              lifecycle_stage: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
              missing_gates: string[]
              pathway_code: string
              payer_order_clear: boolean
              registration_complete: boolean
              required_consents_complete: boolean
              service_allowed: boolean
              tenant_id: string
              therapist_selection_ready: boolean
            }[]
          }
        | {
            Args: { p_client_id: string }
            Returns: {
              care_requirements_complete: boolean
              client_id: string
              emergency_contact_complete: boolean
              evidence: Json
              insurance_pathway_ready: boolean
              intake_complete: boolean
              intake_form_complete: boolean
              is_minor: boolean
              lifecycle_stage: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
              missing_gates: string[]
              pathway_code: string
              payer_order_clear: boolean
              registration_complete: boolean
              required_consents_complete: boolean
              service_allowed: boolean
              tenant_id: string
              therapist_selection_ready: boolean
            }[]
          }
      get_client_claim_line_breakdown: {
        Args: { p_claim_line_id: string }
        Returns: Json
      }
      get_client_insurance_eligibility_status:
        | { Args: never; Returns: Json }
        | { Args: { p_client_id: string }; Returns: Json }
      get_client_outstanding_items:
        | {
            Args: never
            Returns: {
              amount: number
              description: string
              item_id: string
              item_type: string
              paid: number
              remaining: number
              service_date: string
              tenant_id: string
            }[]
          }
        | {
            Args: { p_client_id: string }
            Returns: {
              amount: number
              description: string
              item_id: string
              item_type: string
              paid: number
              remaining: number
              service_date: string
              tenant_id: string
            }[]
          }
      get_crm_operating_context: { Args: never; Returns: Json }
      get_documented_session_status: {
        Args: { p_appointment_id: string }
        Returns: Json
      }
      get_eligible_therapists_for_client:
        | {
            Args: never
            Returns: {
              id: string
              licenses: Json
              pathway_code: string
              prov_bio: string
              prov_image_url: string
              prov_max_client_age: number
              prov_min_client_age: number
              prov_name_f: string
              prov_name_for_clients: string
              prov_name_l: string
              prov_scheduling_interval_minutes: number
              prov_self_scheduling_enabled: boolean
              prov_treatment_approaches: string[]
              scheduling_branch: string
            }[]
          }
        | {
            Args: { p_client_id: string }
            Returns: {
              id: string
              licenses: Json
              pathway_code: string
              prov_bio: string
              prov_image_url: string
              prov_max_client_age: number
              prov_min_client_age: number
              prov_name_f: string
              prov_name_for_clients: string
              prov_name_l: string
              prov_scheduling_interval_minutes: number
              prov_self_scheduling_enabled: boolean
              prov_treatment_approaches: string[]
              scheduling_branch: string
            }[]
          }
      get_now_in_timezone: {
        Args: { p_timezone?: string }
        Returns: {
          now_day: number
          now_hour: number
          now_minute: number
          now_month: number
          now_year: number
          today_date: string
        }[]
      }
      get_permitted_client_actions: { Args: never; Returns: Json }
      get_provider_calculated_capacity: {
        Args: { p_staff_id: string }
        Returns: Json
      }
      get_provider_contact_failure_view: {
        Args: { p_staff_id: string }
        Returns: Json
      }
      get_provider_readiness_view: {
        Args: { p_staff_id: string }
        Returns: Json
      }
      get_revenue_report:
        | {
            Args: {
              p_cpt_code?: string
              p_end_date?: string
              p_payor?: string
              p_staff_id?: string
              p_start_date?: string
              p_taxonomy?: string
              p_tenant_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_cpt_code?: string
              p_end_date?: string
              p_paid_by?: string
              p_payor?: string
              p_revenue_type?: string
              p_staff_id?: string
              p_start_date?: string
              p_taxonomy?: string
              p_tenant_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_cpt_code?: string
              p_end_date?: string
              p_paid_by?: string
              p_patient_id?: string
              p_payor?: string
              p_revenue_type?: string
              p_staff_id?: string
              p_start_date?: string
              p_taxonomy?: string
              p_tenant_id: string
            }
            Returns: Json
          }
      get_revenue_report_lines:
        | {
            Args: {
              p_cpt_code?: string
              p_end_date?: string
              p_paid_by?: string
              p_payor?: string
              p_revenue_type?: string
              p_staff_id?: string
              p_start_date?: string
              p_taxonomy?: string
              p_tenant_id: string
            }
            Returns: {
              allowed_amount: number
              charge_amount: number
              claim_id: string
              claim_line_id: string
              claim_status: string
              client_name: string
              paid_amount: number
              patient_responsibility: number
              payment_date: string
              payor_name: string
              procedure_code: string
              service_date: string
              source: string
              staff_name: string
            }[]
          }
        | {
            Args: {
              p_cpt_code?: string
              p_end_date?: string
              p_paid_by?: string
              p_patient_id?: string
              p_payor?: string
              p_revenue_type?: string
              p_staff_id?: string
              p_start_date?: string
              p_taxonomy?: string
              p_tenant_id: string
            }
            Returns: {
              allowed_amount: number
              charge_amount: number
              claim_id: string
              claim_line_id: string
              claim_status: string
              client_name: string
              paid_amount: number
              patient_responsibility: number
              payment_date: string
              payor_name: string
              procedure_code: string
              service_date: string
              source: string
              staff_name: string
            }[]
          }
      get_staff_calendar_appointments:
        | {
            Args: { p_from_date?: string; p_to_date?: string }
            Returns: {
              client_id: string
              client_legal_name: string
              client_name: string
              clinician_name: string
              created_at: string
              display_date: string
              display_end_time: string
              display_time: string
              display_timezone: string
              end_at: string
              end_hour: number
              end_minute: number
              id: string
              is_telehealth: boolean
              location_name: string
              series_id: string
              service_id: string
              service_name: string
              staff_id: string
              start_at: string
              start_day: number
              start_hour: number
              start_minute: number
              start_month: number
              start_year: number
              status: string
              tenant_id: string
              time_zone: string
              updated_at: string
              videoroom_url: string
            }[]
          }
        | {
            Args: {
              p_from_date?: string
              p_staff_id: string
              p_to_date?: string
            }
            Returns: {
              client_id: string
              client_legal_name: string
              client_name: string
              clinician_name: string
              created_at: string
              display_date: string
              display_end_time: string
              display_time: string
              display_timezone: string
              end_at: string
              end_hour: number
              end_minute: number
              id: string
              is_telehealth: boolean
              location_name: string
              series_id: string
              service_id: string
              service_name: string
              staff_id: string
              start_at: string
              start_day: number
              start_hour: number
              start_minute: number
              start_month: number
              start_year: number
              status: string
              tenant_id: string
              time_zone: string
              updated_at: string
              videoroom_url: string
            }[]
          }
      get_staff_calendar_blocks:
        | {
            Args: { p_from_date?: string }
            Returns: {
              end_at: string
              end_day: number
              end_hour: number
              end_minute: number
              end_month: number
              end_year: number
              id: string
              source: string
              staff_id: string
              start_at: string
              start_day: number
              start_hour: number
              start_minute: number
              start_month: number
              start_year: number
              summary: string
            }[]
          }
        | {
            Args: { p_from_date?: string; p_staff_id: string }
            Returns: {
              end_at: string
              end_day: number
              end_hour: number
              end_minute: number
              end_month: number
              end_year: number
              id: string
              source: string
              staff_id: string
              start_at: string
              start_day: number
              start_hour: number
              start_minute: number
              start_month: number
              start_year: number
              summary: string
            }[]
          }
      get_staff_id_for_user: { Args: { p_user_id: string }; Returns: string }
      get_staff_operating_context: { Args: never; Returns: Json }
      has_billing_role: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff_or_admin: { Args: { _user_id: string }; Returns: boolean }
      is_tenant_admin: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      is_tenant_member: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      manual_match_champva_row: {
        Args: { p_claim_line_id: string; p_row_id: string }
        Returns: Json
      }
      mark_appointment_not_billable: {
        Args: {
          p_appointment_id: string
          p_client_action_id?: string
          p_reason?: string
        }
        Returns: Json
      }
      mark_at_risk_clients: { Args: { p_tenant_id: string }; Returns: number }
      match_champva_payment_rows: {
        Args: { p_document_id: string }
        Returns: Json
      }
      payroll_admin_approve_line: {
        Args: {
          p_client_action_id?: string
          p_line_item_id: string
          p_prior_updated_at: string
        }
        Returns: Json
      }
      payroll_admin_bulk_approve_run: {
        Args: { p_client_action_id?: string; p_payroll_run_id: string }
        Returns: Json
      }
      payroll_admin_reject_line: {
        Args: {
          p_client_action_id?: string
          p_line_item_id: string
          p_prior_updated_at: string
          p_reason?: string
        }
        Returns: Json
      }
      payroll_admin_reset_line_for_retry: {
        Args: { p_client_action_id?: string; p_line_item_id: string }
        Returns: Json
      }
      payroll_admin_resolve_dispute: {
        Args: {
          p_client_action_id?: string
          p_decision: string
          p_line_item_id: string
          p_notes: string
          p_prior_updated_at: string
        }
        Returns: Json
      }
      payroll_staff_approve_line: {
        Args: {
          p_client_action_id?: string
          p_line_item_id: string
          p_prior_updated_at: string
        }
        Returns: Json
      }
      payroll_staff_dispute_line: {
        Args: {
          p_client_action_id?: string
          p_line_item_id: string
          p_prior_updated_at: string
          p_reason: string
        }
        Returns: Json
      }
      post_champva_report_evidence: {
        Args: { p_document_id: string }
        Returns: Json
      }
      recompute_claim_line_financial_state: {
        Args: { p_claim_line_id: string }
        Returns: undefined
      }
      reconcile_claim_line_evidence: {
        Args: { p_claim_line_id: string }
        Returns: undefined
      }
      reconcile_payroll_line_items_from_attempts: {
        Args: { p_payroll_run_id: string }
        Returns: Json
      }
      reconcile_stalled_bulk_jobs: { Args: never; Returns: undefined }
      record_client_eligibility_result: {
        Args: {
          p_claimmd_eligibility_id?: string
          p_client_id: string
          p_client_insurance_id: string
          p_coverage_end?: string
          p_coverage_start?: string
          p_error_codes?: string[]
          p_has_other_coverage?: boolean
          p_outcome: string
          p_payer_order_detected?: string
          p_recorded_by_profile_id?: string
          p_request_fingerprint?: Json
          p_response_message?: string
          p_result_metadata?: Json
          p_service_date?: string
        }
        Returns: Json
      }
      record_payroll_payment_result: {
        Args: {
          p_attempt_ended_at: string
          p_attempt_started_at: string
          p_body_preview: string
          p_duration_ms: number
          p_error_class: string
          p_error_message: string
          p_execution_log_id: string
          p_idempotency_key: string
          p_line_item_id: string
          p_mercury_transaction_id: string
          p_new_status: string
          p_proxy_content_type: string
          p_proxy_http_status: number
        }
        Returns: Json
      }
      reevaluate_client_provider_demand: {
        Args: {
          p_client_action_id: string
          p_demand_id: string
          p_prior_version: number
          p_reason: string
        }
        Returns: Json
      }
      refresh_client_ages: { Args: never; Returns: number }
      release_campaign_step_claim: {
        Args: {
          p_claim_token: string
          p_next_scheduled_for?: string
          p_reason?: string
          p_status: string
          p_step_log_id: string
        }
        Returns: boolean
      }
      release_client_provider_demand: {
        Args: {
          p_client_action_id: string
          p_demand_id: string
          p_prior_version: number
          p_reason: string
        }
        Returns: Json
      }
      reopen_client_journey_exception: {
        Args: {
          p_client_action_id: string
          p_exception_id: string
          p_note: string
          p_prior_version: number
        }
        Returns: Json
      }
      request_client_reactivation: {
        Args: { p_idempotency_key: string; p_reason: string }
        Returns: Json
      }
      reschedule_appointment: {
        Args: {
          p_appointment_id: string
          p_client_action_id: string
          p_new_end_at: string
          p_new_start_at: string
          p_prior_version: number
          p_reason: string
        }
        Returns: Json
      }
      reserve_claim_batch: {
        Args: {
          p_claim_ids: string[]
          p_client_action_id: string
          p_requested_by?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      reserve_era_source_aware: {
        Args: {
          p_payer_id: string
          p_payer_name: string
          p_payment_date: string
          p_payment_reference: string
          p_practice_id: string
          p_source_era_id: string
          p_source_record_hash: string
          p_source_system: string
          p_tenant_id: string
          p_total_payment_amount: number
        }
        Returns: Json
      }
      resolve_client_journey_exception: {
        Args: {
          p_client_action_id: string
          p_exception_id: string
          p_note: string
          p_prior_version: number
          p_state: string
        }
        Returns: Json
      }
      resolve_reconciliation_finding: {
        Args: { p_finding_id: string; p_note: string; p_resolution: string }
        Returns: undefined
      }
      select_therapist_for_client:
        | { Args: { p_client_id: string; p_staff_id: string }; Returns: Json }
        | { Args: { p_staff_id: string }; Returns: Json }
      set_client_at_risk: {
        Args: {
          p_actor_profile_id?: string
          p_admin_override?: boolean
          p_at_risk: boolean
          p_client_id: string
          p_reason?: string
          p_source: string
        }
        Returns: Json
      }
      set_client_care_cadence: {
        Args: {
          client_id: string
          concurrency_token: string
          contract_version: string
          idempotency_key?: string
          reason: string
          tenant_id: string
          to_cadence: Database["public"]["Enums"]["client_care_cadence_enum"]
        }
        Returns: Json
      }
      set_client_contact_policy: {
        Args: {
          p_actor_profile_id?: string
          p_admin_override?: boolean
          p_client_id: string
          p_contact_policy: Database["public"]["Enums"]["client_contact_policy_enum"]
          p_reason?: string
          p_source: string
        }
        Returns: Json
      }
      set_client_disposition: {
        Args: {
          client_id: string
          concurrency_token: string
          contract_version: string
          disposition_reason: Database["public"]["Enums"]["client_closure_reason_enum"]
          idempotency_key?: string
          reason: string
          tenant_id: string
        }
        Returns: Json
      }
      set_client_eligibility_state:
        | {
            Args: {
              client_id: string
              concurrency_token: string
              contract_version: string
              idempotency_key?: string
              reason: string
              tenant_id: string
              to_state: Database["public"]["Enums"]["client_eligibility_state_enum"]
            }
            Returns: Json
          }
        | {
            Args: {
              p_actor_profile_id?: string
              p_admin_override?: boolean
              p_client_id: string
              p_eligibility_state: Database["public"]["Enums"]["client_eligibility_state_enum"]
              p_reason?: string
              p_source: string
            }
            Returns: Json
          }
      set_client_engagement_state:
        | {
            Args: {
              client_id: string
              concurrency_token: string
              contract_version: string
              idempotency_key?: string
              reason: string
              tenant_id: string
              to_state: Database["public"]["Enums"]["client_engagement_state_enum"]
            }
            Returns: Json
          }
        | {
            Args: {
              p_actor_profile_id?: string
              p_admin_override?: boolean
              p_client_id: string
              p_engagement_state: Database["public"]["Enums"]["client_engagement_state_enum"]
              p_reason?: string
              p_source: string
            }
            Returns: Json
          }
      set_client_risk: {
        Args: {
          at_risk: boolean
          client_id: string
          concurrency_token: string
          contract_version: string
          idempotency_key?: string
          reason: string
          risk_reason: string
          tenant_id: string
        }
        Returns: Json
      }
      set_client_service_policy:
        | {
            Args: {
              client_id: string
              concurrency_token: string
              contract_version: string
              idempotency_key?: string
              reason: string
              tenant_id: string
              to_policy: Database["public"]["Enums"]["client_service_policy_enum"]
            }
            Returns: Json
          }
        | {
            Args: {
              p_actor_profile_id?: string
              p_client_id: string
              p_reason: string
              p_service_policy: Database["public"]["Enums"]["client_service_policy_enum"]
              p_source: string
            }
            Returns: Json
          }
      set_staff_care_pathway_readiness: {
        Args: {
          p_evidence?: Json
          p_expires_at?: string
          p_pathway_code: string
          p_readiness_state: string
          p_source: string
          p_staff_id: string
        }
        Returns: {
          created_at: string
          effective_at: string
          evidence: Json
          expires_at: string | null
          id: string
          pathway_code: string
          payer_code: string | null
          readiness_state: string
          region_code: string | null
          review_due_at: string | null
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by_profile_id: string | null
          source: string
          staff_id: string
          state_code: Database["public"]["Enums"]["state_code_enum"] | null
          tenant_id: string
          updated_at: string
          verified_at: string
          verified_by_profile_id: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "staff_care_pathway_readiness"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      setup_admin_user: {
        Args: {
          _first_name?: string
          _last_name?: string
          _license_number?: string
          _license_type?: string
          _npi?: string
          _taxonomy?: string
          _user_email: string
        }
        Returns: string
      }
      staff_list_client_journey_exception_owner_options: {
        Args: never
        Returns: Json
      }
      staff_list_client_journey_exceptions: {
        Args: {
          p_filters?: Json
          p_page?: number
          p_page_size?: number
          p_sort_by?: string
          p_sort_dir?: string
        }
        Returns: Json
      }
      staff_list_clients: {
        Args: {
          p_filters?: Json
          p_page?: number
          p_page_size?: number
          p_sort_by?: string
          p_sort_dir?: string
        }
        Returns: Json
      }
      staff_list_provider_demand: {
        Args: {
          p_filters?: Json
          p_page?: number
          p_page_size?: number
          p_sort_by?: string
          p_sort_dir?: string
        }
        Returns: Json
      }
      stage_claimmd_era_replacement: {
        Args: { p_new_source_record_hash: string; p_source_era_id: string }
        Returns: Json
      }
      start_client_journey_exception: {
        Args: {
          p_client_action_id: string
          p_exception_id: string
          p_note: string
          p_prior_version: number
        }
        Returns: Json
      }
      submit_claim: {
        Args: { p_claim_id: string; p_client_action_id: string }
        Returns: Json
      }
      submit_claims_finalize: {
        Args: {
          p_new_state: Database["public"]["Enums"]["claim_submission_state"]
          p_request_id: string
          p_response?: Json
          p_uncertain_reason?: string
        }
        Returns: Json
      }
      submit_claims_reconcile: {
        Args: {
          p_final_state: Database["public"]["Enums"]["claim_submission_state"]
          p_request_id: string
          p_response?: Json
        }
        Returns: Json
      }
      submit_claims_reserve: {
        Args: {
          p_claim_ids: string[]
          p_client_action_id: string
          p_requested_by?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      transition_client_lifecycle:
        | {
            Args: {
              client_id: string
              concurrency_token: string
              contract_version: string
              disposition_reason?: Database["public"]["Enums"]["client_closure_reason_enum"]
              idempotency_key?: string
              reason: string
              tenant_id: string
              to_stage: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
            }
            Returns: Json
          }
        | {
            Args: {
              p_actor_profile_id?: string
              p_admin_override?: boolean
              p_client_id: string
              p_reason?: string
              p_source: string
              p_target_stage: Database["public"]["Enums"]["client_lifecycle_stage_enum"]
            }
            Returns: Json
          }
      trg_enqueue_clickup_sync: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      update_client_journey_exception: {
        Args: {
          p_change_source?: string
          p_clear_owner?: boolean
          p_exception_id: string
          p_next_action?: string
          p_owner_profile_id?: string
          p_resolution_note?: string
          p_resolution_state?: string
          p_review_due_at?: string
        }
        Returns: {
          category: string
          client_id: string
          created_at: string
          created_by_profile_id: string | null
          evidence: Json
          exception_type: string
          id: string
          next_action: string
          owner_profile_id: string | null
          reason_code: string
          reason_detail: string
          related_entity_id: string | null
          related_entity_type: string | null
          resolution_note: string | null
          resolution_state: string
          resolved_at: string | null
          resolved_by_profile_id: string | null
          review_due_at: string
          run_key: string | null
          source: string
          tenant_id: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "client_journey_exceptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_client_journey_exception_next_action: {
        Args: {
          p_client_action_id: string
          p_exception_id: string
          p_next_action: string
          p_note: string
          p_prior_version: number
        }
        Returns: Json
      }
      update_client_journey_exception_review_due: {
        Args: {
          p_client_action_id: string
          p_exception_id: string
          p_note: string
          p_prior_version: number
          p_review_due_at: string
        }
        Returns: Json
      }
      update_provider_accepting_preference: {
        Args: {
          p_accepting: boolean
          p_client_action_id: string
          p_reason: string
        }
        Returns: Json
      }
      update_provider_capacity_preferences: {
        Args: { p_client_action_id: string; p_patch: Json }
        Returns: Json
      }
      update_provider_profile_fields: {
        Args: { p_client_action_id: string; p_patch: Json }
        Returns: Json
      }
      update_provider_profile_image_metadata: {
        Args: {
          p_alt_text?: string
          p_client_action_id?: string
          p_storage_path: string
        }
        Returns: Json
      }
      update_recurring_appointment_series: {
        Args: {
          p_client_action_id: string
          p_patch: Json
          p_prior_version: number
          p_reason: string
          p_series_id: string
        }
        Returns: Json
      }
      upsert_client_emergency_contact:
        | {
            Args: {
              p_client_id: string
              p_email?: string
              p_name: string
              p_phone: string
              p_relationship: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_email: string
              p_name: string
              p_phone: string
              p_relationship: string
            }
            Returns: Json
          }
    }
    Enums: {
      accept_assign_enum: "Y" | "N"
      app_role: "staff" | "admin" | "client"
      appointment_exception_type_enum: "cancelled" | "rescheduled"
      appointment_note_status_enum: "draft" | "signed" | "amended"
      appointment_note_type_enum: "progress" | "treatment" | "addendum"
      appointment_status_enum:
        | "scheduled"
        | "documented"
        | "cancelled"
        | "late_cancel/noshow"
        | "draft"
      claim_line_era_reconciliation_status:
        | "none"
        | "pending_official_era"
        | "reconciled"
        | "discrepancy"
      claim_line_financial_status:
        | "unpaid"
        | "payment_reported"
        | "partially_paid"
        | "paid_pending_adjudication"
        | "paid"
        | "overpaid"
        | "underpaid"
      claim_submission_state:
        | "reserved"
        | "submission_pending"
        | "external_submission_started"
        | "external_submission_accepted"
        | "external_submission_rejected"
        | "finalization_pending"
        | "submitted"
        | "uncertain"
        | "failed_retryable"
        | "failed_final"
      client_care_cadence_enum: "regular" | "as_needed"
      client_closure_reason_enum:
        | "not_the_right_time"
        | "found_somewhere_else"
        | "completed_care"
        | "paused_care"
        | "administrative"
        | "went_dark"
        | "other"
      client_contact_policy_enum: "normal" | "do_not_contact"
      client_eligibility_state_enum:
        | "eligible"
        | "coverage_issue"
        | "manual_review"
        | "unknown"
      client_engagement_state_enum:
        | "normal"
        | "unresponsive_warm"
        | "unresponsive_cold"
        | "went_dark"
      client_history_family_context_enum:
        | "family_of_origin"
        | "current_household"
      client_ideation_enum: "none" | "passive" | "active"
      client_lifecycle_stage_enum:
        | "registration"
        | "intake"
        | "matching"
        | "matched"
        | "scheduled"
        | "early_care"
        | "established_care"
        | "closed"
      client_relation_type_enum:
        | "Patient"
        | "Parent"
        | "Spouse"
        | "Caregiver"
        | "Legal Guardian"
        | "Other"
      client_service_policy_enum: "normal" | "service_blocked"
      client_state_dimension_enum:
        | "lifecycle_stage"
        | "engagement_state"
        | "at_risk"
        | "eligibility_state"
        | "contact_policy"
        | "service_policy"
        | "closure_reason"
        | "care_cadence"
        | "legacy_pat_status"
      client_status_enum: "New" | "Registered" | "Active" | "Inactive"
      client_substance_abuse_risk_enum: "none" | "low" | "medium" | "high"
      clinician_status_enum: "Invited" | "New" | "Active" | "Inactive"
      contract_consumer_status_enum:
        | "not_started"
        | "in_progress"
        | "validated"
        | "blocked"
        | "retired"
      contract_release_status_enum:
        | "draft"
        | "published"
        | "deprecated"
        | "retired"
      crm_capability_role:
        | "crm_admin"
        | "crm_operator"
        | "crm_readonly"
        | "crm_none"
      crm_exception_severity_enum: "low" | "medium" | "high" | "critical"
      crm_exception_status_enum: "open" | "in_review" | "resolved" | "dismissed"
      crm_exception_type_enum:
        | "campaign_message_failed"
        | "campaign_step_overdue"
        | "client_reply_needs_review"
        | "client_went_dark"
        | "client_became_at_risk"
        | "missed_appointment_follow_up"
        | "eligibility_verification_failed"
        | "no_clinician_match_found"
        | "communication_suppressed"
        | "assignment_missing"
        | "data_conflict"
        | "integration_failure"
        | "manual_review_required"
      crm_task_priority_enum: "low" | "normal" | "high" | "urgent"
      crm_task_status_enum:
        | "not_started"
        | "in_progress"
        | "waiting"
        | "blocked"
        | "completed"
        | "canceled"
      crm_task_type_enum:
        | "client_follow_up"
        | "staff_follow_up"
        | "campaign_exception"
        | "eligibility_review"
        | "match_review"
        | "documentation"
        | "risk_intervention"
        | "general"
      era_import_status:
        | "reserved"
        | "importing"
        | "complete"
        | "complete_with_reconciliation_issues"
        | "failed_retryable"
        | "failed_final"
        | "replacement_staged"
        | "superseded"
      form_type_enum: "signup" | "intake" | "session_notes"
      gad7_severity_enum: "minimal" | "mild" | "moderate" | "severe"
      gender_identity_enum:
        | "Female"
        | "Male"
        | "Non-Binary/Gender Fluid"
        | "Other"
      insurance_eligibility_outcome_enum:
        | "active"
        | "inactive"
        | "member_not_found"
        | "no_coverage_for_date"
        | "technical_error"
      integration_outbox_status_enum:
        | "pending"
        | "processing"
        | "delivered"
        | "failed"
        | "dead_letter"
      pat_rel_enum: "18" | "01" | "19" | "20" | "21" | "39" | "40" | "53" | "G8"
      pat_status_enum:
        | "Interested"
        | "New"
        | "Inactive"
        | "Registered"
        | "Waitlist"
        | "Matching"
        | "Unscheduled"
        | "Scheduled"
        | "Early Sessions"
        | "Established"
        | "Not the Right Time"
        | "Found Somewhere Else"
        | "Went Dark (Previously Seen)"
        | "Blacklisted"
        | "Unresponsive - Warm"
        | "Unresponsive - Cold"
        | "Manual Check"
        | "No Insurance"
        | "DNC"
        | "At Risk"
        | "Legacy - Has Therapist Available"
        | "Legacy - No Therapist Available"
      payment_source_document_status:
        | "uploaded"
        | "previewed"
        | "committing"
        | "complete"
        | "complete_with_findings"
        | "failed"
      payment_source_row_state:
        | "unmatched"
        | "ambiguous"
        | "auto_matched"
        | "manually_matched"
        | "posted"
        | "superseded_by_era"
        | "discrepancy"
        | "skipped_duplicate"
      phq9_severity_enum:
        | "minimal"
        | "mild"
        | "moderate"
        | "moderately_severe"
        | "severe"
      provider_applicant_status_enum:
        | "new"
        | "contacted"
        | "screening"
        | "application"
        | "credentialing"
        | "ready"
        | "hired"
        | "declined"
        | "withdrawn"
        | "inactive"
      provider_availability_confirmation_state_enum:
        | "current"
        | "due"
        | "reminder_sent"
        | "expired"
        | "not_applicable"
      provider_clinical_readiness_state_enum:
        | "pending"
        | "ready"
        | "not_ready"
        | "hold"
      provider_contact_failure_status_enum: "recorded" | "corrected" | "voided"
      provider_followup_status_enum:
        | "pending"
        | "completed"
        | "skipped"
        | "failed"
        | "cancelled"
      provider_match_evaluation_state_enum:
        | "eligible"
        | "ineligible"
        | "stale"
        | "error"
      provider_network_exception_severity_enum:
        | "information"
        | "warning"
        | "blocking"
        | "critical"
      provider_network_exception_status_enum:
        | "open"
        | "in_progress"
        | "waiting"
        | "resolved"
        | "dismissed"
      provider_state_launch_status_enum:
        | "active"
        | "warm"
        | "recruiting"
        | "hold"
      risk_level_enum: "none" | "low" | "moderate" | "high" | "imminent"
      sex_enum: "M" | "F"
      specialty_enum:
        | "Mental Health"
        | "Speech Therapy"
        | "Occupational Therapy"
      state_code_enum:
        | "AL"
        | "AK"
        | "AZ"
        | "AR"
        | "CA"
        | "CO"
        | "CT"
        | "DE"
        | "FL"
        | "GA"
        | "HI"
        | "ID"
        | "IL"
        | "IN"
        | "IA"
        | "KS"
        | "KY"
        | "LA"
        | "ME"
        | "MD"
        | "MA"
        | "MI"
        | "MN"
        | "MS"
        | "MO"
        | "MT"
        | "NE"
        | "NV"
        | "NH"
        | "NJ"
        | "NM"
        | "NY"
        | "NC"
        | "ND"
        | "OH"
        | "OK"
        | "OR"
        | "PA"
        | "RI"
        | "SC"
        | "SD"
        | "TN"
        | "TX"
        | "UT"
        | "VT"
        | "VA"
        | "WA"
        | "WV"
        | "WI"
        | "WY"
        | "DC"
        | "PR"
        | "VI"
        | "GU"
      time_zones:
        | "America/New_York"
        | "America/Chicago"
        | "America/Denver"
        | "America/Phoenix"
        | "America/Los_Angeles"
        | "America/Anchorage"
        | "Pacific/Honolulu"
        | "America/Puerto_Rico"
        | "Pacific/Guam"
        | "Pacific/Pago_Pago"
      vaccn_case_step_status_enum:
        | "not_started"
        | "in_progress"
        | "waiting"
        | "completed"
        | "skipped"
        | "blocked"
      vaccn_registration_case_status_enum:
        | "not_started"
        | "in_progress"
        | "waiting_external"
        | "blocked"
        | "ready"
        | "closed"
      vaccn_sop_status_enum: "draft" | "published" | "retired"
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
      accept_assign_enum: ["Y", "N"],
      app_role: ["staff", "admin", "client"],
      appointment_exception_type_enum: ["cancelled", "rescheduled"],
      appointment_note_status_enum: ["draft", "signed", "amended"],
      appointment_note_type_enum: ["progress", "treatment", "addendum"],
      appointment_status_enum: [
        "scheduled",
        "documented",
        "cancelled",
        "late_cancel/noshow",
        "draft",
      ],
      claim_line_era_reconciliation_status: [
        "none",
        "pending_official_era",
        "reconciled",
        "discrepancy",
      ],
      claim_line_financial_status: [
        "unpaid",
        "payment_reported",
        "partially_paid",
        "paid_pending_adjudication",
        "paid",
        "overpaid",
        "underpaid",
      ],
      claim_submission_state: [
        "reserved",
        "submission_pending",
        "external_submission_started",
        "external_submission_accepted",
        "external_submission_rejected",
        "finalization_pending",
        "submitted",
        "uncertain",
        "failed_retryable",
        "failed_final",
      ],
      client_care_cadence_enum: ["regular", "as_needed"],
      client_closure_reason_enum: [
        "not_the_right_time",
        "found_somewhere_else",
        "completed_care",
        "paused_care",
        "administrative",
        "went_dark",
        "other",
      ],
      client_contact_policy_enum: ["normal", "do_not_contact"],
      client_eligibility_state_enum: [
        "eligible",
        "coverage_issue",
        "manual_review",
        "unknown",
      ],
      client_engagement_state_enum: [
        "normal",
        "unresponsive_warm",
        "unresponsive_cold",
        "went_dark",
      ],
      client_history_family_context_enum: [
        "family_of_origin",
        "current_household",
      ],
      client_ideation_enum: ["none", "passive", "active"],
      client_lifecycle_stage_enum: [
        "registration",
        "intake",
        "matching",
        "matched",
        "scheduled",
        "early_care",
        "established_care",
        "closed",
      ],
      client_relation_type_enum: [
        "Patient",
        "Parent",
        "Spouse",
        "Caregiver",
        "Legal Guardian",
        "Other",
      ],
      client_service_policy_enum: ["normal", "service_blocked"],
      client_state_dimension_enum: [
        "lifecycle_stage",
        "engagement_state",
        "at_risk",
        "eligibility_state",
        "contact_policy",
        "service_policy",
        "closure_reason",
        "care_cadence",
        "legacy_pat_status",
      ],
      client_status_enum: ["New", "Registered", "Active", "Inactive"],
      client_substance_abuse_risk_enum: ["none", "low", "medium", "high"],
      clinician_status_enum: ["Invited", "New", "Active", "Inactive"],
      contract_consumer_status_enum: [
        "not_started",
        "in_progress",
        "validated",
        "blocked",
        "retired",
      ],
      contract_release_status_enum: [
        "draft",
        "published",
        "deprecated",
        "retired",
      ],
      crm_capability_role: [
        "crm_admin",
        "crm_operator",
        "crm_readonly",
        "crm_none",
      ],
      crm_exception_severity_enum: ["low", "medium", "high", "critical"],
      crm_exception_status_enum: ["open", "in_review", "resolved", "dismissed"],
      crm_exception_type_enum: [
        "campaign_message_failed",
        "campaign_step_overdue",
        "client_reply_needs_review",
        "client_went_dark",
        "client_became_at_risk",
        "missed_appointment_follow_up",
        "eligibility_verification_failed",
        "no_clinician_match_found",
        "communication_suppressed",
        "assignment_missing",
        "data_conflict",
        "integration_failure",
        "manual_review_required",
      ],
      crm_task_priority_enum: ["low", "normal", "high", "urgent"],
      crm_task_status_enum: [
        "not_started",
        "in_progress",
        "waiting",
        "blocked",
        "completed",
        "canceled",
      ],
      crm_task_type_enum: [
        "client_follow_up",
        "staff_follow_up",
        "campaign_exception",
        "eligibility_review",
        "match_review",
        "documentation",
        "risk_intervention",
        "general",
      ],
      era_import_status: [
        "reserved",
        "importing",
        "complete",
        "complete_with_reconciliation_issues",
        "failed_retryable",
        "failed_final",
        "replacement_staged",
        "superseded",
      ],
      form_type_enum: ["signup", "intake", "session_notes"],
      gad7_severity_enum: ["minimal", "mild", "moderate", "severe"],
      gender_identity_enum: [
        "Female",
        "Male",
        "Non-Binary/Gender Fluid",
        "Other",
      ],
      insurance_eligibility_outcome_enum: [
        "active",
        "inactive",
        "member_not_found",
        "no_coverage_for_date",
        "technical_error",
      ],
      integration_outbox_status_enum: [
        "pending",
        "processing",
        "delivered",
        "failed",
        "dead_letter",
      ],
      pat_rel_enum: ["18", "01", "19", "20", "21", "39", "40", "53", "G8"],
      pat_status_enum: [
        "Interested",
        "New",
        "Inactive",
        "Registered",
        "Waitlist",
        "Matching",
        "Unscheduled",
        "Scheduled",
        "Early Sessions",
        "Established",
        "Not the Right Time",
        "Found Somewhere Else",
        "Went Dark (Previously Seen)",
        "Blacklisted",
        "Unresponsive - Warm",
        "Unresponsive - Cold",
        "Manual Check",
        "No Insurance",
        "DNC",
        "At Risk",
        "Legacy - Has Therapist Available",
        "Legacy - No Therapist Available",
      ],
      payment_source_document_status: [
        "uploaded",
        "previewed",
        "committing",
        "complete",
        "complete_with_findings",
        "failed",
      ],
      payment_source_row_state: [
        "unmatched",
        "ambiguous",
        "auto_matched",
        "manually_matched",
        "posted",
        "superseded_by_era",
        "discrepancy",
        "skipped_duplicate",
      ],
      phq9_severity_enum: [
        "minimal",
        "mild",
        "moderate",
        "moderately_severe",
        "severe",
      ],
      provider_applicant_status_enum: [
        "new",
        "contacted",
        "screening",
        "application",
        "credentialing",
        "ready",
        "hired",
        "declined",
        "withdrawn",
        "inactive",
      ],
      provider_availability_confirmation_state_enum: [
        "current",
        "due",
        "reminder_sent",
        "expired",
        "not_applicable",
      ],
      provider_clinical_readiness_state_enum: [
        "pending",
        "ready",
        "not_ready",
        "hold",
      ],
      provider_contact_failure_status_enum: ["recorded", "corrected", "voided"],
      provider_followup_status_enum: [
        "pending",
        "completed",
        "skipped",
        "failed",
        "cancelled",
      ],
      provider_match_evaluation_state_enum: [
        "eligible",
        "ineligible",
        "stale",
        "error",
      ],
      provider_network_exception_severity_enum: [
        "information",
        "warning",
        "blocking",
        "critical",
      ],
      provider_network_exception_status_enum: [
        "open",
        "in_progress",
        "waiting",
        "resolved",
        "dismissed",
      ],
      provider_state_launch_status_enum: [
        "active",
        "warm",
        "recruiting",
        "hold",
      ],
      risk_level_enum: ["none", "low", "moderate", "high", "imminent"],
      sex_enum: ["M", "F"],
      specialty_enum: [
        "Mental Health",
        "Speech Therapy",
        "Occupational Therapy",
      ],
      state_code_enum: [
        "AL",
        "AK",
        "AZ",
        "AR",
        "CA",
        "CO",
        "CT",
        "DE",
        "FL",
        "GA",
        "HI",
        "ID",
        "IL",
        "IN",
        "IA",
        "KS",
        "KY",
        "LA",
        "ME",
        "MD",
        "MA",
        "MI",
        "MN",
        "MS",
        "MO",
        "MT",
        "NE",
        "NV",
        "NH",
        "NJ",
        "NM",
        "NY",
        "NC",
        "ND",
        "OH",
        "OK",
        "OR",
        "PA",
        "RI",
        "SC",
        "SD",
        "TN",
        "TX",
        "UT",
        "VT",
        "VA",
        "WA",
        "WV",
        "WI",
        "WY",
        "DC",
        "PR",
        "VI",
        "GU",
      ],
      time_zones: [
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Phoenix",
        "America/Los_Angeles",
        "America/Anchorage",
        "Pacific/Honolulu",
        "America/Puerto_Rico",
        "Pacific/Guam",
        "Pacific/Pago_Pago",
      ],
      vaccn_case_step_status_enum: [
        "not_started",
        "in_progress",
        "waiting",
        "completed",
        "skipped",
        "blocked",
      ],
      vaccn_registration_case_status_enum: [
        "not_started",
        "in_progress",
        "waiting_external",
        "blocked",
        "ready",
        "closed",
      ],
      vaccn_sop_status_enum: ["draft", "published", "retired"],
    },
  },
} as const
