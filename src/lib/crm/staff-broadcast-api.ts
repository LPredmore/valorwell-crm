import { supabase } from '@/integrations/supabase/client';

const STAFF_BROADCAST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/crm-resend-staff-broadcast`;

export type StaffBroadcastProcessResult = {
  bulkSendId: string;
  batchSent: number;
  batchFailed: number;
  sent: number;
  failed: number;
  remaining: number;
  complete: boolean;
  requestId?: string;
};

export async function processStaffBroadcast(
  tenantId: string,
  bulkSendId: string,
): Promise<StaffBroadcastProcessResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const response = await fetch(STAFF_BROADCAST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tenantId, bulkSendId }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const requestId = payload.requestId ? String(payload.requestId) : null;
    const message = payload.error ? String(payload.error) : `Staff broadcast API error: ${response.status}`;
    throw new Error(requestId ? `${message} (Request ID: ${requestId})` : message);
  }
  return payload as StaffBroadcastProcessResult;
}
