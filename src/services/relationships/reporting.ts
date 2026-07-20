import type { CapabilityAvailability, RelationshipReportMetric } from '@/domain/relationships/contracts';

export type RelationshipReportingFacts = {
  organizations: number;
  contacts: number;
  activeOpportunities: number;
  activeCampaigns: number;
  enrollments: number;
  sends: number;
  replies: number;
  suppressions: number;
  unsubscribes: number;
  failures: number;
  upcomingSends: number;
};

const metricDefinitions: Array<[keyof RelationshipReportingFacts, string]> = [
  ['organizations', 'Organizations'], ['contacts', 'Contacts'], ['activeOpportunities', 'Active opportunities'],
  ['activeCampaigns', 'Active campaigns'], ['enrollments', 'Enrollments'], ['sends', 'Sends'],
  ['replies', 'Replies'], ['suppressions', 'Suppressions'], ['unsubscribes', 'Unsubscribes'],
  ['failures', 'Failures'], ['upcomingSends', 'Upcoming sends'],
];

/** Builds reporting values only from supplied relationship facts; unavailable data is never represented as zero. */
export function relationshipReportMetrics(input: { facts?: RelationshipReportingFacts; capability?: CapabilityAvailability }): RelationshipReportMetric[] {
  if (!input.facts || input.capability?.available !== true) {
    const reason = input.capability?.reason ?? 'Relationship reporting capability is pending.';
    return metricDefinitions.map(([key, label]) => ({ key, label, unavailableReason: reason }));
  }
  return metricDefinitions.map(([key, label]) => ({ key, label, value: input.facts?.[key] }));
}
