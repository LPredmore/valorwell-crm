import { allowedApplicantSourceStatuses } from './applicant-source-transitions';
import { allowedBtySourceStatuses } from './bty-source-transitions';

export type MutableConnectedSource = 'relationship_opportunities' | 'provider_applicants';
type SourceAction = {
  source: MutableConnectedSource;
  label: string;
  guidance: string;
  destinations: readonly string[];
  requiresFollowup: boolean;
};
/** Presentation registry; authoritative source mutations remain behind their
 * dedicated server-side audited and permission-checked RPCs. */
export function connectedSourceAction(source: string | null, currentStatus: string): SourceAction | null {
  if (source === 'relationship_opportunities') return {
    source, label: 'Change BTY stage', requiresFollowup: false,
    guidance: 'This updates the audited source BTY opportunity. Record only changes that actually occurred.',
    destinations: allowedBtySourceStatuses(currentStatus),
  };
  if (source === 'provider_applicants') return {
    source, label: 'Update applicant stage', requiresFollowup: currentStatus==='contacted',
    guidance: currentStatus==='interview_scheduled'||currentStatus==='interview_completed'
      ? 'Record your actual interview decision. Accepted is a pipeline status only; it does not create a staff account or send an onboarding invitation.'
      : currentStatus==='screening'
        ? 'Manually approve this applicant for interview only after reviewing the qualification flags.'
        : 'This uses the authorized staff applicant workflow; application submissions are qualified automatically.',
    destinations: allowedApplicantSourceStatuses(currentStatus),
  };
  return null;
}
