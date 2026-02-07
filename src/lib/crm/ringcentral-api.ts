import { supabase } from '@/integrations/supabase/client';

interface RingCentralApiOptions {
  params?: Record<string, unknown>;
}

/**
 * Call the RingCentral SMS edge function
 */
export async function ringcentralApi(
  action: string,
  options: RingCentralApiOptions = {}
): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('ringcentral-sms', {
    body: {
      action,
      ...options.params,
    },
  });

  if (error) {
    console.error('RingCentral API error:', error);
    throw new Error(error.message || 'RingCentral API call failed');
  }

  return data;
}
