// CRM TypeScript interfaces

export type PatStatus = 
  | 'Blacklisted'
  | 'DNC'
  | 'Early Sessions'
  | 'Established'
  | 'Found Somewhere Else'
  | 'Inactive'
  | 'Interested'
  | 'Manual Check'
  | 'Matching'
  | 'New'
  | 'No Insurance'
  | 'Not the Right Time'
  | 'Registered'
  | 'Scheduled'
  | 'Unresponsive - Cold'
  | 'Unresponsive - Warm'
  | 'Unscheduled'
  | 'Waitlist'
  | 'Went Dark (Previously Seen)'
  | 'At Risk'
  | 'Legacy - Has Therapist Available'
  | 'Legacy - No Therapist Available';

export interface CrmClient {
  id: string;
  tenant_id: string;
  pat_name_f: string | null;
  pat_name_m: string | null;
  pat_name_l: string | null;
  pat_name_preferred: string | null;
  email: string | null;
  phone: string | null;
  pat_state: string | null;
  pat_status: PatStatus | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
  last_contact_at?: string | null;
  last_contact_direction?: 'sent' | 'received' | null;
  last_contact_channel?: 'email' | 'sms' | null;
  clickup_synced_at?: string | null;
  primary_staff?: {
    id: string;
    prov_name_f: string | null;
    prov_name_l: string | null;
    prov_name_for_clients: string | null;
  } | null;
}

export interface CrmNote {
  id: string;
  tenant_id: string;
  client_id: string | null;
  conversation_id: string | null;
  created_by_profile_id: string;
  note_content: string;
  note_type: 'internal' | 'system';
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  created_by?: {
    email: string | null;
  } | null;
}

export interface CrmActivityEvent {
  id: string;
  tenant_id: string;
  client_id: string;
  event_type: 'status_change' | 'note_added' | 'email_sent' | 'email_received' | 'conversation_linked' | 'bulk_send' | 'campaign_auto_cancelled' | 'sms_sent' | 'sms_received' | 'campaign_auto_enrolled' | 'campaign_enrolled';
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, unknown>;
  created_by_profile_id: string | null;
  created_at: string;
  created_by?: {
    email: string | null;
  } | null;
}

export type CrmCapabilityRole = 'crm_admin' | 'crm_operator' | 'crm_readonly' | 'crm_none';

export interface CrmCapabilities {
  mutate: boolean;
  communicate: boolean;
  manage_campaigns: boolean;
  report: boolean;
}

export interface CrmAvailableTenant {
  tenant_id: string;
  crm_role: CrmCapabilityRole;
}

export interface CrmAuthContext {
  userId: string;
  /** Backwards-compat alias for currentTenantId. Empty string when none selected. */
  tenantId: string;
  currentTenantId: string | null;
  availableTenants: CrmAvailableTenant[];
  crmRole: CrmCapabilityRole;
  /** Legacy shim: 'admin' for crm_admin, otherwise 'staff'. Prefer crmRole/capabilities. */
  role: 'admin' | 'staff';
  capabilities: CrmCapabilities;
  contractVersion: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  needsTenantSelection: boolean;
  switchTenant: (tenantId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export interface ClientFilters {
  statuses: PatStatus[];
  states: string[];
  search: string;
  tags: string[];
  joinedDateFrom?: Date;
  joinedDateTo?: Date;
  activeCampaign?: 'all' | 'yes' | 'no';
  communicationReceivedDays?: number;
}

// HelpScout Inbox types
export interface HelpScoutCustomer {
  id: number;
  email: string;
  first: string;
  last: string;
}

export interface HelpScoutSource {
  type: 'email' | 'web' | 'api' | 'chat';
  via: 'customer' | 'user';
}

export interface HelpScoutConversation {
  id: number;
  number: number;
  subject: string;
  status: 'active' | 'pending' | 'closed' | 'spam';
  preview: string;
  primaryCustomer: HelpScoutCustomer;
  source: HelpScoutSource;
  createdAt: string;
  userUpdatedAt: string;
  client_id: string; // Added by our filtering
  lastMessageBy: 'customer' | 'staff'; // Who sent the last message (thread-based)
  needsReply: boolean; // True if active + customer last messaged
}

export interface ConversationsResponse {
  conversations: HelpScoutConversation[];
  page: {
    size: number;
    totalElements: number;
    totalPages: number;
    number: number;
  };
}

export interface HelpScoutThread {
  id: number;
  type: 'customer' | 'reply' | 'note' | 'message';
  status: string;
  body: string;
  source: {
    type: string;
    via: string;
  };
  customer?: HelpScoutCustomer;
  createdBy?: {
    id: number;
    type: string;
    email: string;
    first: string;
    last: string;
  };
  createdAt: string;
}

export interface HelpScoutConversationDetail extends HelpScoutConversation {
  _embedded?: {
    threads?: HelpScoutThread[];
  };
}
