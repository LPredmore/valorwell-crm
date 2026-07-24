import { describe, expect, it } from 'vitest';
import type { Json } from '@/integrations/supabase/types';
import { campaignToDefinition, emptyRelationshipCampaignDefinition } from '@/domain/relationships/campaign-workflow';
import {
  mapRelationshipCampaignResponse,
  relationshipCampaignStepsPayload,
} from '@/repositories/supabase/relationships-campaign-mappers';

const canonicalContent = {
  schemaVersion: 1,
  mode: 'campaign' as const,
  editorDocument: {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello {{contact_first_name}}' }] }],
  },
  renderedHtml: '<p>Hello {{contact_first_name}}</p>',
  renderedText: 'Hello {{contact_first_name}}',
  preheader: 'A relationship update',
  themeKey: 'plain-outreach',
  renderHash: 'fnv1a32:1234abcd',
};

describe('Email Studio relationship campaign integration', () => {
  it('serializes canonical campaign snapshots only when present', () => {
    const definition = emptyRelationshipCampaignDefinition();
    definition.steps[0] = {
      subjectTemplate: 'Hello {{contact_first_name}}',
      bodyTemplate: canonicalContent.renderedText,
      emailContent: canonicalContent,
      templateId: '11111111-1111-4111-8111-111111111111',
      templateVersionId: '22222222-2222-4222-8222-222222222222',
      delayDays: 2,
      stopOnReply: true,
      isActive: true,
    };

    expect(relationshipCampaignStepsPayload(definition)).toEqual([{
      subjectTemplate: 'Hello {{contact_first_name}}',
      bodyTemplate: 'Hello {{contact_first_name}}',
      delayDays: 2,
      stopOnReply: true,
      isActive: true,
      contentMode: 'campaign',
      editorDocument: canonicalContent.editorDocument,
      renderedHtml: canonicalContent.renderedHtml,
      renderedText: canonicalContent.renderedText,
      preheader: canonicalContent.preheader,
      themeKey: canonicalContent.themeKey,
      editorSchemaVersion: canonicalContent.schemaVersion,
      renderHash: canonicalContent.renderHash,
      templateId: '11111111-1111-4111-8111-111111111111',
      templateVersionId: '22222222-2222-4222-8222-222222222222',
    }]);
  });

  it('round-trips canonical snapshots and immutable template attribution', () => {
    const campaign = mapRelationshipCampaignResponse({
      id: 'campaign-1',
      name: 'Partner introduction',
      purpose: 'Create a qualified conversation.',
      senderName: 'ValorWell',
      senderEmail: 'outreach@example.org',
      status: 'draft',
      marketingLifecycleStage: 'ready',
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
      version: 3,
      steps: [{
        id: 'step-1',
        position: 1,
        subjectTemplate: 'Hello {{contact_first_name}}',
        bodyTemplate: canonicalContent.renderedText,
        contentMode: 'campaign',
        editorDocument: canonicalContent.editorDocument,
        renderedHtml: canonicalContent.renderedHtml,
        renderedText: canonicalContent.renderedText,
        preheader: canonicalContent.preheader,
        themeKey: canonicalContent.themeKey,
        editorSchemaVersion: canonicalContent.schemaVersion,
        renderHash: canonicalContent.renderHash,
        templateId: '11111111-1111-4111-8111-111111111111',
        templateVersionId: '22222222-2222-4222-8222-222222222222',
        delayDays: 0,
        stopOnReply: true,
        isActive: true,
      }],
      metricsAvailable: false,
      createdAt: '2026-07-24T00:00:00Z',
      updatedAt: '2026-07-24T00:01:00Z',
    } as unknown as Json);

    const definition = campaignToDefinition(campaign);
    expect(definition.steps[0].emailContent).toEqual(canonicalContent);
    expect(definition.steps[0].templateId).toBe('11111111-1111-4111-8111-111111111111');
    expect(definition.steps[0].templateVersionId).toBe('22222222-2222-4222-8222-222222222222');
    expect(relationshipCampaignStepsPayload(definition)).toEqual([
      expect.objectContaining({
        contentMode: 'campaign',
        renderedHtml: canonicalContent.renderedHtml,
        renderedText: canonicalContent.renderedText,
        renderHash: canonicalContent.renderHash,
        templateVersionId: '22222222-2222-4222-8222-222222222222',
      }),
    ]);
  });

  it('keeps legacy text-only steps backward compatible', () => {
    const definition = emptyRelationshipCampaignDefinition();
    definition.steps[0] = {
      subjectTemplate: 'Legacy subject',
      bodyTemplate: 'Legacy body',
      delayDays: 0,
      stopOnReply: true,
      isActive: true,
    };

    expect(relationshipCampaignStepsPayload(definition)).toEqual([{
      subjectTemplate: 'Legacy subject',
      bodyTemplate: 'Legacy body',
      delayDays: 0,
      stopOnReply: true,
      isActive: true,
    }]);
  });
});
