import { isMissingReportContractError } from '@/repositories/reportErrors';

export type ReportPanelStatus =
  | 'loading'
  | 'empty'
  | 'missing-contract'
  | 'error'
  | 'ready';

export interface ReportPanelStateInput {
  data: unknown;
  error: unknown;
  isPending: boolean;
}

export function getReportPanelStatus({
  data,
  error,
  isPending,
}: ReportPanelStateInput): ReportPanelStatus {
  if (isPending) return 'loading';
  if (error) return isMissingReportContractError(error) ? 'missing-contract' : 'error';
  if (data === null || data === undefined) return 'empty';
  return 'ready';
}
