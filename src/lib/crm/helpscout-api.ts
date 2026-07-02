import { supabase } from '@/integrations/supabase/client';

const HELPSCOUT_PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/helpscout-proxy`;

export type HelpScoutAction =
  | 'test-connection'
  | 'list-conversations'
  | 'get-conversation'
  | 'reply'
  | 'create-conversation'
  | 'search-customers'
  | 'bulk-send';

export interface HelpScoutApiOptions {
  params?: Record<string, string>;
  body?: unknown;
  method?: 'GET' | 'POST';
}

export class HelpScoutApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: unknown
  ) {
    super(message);
    this.name = 'HelpScoutApiError';
  }
}

/**
 * Centralized helper for all HelpScout API calls via the edge function proxy.
 * Handles auth, URL construction, and standardized error handling.
 */
export async function helpscoutApi<T = unknown>(
  action: HelpScoutAction,
  options: HelpScoutApiOptions = {}
): Promise<T> {
  const { params, body, method = body ? 'POST' : 'GET' } = options;

  // Get current session for auth header
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new HelpScoutApiError('Not authenticated', 401);
  }

  // Build URL with action and optional params
  const url = new URL(HELPSCOUT_PROXY_URL);
  url.searchParams.set('action', action);
  
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  // Make request
  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    ...(body && { body: JSON.stringify(body) }),
  });

  // Parse response
  let responseData: unknown;
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    responseData = await response.json();
  } else {
    responseData = await response.text();
  }

  // Handle errors
  if (!response.ok) {
    const errorMessage = typeof responseData === 'object' && responseData !== null && 'error' in responseData
      ? (responseData as { error: string }).error
      : `HelpScout API error: ${response.status}`;
    
    throw new HelpScoutApiError(errorMessage, response.status, responseData);
  }

  return responseData as T;
}
