import { supabase } from '@/integrations/supabase/client';

const RESEND_EMAIL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/crm-resend-email`;

export type ResendEmailAction = 'test-connection' | 'send' | 'bulk-send';

export interface ResendEmailApiOptions {
  params?: Record<string, string>;
  body?: unknown;
  method?: 'GET' | 'POST';
}

export class ResendEmailApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: unknown,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ResendEmailApiError';
  }
}

export async function resendEmailApi<T = unknown>(
  action: ResendEmailAction,
  options: ResendEmailApiOptions = {},
): Promise<T> {
  const { params, body, method = body ? 'POST' : 'GET' } = options;
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) throw new ResendEmailApiError('Not authenticated', 401);

  const url = new URL(RESEND_EMAIL_URL);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const contentType = response.headers.get('content-type');
  const responseData: unknown = contentType?.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const responseObject =
      typeof responseData === 'object' && responseData !== null
        ? (responseData as Record<string, unknown>)
        : null;
    const requestId = responseObject?.requestId ? String(responseObject.requestId) : undefined;
    const baseMessage = responseObject && 'error' in responseObject
      ? String(responseObject.error)
      : `Resend email API error: ${response.status}`;
    const message = requestId ? `${baseMessage} (Request ID: ${requestId})` : baseMessage;
    throw new ResendEmailApiError(message, response.status, responseData, requestId);
  }

  return responseData as T;
}
