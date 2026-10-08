import { describe, expect, it } from 'vitest';
import { prepareOrganizationSubmissionInput, validateOrganizationInput } from '@/domain/relationships/organization-form';

describe('BTY feature rules', () => {
  it('accepts valorwell.org and www.valorwell.org only', () => {
    expect(validateOrganizationInput({ name: 'A', btyFeatureUrl: 'https://www.valorwell.org/acp' }).valid).toBe(true);
    expect(validateOrganizationInput({ name: 'A', btyFeatureUrl: 'https://valorwell.org/acp' }).valid).toBe(true);
    expect(validateOrganizationInput({ name: 'A', btyFeatureUrl: 'https://evil.com/valorwell.org/' }).valid).toBe(false);
    expect(validateOrganizationInput({ name: 'A', btyFeatureUrl: 'http://valorwell.org/acp' }).valid).toBe(false);
  });
  it('requires URL and summary to publish', () => {
    expect(validateOrganizationInput({ name: 'A', btyFeatureStatus: 'published', btyFeatureSummary: ' ' }).fieldErrors)
      .toMatchObject({ btyFeatureUrl: expect.any(String), btyFeatureSummary: expect.any(String) });
  });
  it('allows empty fields in draft', () => {
    expect(validateOrganizationInput({ name: 'A', btyFeatureStatus: 'draft', btyFeatureUrl: '', btyFeatureSummary: '' }).valid).toBe(true);
  });
  it('stamps published date only on first publish', () => {
    const now = () => new Date('2026-10-08T12:00:00Z');
    expect(prepareOrganizationSubmissionInput({ btyFeatureStatus: 'published' }, { now }).btyPublishedAt).toBe('2026-10-08T12:00:00.000Z');
    expect(prepareOrganizationSubmissionInput({ btyFeatureStatus: 'published', btyPublishedAt: '2026-09-08T00:00:00Z' }, { now }).btyPublishedAt).toBe('2026-09-08T00:00:00Z');
    expect(prepareOrganizationSubmissionInput({ btyFeatureStatus: 'draft' }, { now }).btyPublishedAt).toBeUndefined();
  });
});
