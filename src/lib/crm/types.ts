// CRM TypeScript interfaces

export type PatStatus = 
  | 'Active'
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
  | 'Went Dark (Previously Seen)';

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
  created_at: string;
  updated_at: string;
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
  event_type: 'status_change' | 'note_added' | 'email_sent' | 'email_received' | 'conversation_linked' | 'bulk_send';
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, unknown>;
  created_by_profile_id: string | null;
  created_at: string;
  created_by?: {
    email: string | null;
  } | null;
}

export interface CrmAuthContext {
  userId: string;
  tenantId: string;
  role: 'admin' | 'staff';
  isLoading: boolean;
  isAuthenticated: boolean;
}

export interface ClientFilters {
  statuses: PatStatus[];
  states: string[];
  search: string;
  tags: string[];
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
