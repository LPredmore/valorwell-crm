import { describe, expect, it } from 'vitest';
import type { Json } from '@/integrations/supabase/types';
import {
  allowedCampaignTransitions,
  campaignActivationErrors,
  campaignDefinitionErrors,
  emptyRelationshipCampaignDefinition,
} from '@/domain/relationships/campaign-workflow';
import {
  mapRelationshipCampaignResponse,
  relationshipCampaignPayload,
  relationshipCampaignStepsPayload,
} from '@/repositories/supabase/relationships-campaign-mappers';

describe('relationship campaign foundation', () => {
  it('keeps execution outside the campaign definition contract', () => {
    const definition = emptyRelationshipCampaignDefinition();
    definition.name = 'Partner introduction';
    definition.purpose = 'Create one defined partnership conversation.';
    definition.senderName = 'ValorWell';
    definition.senderEmail = 'outreach@example.org';

    expect(campaignDefinitionErrors(definition)).toEqual([]);
    expect(relationshipCampaignPayload(definition)).not.toHaveProperty('executionEnabled');
    expect(relationshipCampaignStepsPayload(definition)).toEqual([{
      subjectTemplate: '',
      bodyTemplate: '',
      delayDays: 0,
      stopOnReply: true,
      isActive: true,
    }]);
  });

  it('requires the canonical campaign brief and a ready lifecycle before activation', () => {
    const definition = emptyRelationshipCampaignDefinition();
    definition.name = 'Partner introduction';
    definition.purpose = 'Create one defined partnership conversation.';
    definition.senderName = 'ValorWell';
    definition.senderEmail = 'outreach@example.org';
    definition.steps[0].subjectTemplate = 'Introduction';
    definition.steps[0].bodyTemplate = 'Hello';

    expect(campaignActivationErrors(definition)).toContain('sourceDomain is required.');
    expect(campaignActivationErrors(definition)).toContain('Marketing lifecycle must be Ready before activation.');

    definition.marketingLifecycleStage = 'ready';
    Object.assign(definition.brief, {
      sourceDomain: 'Business Development',
      audience: 'Named partner organizations',
      objective: 'Create one qualified conversation.',
      primaryConversion: 'Qualified reply',
      cta: 'Reply',
      destination: 'Email reply',
      channel: 'Email',
      budgetClass: 'Organic',
      attributionSource: 'Campaign ID',
      receivingDomain: 'Business Development',
      primaryMetric: 'Qualified replies',
      pauseReviewTriggers: ['Replies have no owner'],
    });

    expect(campaignActivationErrors(definition)).toEqual([]);
  });

  it('enforces the approved definition lifecycle graph', () => {
    expect(allowedCampaignTransitions('draft')).toEqual(['active', 'archived']);
    expect(allowedCampaignTransitions('active')).toEqual(['paused', 'completed']);
    expect(allowedCampaignTransitions('paused')).toEqual(['active', 'completed', 'archived']);
    expect(allowedCampaignTransitions('completed')).toEqual(['archived']);
    expect(allowedCampaignTransitions('archived')).toEqual([]);
  });

  it('maps a server campaign without inventing unavailable metrics', () => {
    const campaign = mapRelationshipCampaignResponse({
      id: 'campaign-1',
      name: 'Partner introduction',
      purpose: 'Create one qualified conversation.',
      senderName: 'ValorWell',
      senderEmail: 'outreach@example.org',
      status: 'active',
      marketingLifecycleStage: 'live',
      brief: {
        sourceDomain: 'Business Development',
        audience: 'Named partners',
        excludedAudiences: [],
        operatingDependencies: [],
        pauseReviewTriggers: ['No response owner'],
      },
      defaultTimezone: 'America/Chicago',
      weekdaysOnly: true,
      executionEnabled: false,
      version: 2,
      steps: [{
        id: 'step-1',
        position: 1,
        subjectTemplate: 'Hello',
        bodyTemplate: 'Body',
        delayDays: 0,
        stopOnReply: true,
        isActive: true,
      }],
      metricsAvailable: false,
      createdAt: '2026-07-21T00:00:00Z',
      updatedAt: '2026-07-21T00:01:00Z',
    } as unknown as Json);

    expect(campaign.executionEnabled).toBe(false);
    expect(campaign.metricsAvailable).toBe(false);
    expect(campaign.enrollmentCount).toBeUndefined();
    expect(campaign.steps).toHaveLength(1);
  });
});
