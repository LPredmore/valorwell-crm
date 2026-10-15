import { supabase } from '@/integrations/supabase/client';
import { parseZeffyDonationReport } from '@/domain/donations/zeffy-report';

export async function getZeffyDonationReport(tenantId: string) {
  const { data, error } = await supabase.functions.invoke('zeffy-donation-report', { body: { tenantId } });
  if (error) throw new Error('Zeffy payment reporting is unavailable. Configuration or deployment may still be pending.');
  return parseZeffyDonationReport(data, tenantId);
}
