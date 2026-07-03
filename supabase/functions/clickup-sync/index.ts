// ClickUp one-way sync edge function.
// Auth: requires x-cron-secret matching CRON_SECRET env var.
// Inputs:
//   { client_id: uuid, action: 'upsert' }
//   { action: 'backfill', tenant_id?: uuid, limit?: number }

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CLICKUP_API = 'https://api.clickup.com/api/v2';
const SYNC_SOURCE = 'Supabase EHR';

// Ordered list of ClickUp custom field names we manage on the target List.
// These names must exist verbatim on the ClickUp List.
const MANAGED_FIELDS = [
  'Supabase Client ID',
  'Email',
  'Phone',
  'Client Status - EHR',
  'State',
  'Assigned Therapist',
  'Campaigns',
  'Last Campaign At',
  'Last Synced At',
  'Sync Source',
] as const;

type FieldName = typeof MANAGED_FIELDS[number];

interface ClickUpCustomField {
  id: string;
  name: string;
  type: string;
  type_config?: {
    options?: Array<{ id: string; name: string; orderindex?: number }>;
  };
}

const CLICKUP_API_TOKEN = Deno.env.get('CLICKUP_API_TOKEN') ?? '';
const CLICKUP_LIST_ID = Deno.env.get('CLICKUP_LIST_ID') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function clickup(path: string, init: RequestInit = {}) {
  const method = (init.method ?? 'GET').toUpperCase();
  const res = await fetch(`${CLICKUP_API}${path}`, {
    ...init,
    headers: {
      Authorization: CLICKUP_API_TOKEN,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const headers = Object.fromEntries(res.headers.entries());
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  console.log(JSON.stringify({
    clickup_call: true,
    method,
    path,
    status: res.status,
    statusText: res.statusText,
    headers,
    body_raw: text.slice(0, 2048),
  }));
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers,
    body_raw: text,
    data,
  };
}

function errDetail(res: { status: number; statusText: string; headers: Record<string, string>; body_raw: string }) {
  const rl = {
    'x-ratelimit-limit': res.headers['x-ratelimit-limit'],
    'x-ratelimit-remaining': res.headers['x-ratelimit-remaining'],
    'x-ratelimit-reset': res.headers['x-ratelimit-reset'],
    'retry-after': res.headers['retry-after'],
    'x-trace-id': res.headers['x-trace-id'],
  };
  return `status=${res.status} ${res.statusText} rate=${JSON.stringify(rl)} body=${res.body_raw.slice(0, 500)}`;
}

// Fetch + cache ClickUp custom-field IDs for the target list.
async function loadFieldMap(): Promise<{
  map: Map<FieldName, ClickUpCustomField>;
  missing: FieldName[];
}> {
  const res = await clickup(`/list/${CLICKUP_LIST_ID}/field`);
  if (!res.ok) throw new Error(`ClickUp list fields fetch failed: ${res.status} ${JSON.stringify(res.data)}`);
  const fields: ClickUpCustomField[] = res.data?.fields ?? [];
  const byName = new Map(fields.map((f) => [f.name, f]));

  const map = new Map<FieldName, ClickUpCustomField>();
  const missing: FieldName[] = [];
  for (const name of MANAGED_FIELDS) {
    const f = byName.get(name);
    if (f) map.set(name, f);
    else missing.push(name);
  }

  // Cache the found IDs (fire-and-forget)
  if (map.size > 0) {
    const rows = [...map.entries()].map(([field_name, f]) => ({
      field_name,
      field_id: f.id,
      field_type: f.type,
      updated_at: new Date().toISOString(),
    }));
    await admin.from('crm_clickup_field_map').upsert(rows, { onConflict: 'field_name' });
  }

  return { map, missing };
}

interface ClientRow {
  id: string;
  tenant_id: string;
  pat_name_f: string | null;
  pat_name_l: string | null;
  pat_name_preferred: string | null;
  email: string | null;
  phone: string | null;
  pat_state: string | null;
  pat_status: string | null;
  primary_staff_id: string | null;
  clickup_task_id: string | null;
}

async function loadClient(clientId: string) {
  const { data, error } = await admin
    .from('clients')
    .select('id, tenant_id, pat_name_f, pat_name_l, pat_name_preferred, email, phone, pat_state, pat_status, primary_staff_id, clickup_task_id')
    .eq('id', clientId)
    .maybeSingle();
  if (error) throw error;
  return data as ClientRow | null;
}

async function loadTherapistName(staffId: string | null): Promise<string> {
  if (!staffId) return '';
  const { data } = await admin
    .from('staff')
    .select('prov_name_for_clients, prov_name_f, prov_name_l')
    .eq('id', staffId)
    .maybeSingle();
  if (!data) return '';
  return (
    data.prov_name_for_clients ||
    [data.prov_name_f, data.prov_name_l].filter(Boolean).join(' ') ||
    ''
  );
}

async function loadCampaignHistory(clientId: string): Promise<{ names: string; lastAtMs: number | null }> {
  const { data, error } = await admin
    .from('crm_campaign_enrollments')
    .select('created_at, campaign:crm_campaigns(name)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) return { names: '', lastAtMs: null };
  const rows = (data ?? []) as Array<{ created_at: string; campaign: { name: string | null } | null }>;
  const names = Array.from(
    new Set(rows.map((r) => r.campaign?.name).filter((n): n is string => !!n)),
  ).join(', ');
  const lastAtMs = rows.length > 0 ? new Date(rows[0].created_at).getTime() : null;
  return { names, lastAtMs };
}

function taskName(c: ClientRow): string {
  const combined = [c.pat_name_f, c.pat_name_l].filter(Boolean).join(' ').trim();
  if (combined) return combined;
  if (c.pat_name_preferred) return c.pat_name_preferred;
  return `Client ${c.id.slice(0, 8)}`;
}

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return '';
}

async function setCustomField(
  taskId: string,
  field: ClickUpCustomField,
  value: string | number | null,
): Promise<void> {
  // Skip empty text/number sends? ClickUp accepts empty string; date must be number.
  let payload: unknown;
  if (field.type === 'drop_down') {
    // Match by label name
    if (!value) {
      // Explicit clear
      payload = { value: null };
    } else {
      const opt = field.type_config?.options?.find(
        (o) => o.name?.toLowerCase() === String(value).toLowerCase(),
      );
      if (!opt) {
        console.warn(`Dropdown option not found on field "${field.name}": ${value}`);
        return;
      }
      payload = { value: opt.id };
    }
  } else if (field.type === 'date') {
    payload = { value: value == null ? null : Number(value) };
  } else {
    if (field.name === 'Phone' && (value == null || value === '')) return;
    payload = { value: value == null ? '' : String(value) };
  }

  const res = await clickup(`/task/${taskId}/field/${field.id}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`Set field "${field.name}" failed for task ${taskId}: ${res.status} ${JSON.stringify(res.data)}`);
  }
}

function buildFieldValues(
  client: ClientRow,
  therapistName: string,
  campaignNames: string,
  lastCampaignAtMs: number | null,
  nowMs: number,
): Record<FieldName, string | number | null> {
  return {
    'Supabase Client ID': client.id,
    'Email': client.email ?? '',
    'Phone': normalizePhone(client.phone),
    'Client Status - EHR': client.pat_status ?? '',
    'State': client.pat_state ?? '',
    'Assigned Therapist': therapistName,
    'Campaigns': campaignNames,
    'Last Campaign At': lastCampaignAtMs,
    'Last Synced At': nowMs,
    'Sync Source': SYNC_SOURCE,
  };
}

async function createTask(
  client: ClientRow,
  fieldMap: Map<FieldName, ClickUpCustomField>,
  values: Record<FieldName, string | number | null>,
): Promise<string> {
  // Build custom_fields inline for create for efficiency
  const custom_fields: Array<{ id: string; value: unknown }> = [];
  for (const name of MANAGED_FIELDS) {
    const field = fieldMap.get(name);
    if (!field) continue;
    const raw = values[name];
    if (field.type === 'drop_down') {
      if (!raw) continue;
      const opt = field.type_config?.options?.find(
        (o) => o.name?.toLowerCase() === String(raw).toLowerCase(),
      );
      if (opt) custom_fields.push({ id: field.id, value: opt.id });
    } else if (field.type === 'date') {
      if (raw != null) custom_fields.push({ id: field.id, value: Number(raw) });
    } else {
      if (name === 'Phone' && !raw) continue;
      custom_fields.push({ id: field.id, value: raw == null ? '' : String(raw) });
    }
  }

  const res = await clickup(`/list/${CLICKUP_LIST_ID}/task`, {
    method: 'POST',
    body: JSON.stringify({
      name: taskName(client),
      custom_fields,
    }),
  });
  if (!res.ok) throw new Error(`ClickUp create task failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.id as string;
}

async function updateTask(
  taskId: string,
  client: ClientRow,
  fieldMap: Map<FieldName, ClickUpCustomField>,
  values: Record<FieldName, string | number | null>,
): Promise<'ok' | 'not_found'> {
  const res = await clickup(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: taskName(client) }),
  });
  if (res.status === 404) return 'not_found';
  if (!res.ok) throw new Error(`ClickUp update task failed: ${res.status} ${JSON.stringify(res.data)}`);

  // Set custom fields sequentially (parallel would risk rate limits)
  for (const name of MANAGED_FIELDS) {
    const field = fieldMap.get(name);
    if (!field) continue;
    await setCustomField(taskId, field, values[name]);
  }
  return 'ok';
}

async function syncOne(clientId: string, fieldMap: Map<FieldName, ClickUpCustomField>): Promise<{ status: 'created' | 'updated' | 'recreated' | 'skipped'; taskId: string | null; error?: string }> {
  const client = await loadClient(clientId);
  if (!client) return { status: 'skipped', taskId: null, error: 'client_not_found' };

  const [therapistName, history] = await Promise.all([
    loadTherapistName(client.primary_staff_id),
    loadCampaignHistory(client.id),
  ]);

  const nowMs = Date.now();
  const values = buildFieldValues(client, therapistName, history.names, history.lastAtMs, nowMs);

  let taskId = client.clickup_task_id;
  let outcome: 'created' | 'updated' | 'recreated';

  if (!taskId) {
    taskId = await createTask(client, fieldMap, values);
    outcome = 'created';
  } else {
    const upd = await updateTask(taskId, client, fieldMap, values);
    if (upd === 'not_found') {
      taskId = await createTask(client, fieldMap, values);
      outcome = 'recreated';
    } else {
      outcome = 'updated';
    }
  }

  await admin
    .from('clients')
    .update({ clickup_task_id: taskId, clickup_synced_at: new Date(nowMs).toISOString() })
    .eq('id', client.id);

  await admin.from('crm_activity_events').insert({
    tenant_id: client.tenant_id,
    client_id: client.id,
    event_type: 'client_synced_to_clickup',
    new_value: outcome,
    metadata: { task_id: taskId, list_id: CLICKUP_LIST_ID },
  });

  return { status: outcome, taskId };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const provided = req.headers.get('x-cron-secret') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  let authorized = !!CRON_SECRET && provided === CRON_SECRET;
  if (!authorized && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const { data, error } = await admin.auth.getClaims(token);
    if (!error && data?.claims?.sub) authorized = true;
  }
  if (!authorized) {
    return json(401, { error: 'unauthorized' });
  }
  if (!CLICKUP_API_TOKEN || !CLICKUP_LIST_ID) {
    return json(500, { error: 'clickup_not_configured' });
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = body?.action ?? 'upsert';

  try {
    const { map: fieldMap, missing } = await loadFieldMap();
    if (missing.length === MANAGED_FIELDS.length) {
      return json(500, { error: 'no_managed_fields_found_on_list', missing });
    }

    if (action === 'upsert') {
      const clientId = body?.client_id as string | undefined;
      if (!clientId) return json(400, { error: 'client_id_required' });
      const result = await syncOne(clientId, fieldMap);
      return json(200, { ...result, missing_fields: missing });
    }

    if (action === 'backfill') {
      const tenantId = body?.tenant_id as string | undefined;
      const limit = Math.min(Number(body?.limit ?? 50), 2000);
      const offset = Math.max(Number(body?.offset ?? 0), 0);
      const onlyUnsynced = Boolean(body?.only_unsynced ?? false);
      let q = admin.from('clients').select('id').order('updated_at', { ascending: false }).range(offset, offset + limit - 1);
      if (tenantId) q = q.eq('tenant_id', tenantId);
      if (onlyUnsynced) q = q.is('clickup_task_id', null);
      const { data, error } = await q;
      if (error) throw error;
      const ids = (data ?? []).map((r: { id: string }) => r.id);

      let created = 0, updated = 0, recreated = 0, skipped = 0, failed = 0;
      for (const id of ids) {
        try {
          const r = await syncOne(id, fieldMap);
          if (r.status === 'created') created++;
          else if (r.status === 'updated') updated++;
          else if (r.status === 'recreated') recreated++;
          else skipped++;
        } catch (e) {
          failed++;
          console.error('backfill sync failed for', id, e);
        }
      }
      return json(200, { total: ids.length, created, updated, recreated, skipped, failed, missing_fields: missing });
    }

    return json(400, { error: 'unknown_action', action });
  } catch (e) {
    console.error('clickup-sync error', e);
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
