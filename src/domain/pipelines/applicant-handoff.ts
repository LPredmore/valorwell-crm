/** Read-only projection of the existing staff-authorized applicant contract.
 * A linked staff record is not evidence of invitation delivery or credentialing.
 */
export type ApplicantHandoff = {
  ownerName: string | null;
  convertedStaffId: string | null;
};

export function applicantHandoffMessage(status: string, handoff: ApplicantHandoff): string {
  if (handoff.convertedStaffId) {
    return 'A staff record is linked. Confirm invitation and onboarding progress in the staff workspace.';
  }
  if (status === 'ready') {
    return 'Approved; no linked staff record is reported. Review onboarding in the staff workspace before retrying.';
  }
  if (status === 'hired') {
    return 'Onboarding is marked started, but no linked staff record is reported. Reconcile the source record in the staff workspace.';
  }
  return 'Approval and onboarding are managed in the staff workspace. Review the assigned owner and next action before handoff.';
}
