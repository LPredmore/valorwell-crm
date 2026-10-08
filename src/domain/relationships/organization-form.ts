import type { ValidationResult } from './contracts';
import type { RelationshipOrganizationInput } from './records';

export const VALORWELL_FEATURE_URL_PATTERN = /^https:\/\/(www\.)?valorwell\.org\/\S*$/i;

/**
 * BTY feature fields keep '' (not undefined) so an edit can clear a value;
 * the repository maps blank text to NULL.
 */
export function prepareOrganizationSubmissionInput(
  input: Partial<RelationshipOrganizationInput>,
  options: { now?: () => Date } = {},
): Partial<RelationshipOrganizationInput> {
  const prepared: Partial<RelationshipOrganizationInput> = {
    ...input,
    name: input.name?.trim(),
    website: input.website?.trim() || undefined,
    organizationKind: input.organizationKind?.trim() || undefined,
    ownerId: input.ownerId?.trim() || undefined,
    nextAction: input.nextAction?.trim() || undefined,
    nextActionDueAt: input.nextActionDueAt || undefined,
  };
  for (const key of ['btyFeatureUrl', 'btyFeatureSummary', 'btyVideoId', 'btyFeatureImageUrl'] as const) {
    if (input[key] !== undefined) prepared[key] = input[key]!.trim();
  }
  // Stamp the first publish only; drafts and existing dates are left untouched.
  if (input.btyFeatureStatus === 'published' && !input.btyPublishedAt) {
    prepared.btyPublishedAt = (options.now ?? (() => new Date()))().toISOString();
  }
  return prepared;
}

/** Application-side guard; repository and tenant RLS remain write authority. */
export function validateOrganizationInput(
  input: Partial<RelationshipOrganizationInput>,
): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  if (!input.name?.trim()) fieldErrors.name = 'Organization name is required.';
  if (input.website && !/^https?:\/\//i.test(input.website)) {
    fieldErrors.website = 'Website must begin with http:// or https://.';
  }
  const featureUrl = input.btyFeatureUrl?.trim();
  if (featureUrl && !VALORWELL_FEATURE_URL_PATTERN.test(featureUrl)) {
    fieldErrors.btyFeatureUrl = 'Feature URL must begin with https://valorwell.org/ or https://www.valorwell.org/.';
  }
  const imageUrl = input.btyFeatureImageUrl?.trim();
  if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
    fieldErrors.btyFeatureImageUrl = 'Image URL must begin with https://.';
  }
  if (input.btyFeatureStatus === 'published') {
    if (!featureUrl) fieldErrors.btyFeatureUrl ??= 'A ValorWell feature URL is required to publish.';
    if (!input.btyFeatureSummary?.trim()) fieldErrors.btyFeatureSummary = 'A short description is required to publish.';
  }
  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}
