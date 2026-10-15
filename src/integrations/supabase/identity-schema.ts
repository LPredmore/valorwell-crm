import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { supabase } from './client';

/** Approved SQL contract, pending live type generation while migration deployment
 * is blocked. Remove this extension once these tables are in generated types.ts.
 * The shared client/session is reused; missing storage still fails closed.
 */
type ReviewRow = {
  id: string; tenant_id: string; contact_id: string; linked_domain: string;
  linked_record_id: string; decision: string; match_basis: string;
  review_note: string | null; reviewed_by: string; created_at: string; updated_at: string;
};
type EventRow = {
  id: string; review_id: string; tenant_id: string; previous_decision: string | null;
  next_decision: string; actor_id: string; changed_at: string;
  previous_match_basis: string | null; next_match_basis: string | null;
  previous_review_note: string | null; next_review_note: string | null;
};
type IdentityTables = {
  crm_identity_reviews: {
    Row: ReviewRow;
    Insert: Pick<ReviewRow, 'tenant_id' | 'contact_id' | 'linked_domain' | 'linked_record_id' | 'decision' | 'match_basis' | 'reviewed_by'>
      & Partial<Pick<ReviewRow, 'id' | 'review_note' | 'created_at' | 'updated_at'>>;
    Update: Partial<ReviewRow>;
    Relationships: [{
      foreignKeyName: 'crm_identity_reviews_tenant_id_fkey';
      columns: ['tenant_id']; isOneToOne: false;
      referencedRelation: 'tenants'; referencedColumns: ['id'];
    }];
  };
  crm_identity_review_events: {
    Row: EventRow;
    Insert: Pick<EventRow, 'review_id' | 'tenant_id' | 'next_decision' | 'actor_id'> & Partial<EventRow>;
    Update: Partial<EventRow>;
    Relationships: [{
      foreignKeyName: 'crm_identity_events_tenant_review_fkey';
      columns: ['tenant_id', 'review_id']; isOneToOne: false;
      referencedRelation: 'crm_identity_reviews'; referencedColumns: ['tenant_id', 'id'];
    }, {
      foreignKeyName: 'crm_identity_review_events_tenant_id_fkey';
      columns: ['tenant_id']; isOneToOne: false;
      referencedRelation: 'tenants'; referencedColumns: ['id'];
    }];
  };
};
export type IdentityDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables'> & {
    Tables: Database['public']['Tables'] & IdentityTables;
  };
};
export const identitySupabase = supabase as unknown as SupabaseClient<IdentityDatabase>;
