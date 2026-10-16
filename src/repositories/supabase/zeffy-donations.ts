import { supabase } from '@/integrations/supabase/client';
import { parseZeffyDonationReport } from '@/domain/donations/zeffy-report';

export const ZEFFY_REPORT_TIMEOUT_MS = 30_000;
const errorMessages: Record<string, string> = {
  configuration_unavailable: 'The donation report is missing server configuration. An administrator needs to check the report function.',
  authentication_required: 'Sign in again, then refresh the donation report.',
  crm_access_denied: 'Your account cannot read donation reports for this workspace. Refresh your session or contact an administrator.',
  tenant_access_denied: 'This workspace is no longer available to your account. Select an authorized CRM workspace.',
  ledger_unavailable: 'The donation ledger could not be read. An administrator needs to check the report function and database access.',
  report_contract_invalid: 'The donation report returned an unexpected format. No totals are shown; contact an administrator.',
  report_timeout: 'The donation report took too long to respond. Check your connection and try Refresh report again.',
  report_unavailable: 'The donation report is temporarily unavailable. Try Refresh report again.',
};

export async function getZeffyDonationReport(tenantId: string, options: { signal?: AbortSignal } = {}) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  // The outer deadline also bounds session/token retrieval before the SDK fetch.
  const interrupted = new Promise<never>((_, reject) => {
    cancel = () => { controller.abort(); reject(new DOMException('Report request cancelled', 'AbortError')); };
    if (options.signal?.aborted) { cancel(); return; }
    options.signal?.addEventListener('abort', cancel, { once: true });
    timeout = setTimeout(() => {
      controller.abort(); reject(new Error(errorMessages.report_timeout));
    }, ZEFFY_REPORT_TIMEOUT_MS);
  });
  const operation = async () => {
    if (controller.signal.aborted) throw new DOMException('Report request cancelled', 'AbortError');
    const { data, error } = await supabase.functions.invoke<unknown>('zeffy-donation-report', {
      body: { tenantId }, signal: controller.signal, timeout: ZEFFY_REPORT_TIMEOUT_MS,
    });
    if (error) {
      const response = (error as { context?: unknown }).context;
      if (response instanceof Response) {
        let code: unknown;
        try { const body = await response.clone().json(); code = body?.code; } catch { /* Use sanitized status below. */ }
        // Never surface arbitrary backend/provider bodies or error messages.
        if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(errorMessages, code)) throw new Error(errorMessages[code]);
        if (response.status === 401) throw new Error(errorMessages.authentication_required);
        if (response.status === 403) throw new Error(errorMessages.crm_access_denied);
        if (response.status === 429) throw new Error('Too many report requests. Wait a moment and try again.');
        if (response.status === 504) throw new Error(errorMessages.report_timeout);
        throw new Error(errorMessages.report_unavailable);
      }
      throw new Error('The donation report could not connect. Check your connection or the CRM report service, then try again.');
    }
    return parseZeffyDonationReport(data, tenantId);
  };
  try { return await Promise.race([interrupted, operation()]); }
  finally {
    if (timeout) clearTimeout(timeout);
    if (cancel) options.signal?.removeEventListener('abort', cancel);
  }
}
