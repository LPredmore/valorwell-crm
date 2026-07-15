export type ReportName =
  | 'funnel'
  | 'engagement'
  | 'closure'
  | 'campaigns'
  | 'tasks'
  | 'exceptions';

export type ReportViewName =
  | 'v_crm_reports_funnel'
  | 'v_crm_reports_engagement'
  | 'v_crm_reports_closure'
  | 'v_crm_reports_campaigns'
  | 'v_crm_reports_tasks'
  | 'v_crm_reports_exceptions';

export type ReportQueryErrorKind = 'missing-contract' | 'query-failed';

interface SupabaseReportError {
  code?: string;
  message: string;
}

export class ReportQueryError extends Error {
  readonly report: ReportName;
  readonly view: ReportViewName;
  readonly kind: ReportQueryErrorKind;

  constructor(
    report: ReportName,
    view: ReportViewName,
    kind: ReportQueryErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ReportQueryError';
    this.report = report;
    this.view = view;
    this.kind = kind;
  }
}

function isMissingContractFailure(
  view: ReportViewName,
  error: SupabaseReportError,
): boolean {
  const namesExpectedView = error.message.toLowerCase().includes(view);
  if (!namesExpectedView) return false;

  return error.code === '42P01'
    || error.code === 'PGRST205'
    || /relation .* does not exist/i.test(error.message)
    || /could not find the (?:table|view)/i.test(error.message)
    || /schema cache.*(?:table|view)/i.test(error.message)
    || /(?:table|view).*schema cache/i.test(error.message);
}

export function toReportQueryError(
  report: ReportName,
  view: ReportViewName,
  error: SupabaseReportError,
): ReportQueryError {
  return new ReportQueryError(
    report,
    view,
    isMissingContractFailure(view, error) ? 'missing-contract' : 'query-failed',
    error.message,
  );
}

export function isMissingReportContractError(error: unknown): error is ReportQueryError {
  return error instanceof ReportQueryError && error.kind === 'missing-contract';
}
