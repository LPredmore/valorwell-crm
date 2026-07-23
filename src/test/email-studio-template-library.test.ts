import { describe, expect, it } from 'vitest';
import {
  EMAIL_ASSET_MAX_BYTES,
  sanitizeEmailAssetFilename,
  validateEmailAssetDimensions,
  validateEmailAssetInput,
  validateEmailTemplateMetadata,
} from '@/features/email-studio/templates/validation';

describe('Email Studio template library policies', () => {
  it('requires stable template identity metadata', () => {
    expect(validateEmailTemplateMetadata({ name: '', description: '', subject: '', scope: 'client' }))
      .toEqual(expect.arrayContaining(['Template name is required.', 'Email subject is required.']));
    expect(validateEmailTemplateMetadata({
      name: 'Care follow-up',
      description: 'A controlled reusable client message.',
      subject: 'Your next step',
      scope: 'client',
    })).toEqual([]);
  });

  it('requires supported email image types, size, and alt text', () => {
    const unsupported = validateEmailAssetInput(
      { name: 'vector.svg', size: 1_000, type: 'image/svg+xml' } as File,
      '',
    );
    const oversized = validateEmailAssetInput(
      { name: 'photo.png', size: EMAIL_ASSET_MAX_BYTES + 1, type: 'image/png' } as File,
      'A veteran speaking with a clinician.',
    );

    expect(unsupported).toEqual(expect.arrayContaining([
      'Email images must be JPEG, PNG, WebP, or GIF.',
      'Meaningful alt text is required before upload.',
    ]));
    expect(oversized).toContain('Email images must be 5 MiB or smaller.');
  });

  it('accepts valid email image metadata', () => {
    expect(validateEmailAssetInput(
      { name: 'community.webp', size: 250_000, type: 'image/webp' } as File,
      'Veterans gathering at a community event.',
    )).toEqual([]);
    expect(validateEmailAssetDimensions(1200, 630)).toEqual([]);
  });

  it('rejects unverified or excessive image dimensions', () => {
    expect(validateEmailAssetDimensions(0, 800)).toContain('The image dimensions could not be verified.');
    expect(validateEmailAssetDimensions(4000, 1200)).toContain(
      'Email images must be no larger than 3000 × 3000 pixels.',
    );
  });

  it('normalizes storage filenames and extensions', () => {
    expect(sanitizeEmailAssetFilename('  BTY Update (Final)!!.PNG')).toBe('BTY-Update-Final.png');
    expect(sanitizeEmailAssetFilename('🔥.webp')).toBe('email-image.webp');
  });
});
