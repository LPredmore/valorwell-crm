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
          updated_at?: string
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
            foreignKeyName: "claims_client_insurance_id_fkey"
            columns: ["client_insurance_id"]
            isOneToOne: false
            referencedRelation: "client_insurance"
            referencedColumns: ["id"]
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
            foreignKeyName: "client_insurance_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_payment_links: {
        Row: {
          amount_cents: number
          claim_line_ids: string[] | null
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
          created_at: string
          email: string | null
          id: string
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
          tags: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
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
          tags?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
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
        }
        Insert: {
          channel: string
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
        }
        Update: {
          channel?: string
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
            foreignKeyName: "crm_campaign_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          client_id: string
          client_insurance_id: string
          coverage_end: string | null
          coverage_start: string | null
          created_at: string
          eligibility_status: string | null
          id: string
          requested_at: string
          response_message: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          client_insurance_id: string
          coverage_end?: string | null
          coverage_start?: string | null
          created_at?: string
          eligibility_status?: string | null
          id?: string
          requested_at?: string
          response_message?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_insurance_id?: string
          coverage_end?: string | null
          coverage_start?: string | null
          created_at?: string
          eligibility_status?: string | null
          id?: string
          requested_at?: string
          response_message?: string | null
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
            foreignKeyName: "eligibility_checks_client_insurance_id_fkey"
            columns: ["client_insurance_id"]
            isOneToOne: false
            referencedRelation: "client_insurance"
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
          created_at: string
          id: string
          payer_id: string | null
          payer_name: string | null
          payment_date: string | null
          payment_reference: string | null
          practice_id: string
          tenant_id: string
          total_payment_amount: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          payer_id?: string | null
          payer_name?: string | null
          payment_date?: string | null
          payment_reference?: string | null
          practice_id: string
          tenant_id: string
          total_payment_amount?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          payer_id?: string | null
          payer_name?: string | null
          payment_date?: string | null
          payment_reference?: string | null
          practice_id?: string
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
      payroll_line_items: {
        Row: {
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
          staff_id: string
          tenant_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
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
          staff_id: string
          tenant_id: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
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
      payroll_runs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          period_end: string
          period_start: string
          processed_at: string | null
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
          id?: string
          period_end: string
          period_start: string
          processed_at?: string | null
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
          id?: string
          period_end?: string
          period_start?: string
          processed_at?: string | null
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
          addr_1: string | null
          addr_2: string | null
          city: string | null
          created_at: string
          email: string | null
          fax: string | null
          id: string
          is_default: boolean
          is_telehealth_only: boolean
          name: string
          phone: string | null
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
          addr_1?: string | null
          addr_2?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          fax?: string | null
          id?: string
          is_default?: boolean
          is_telehealth_only?: boolean
          name: string
          phone?: string | null
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
          addr_1?: string | null
          addr_2?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          fax?: string | null
          id?: string
          is_default?: boolean
          is_telehealth_only?: boolean
          name?: string
          phone?: string | null
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
            foreignKeyName: "referrals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          created_at: string
          id: string
          profile_id: string
          prov_accepting_new_clients: boolean
          prov_addr_1: string | null
          prov_addr_2: string | null
          prov_bio: string | null
          prov_city: string | null
          prov_degree: string | null
          prov_dob: string | null
          prov_field: Database["public"]["Enums"]["specialty_enum"] | null
          prov_image_url: string | null
          prov_license_number: string | null
          prov_license_type: string | null
          prov_min_client_age: number
          prov_name_f: string | null
          prov_name_for_clients: string | null
          prov_name_l: string | null
          prov_name_m: string | null
          prov_npi: string | null
          prov_phone: string | null
          prov_qualifier: string | null
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
          created_at?: string
          id?: string
          profile_id: string
          prov_accepting_new_clients?: boolean
          prov_addr_1?: string | null
          prov_addr_2?: string | null
          prov_bio?: string | null
          prov_city?: string | null
          prov_degree?: string | null
          prov_dob?: string | null
          prov_field?: Database["public"]["Enums"]["specialty_enum"] | null
          prov_image_url?: string | null
          prov_license_number?: string | null
          prov_license_type?: string | null
          prov_min_client_age?: number
          prov_name_f?: string | null
          prov_name_for_clients?: string | null
          prov_name_l?: string | null
          prov_name_m?: string | null
          prov_npi?: string | null
          prov_phone?: string | null
          prov_qualifier?: string | null
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
          created_at?: string
          id?: string
          profile_id?: string
          prov_accepting_new_clients?: boolean
          prov_addr_1?: string | null
          prov_addr_2?: string | null
          prov_bio?: string | null
          prov_city?: string | null
          prov_degree?: string | null
          prov_dob?: string | null
          prov_field?: Database["public"]["Enums"]["specialty_enum"] | null
          prov_image_url?: string | null
          prov_license_number?: string | null
          prov_license_type?: string | null
          prov_min_client_age?: number
          prov_name_f?: string | null
          prov_name_for_clients?: string | null
          prov_name_l?: string | null
          prov_name_m?: string | null
          prov_npi?: string | null
          prov_phone?: string | null
          prov_qualifier?: string | null
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
          staff_id: string
          tenant_id: string
          updated_at: string
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
          staff_id: string
          tenant_id: string
          updated_at?: string
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
          staff_id?: string
          tenant_id?: string
          updated_at?: string
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
          brand_accent_color: string | null
          brand_primary_color: string | null
          brand_secondary_color: string | null
          created_at: string
          display_name: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          slug: string
          trial_end_date: string | null
          updated_at: string
        }
        Insert: {
          brand_accent_color?: string | null
          brand_primary_color?: string | null
          brand_secondary_color?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          slug: string
          trial_end_date?: string | null
          updated_at?: string
        }
        Update: {
          brand_accent_color?: string | null
          brand_primary_color?: string | null
          brand_secondary_color?: string | null
          created_at?: string
          display_name?: string | null
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
    }
    Views: {
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
            foreignKeyName: "claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
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
      get_client_balance_summary: {
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
      get_staff_calendar_appointments: {
        Args: { p_from_date?: string; p_staff_id: string; p_to_date?: string }
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
      client_history_family_context_enum:
        | "family_of_origin"
        | "current_household"
      client_ideation_enum: "none" | "passive" | "active"
      client_relation_type_enum:
        | "Patient"
        | "Parent"
        | "Spouse"
        | "Caregiver"
        | "Legal Guardian"
        | "Other"
      client_status_enum: "New" | "Registered" | "Active" | "Inactive"
      client_substance_abuse_risk_enum: "none" | "low" | "medium" | "high"
      clinician_status_enum: "Invited" | "New" | "Active" | "Inactive"
      form_type_enum: "signup" | "intake" | "session_notes"
      gad7_severity_enum: "minimal" | "mild" | "moderate" | "severe"
      gender_identity_enum:
        | "Female"
        | "Male"
        | "Non-Binary/Gender Fluid"
        | "Other"
      pat_rel_enum: "18" | "01" | "19" | "20" | "21" | "39" | "40" | "53" | "G8"
      pat_status_enum:
        | "Interested"
        | "New"
        | "Active"
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
      phq9_severity_enum:
        | "minimal"
        | "mild"
        | "moderate"
        | "moderately_severe"
        | "severe"
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
      ],
      client_history_family_context_enum: [
        "family_of_origin",
        "current_household",
      ],
      client_ideation_enum: ["none", "passive", "active"],
      client_relation_type_enum: [
        "Patient",
        "Parent",
        "Spouse",
        "Caregiver",
        "Legal Guardian",
        "Other",
      ],
      client_status_enum: ["New", "Registered", "Active", "Inactive"],
      client_substance_abuse_risk_enum: ["none", "low", "medium", "high"],
      clinician_status_enum: ["Invited", "New", "Active", "Inactive"],
      form_type_enum: ["signup", "intake", "session_notes"],
      gad7_severity_enum: ["minimal", "mild", "moderate", "severe"],
      gender_identity_enum: [
        "Female",
        "Male",
        "Non-Binary/Gender Fluid",
        "Other",
      ],
      pat_rel_enum: ["18", "01", "19", "20", "21", "39", "40", "53", "G8"],
      pat_status_enum: [
        "Interested",
        "New",
        "Active",
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
      ],
      phq9_severity_enum: [
        "minimal",
        "mild",
        "moderate",
        "moderately_severe",
        "severe",
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
    },
  },
} as const
