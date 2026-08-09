export type RelationshipActivity = {
  id: string;
  activityType: string;
  source: string;
  occurredAt: string;
  processingStatus: 'received' | 'applied' | 'ignored' | 'ambiguous' | 'failed';
  errorCode?: string;
  errorReason?: string;
  metadata: Record<string, unknown>;
};

export type RelationshipOrchestration = {
  activities: RelationshipActivity[];
  enrollments: Array<{ id: string; campaignId: string; status: string; deliveryEnabled: boolean; currentStepPosition?: number; nextScheduledAt?: string; stoppedReason?: string; respondedAt?: string }>;
  communications: Array<{ id: string; direction: string; status: string; provider?: string; subject?: string; occurredAt: string; enrollmentId?: string }>;
  replyWorkflow: Array<{ id: string; status: string; followUpDueAt?: string; createdAt: string }>;
  meetings: Array<{ id: string; eventStatus: string; startsAt?: string; endsAt?: string; streamyardUrl?: string; calendarId: string; externalEventId: string }>;
  issues: Array<{ id: string; issueType: string; severity: string; status: string; summary: string; createdAt: string }>;
};

export type RelationshipIntegrity = {
  flags: Record<string, boolean>;
  connections: Array<{ id: string; connectionType: 'gmail' | 'calendar'; googleAccountEmail: string; calendarId?: string; scopes: string[]; status: string; lastVerifiedAt?: string; lastErrorCode?: string; lastErrorReason?: string; watchExpiration?: string; lastSuccessfulSyncAt?: string; lastFullReconciliationAt?: string }>;
  invariants: Record<string, number>;
  issues: Array<{ id: string; issueType: string; severity: string; status: string; opportunityId?: string; source: string; summary: string; details: Record<string, unknown>; createdAt: string }>;
};

export type OperatorActivityType = 'interest_confirmed' | 'scheduling_started' | 'declined' | 'nurture_set' | 'recording_completed';
