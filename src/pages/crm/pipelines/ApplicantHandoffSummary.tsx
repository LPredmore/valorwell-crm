import { applicantHandoffMessage } from '@/domain/pipelines/applicant-handoff';
import type { ConnectedPipelineCard } from '@/repositories/supabase/connected-pipeline-cards';

/** Uses only the already authorized applicant response; never provisions staff. */
export function ApplicantHandoffSummary({ card }: { card: ConnectedPipelineCard }) {
  if (card.sourceKind !== 'provider_applicant' || !card.applicantHandoff) return null;
  return <details className="rounded border p-2 text-xs">
    <summary className="cursor-pointer font-medium">Recruitment → staff handoff</summary>
    <div className="mt-2 space-y-2">
      <p>Owner: {card.applicantHandoff.ownerName || 'Unassigned or unavailable'}</p>
      <p>{applicantHandoffMessage(card.sourceStatus ?? '', card.applicantHandoff)}</p>
      <p className="break-all">Application reference: {card.id}</p>
      {card.applicantHandoff.convertedStaffId && <p className="break-all">
        Linked staff reference: {card.applicantHandoff.convertedStaffId}
      </p>}
      <p>Open the source workspace and find this application by name or reference. Review existing staff linkage before retrying onboarding.</p>
      <p>State and license fields describe the application; payer enrollment, network availability and credentialing require separate source confirmation.</p>
      <a className="underline" href="https://emr.valorwell.org/staff/provider-applicants"
        target="_blank" rel="noopener noreferrer">Open staff applicant workspace</a>
    </div>
  </details>;
}
