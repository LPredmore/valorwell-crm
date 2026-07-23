import { describe, expect, it } from 'vitest';
import {
  cloneEmailStudioSpikeDocument,
  collectEmailStudioVariableKeys,
  createEmailStudioSpikeDocument,
} from '@/features/email-studio/spike/documents';
import {
  EMAIL_STUDIO_RENDERING_DECISION,
  EMAIL_STUDIO_SPIKE_MODES,
} from '@/features/email-studio/spike/types';

function collectNodeTypes(node: { type: string; content?: Array<{ type: string; content?: unknown[] }> }): string[] {
  const childTypes = (node.content ?? []).flatMap((child) =>
    collectNodeTypes(child as { type: string; content?: Array<{ type: string; content?: unknown[] }> }),
  );
  return [node.type, ...childTypes];
}

describe('email studio pass 1 spike', () => {
  it.each(EMAIL_STUDIO_SPIKE_MODES)('creates a reloadable %s document', (mode) => {
    const document = createEmailStudioSpikeDocument(mode);
    const cloned = cloneEmailStudioSpikeDocument(document);

    expect(document.type).toBe('doc');
    expect(document.content.length).toBeGreaterThan(0);
    expect(cloned).toEqual(document);
    expect(cloned).not.toBe(document);
    expect(cloned.content).not.toBe(document.content);
  });

  it('seeds structured variables instead of unrestricted token text', () => {
    expect(collectEmailStudioVariableKeys(createEmailStudioSpikeDocument('direct'))).toEqual(['first_name']);
    expect(collectEmailStudioVariableKeys(createEmailStudioSpikeDocument('campaign'))).toEqual(['first_name']);
    expect(collectEmailStudioVariableKeys(createEmailStudioSpikeDocument('newsletter'))).toEqual([
      'organization_name',
      'unsubscribe_url',
    ]);
  });

  it('includes the custom ValorWell callout in campaign and newsletter prototypes', () => {
    const campaignTypes = collectNodeTypes(createEmailStudioSpikeDocument('campaign'));
    const newsletterTypes = collectNodeTypes(createEmailStudioSpikeDocument('newsletter'));

    expect(campaignTypes).toContain('valorWellCallout');
    expect(newsletterTypes).toContain('valorWellCallout');
  });

  it('records the conservative rendering authority decision', () => {
    expect(EMAIL_STUDIO_RENDERING_DECISION.strategy).toBe('client_export_server_validation');
    expect(EMAIL_STUDIO_RENDERING_DECISION.reason).toContain('server validation');
    expect(EMAIL_STUDIO_RENDERING_DECISION.reason).toContain('Deno');
  });
});
