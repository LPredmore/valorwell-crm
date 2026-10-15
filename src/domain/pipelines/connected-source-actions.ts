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

/** Presentation registry only. Each adapter retains its own source validation,
 * server permission/version/audit contract and lifecycle rules.
 */
export function connectedSourceAction(source: string | null, currentStatus: string): SourceAction | null {
  if (source === 'relationship_opportunities') return {
    source, label: 'Change BTY stage', requiresFollowup: false,
    guidance: 'This updates the audited source BTY opportunity. Campaign readiness is managed through the existing approval workflow because it can trigger enrollment. Record only changes that actually occurred.',
    destinations: allowedBtySourceStatuses(currentStatus),
  };
  if (source === 'provider_applicants') return {
    source, label: 'Update applicant stage', requiresFollowup: true,
    guidance: 'Contacted → Screening uses the existing staff-authorized contract. First-contact delivery, approval and onboarding invitations remain in the staff applicant workspace.',
    destinations: allowedApplicantSourceStatuses(currentStatus),
  };
  return null;
}
