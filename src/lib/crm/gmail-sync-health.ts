export type GmailHealth = 'unknown' | 'healthy' | 'warning' | 'critical';

export function gmailSyncHealth(seconds: number | null | undefined): GmailHealth {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'unknown';
  if (seconds >= 240 * 60) return 'critical';
  if (seconds >= 60 * 60) return 'warning';
  return 'healthy';
}

export function gmailContractMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const row = error as { code?: string; message?: string };
  return row.code === 'PGRST202' || /Could not find the function public\..*relationship.*(?:schema cache)?/i.test(row.message ?? '');
}