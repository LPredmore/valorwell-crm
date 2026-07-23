import type { EmailTemplateMetadata } from './types';

export const EMAIL_ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const EMAIL_ASSET_MAX_DIMENSION = 3000;
export const EMAIL_ASSET_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export function validateEmailTemplateMetadata(metadata: EmailTemplateMetadata): string[] {
  const issues: string[] = [];
  if (!metadata.name.trim()) issues.push('Template name is required.');
  if (metadata.name.trim().length > 160) issues.push('Template name must be 160 characters or fewer.');
  if (!metadata.subject.trim()) issues.push('Email subject is required.');
  if (metadata.subject.trim().length > 240) issues.push('Email subject must be 240 characters or fewer.');
  if (metadata.description.trim().length > 1000) issues.push('Description must be 1,000 characters or fewer.');
  return issues;
}

export function validateEmailAssetInput(
  file: Pick<File, 'name' | 'size' | 'type'> | null,
  altText: string,
): string[] {
  const issues: string[] = [];
  if (!file) return ['Choose an image to upload.'];
  if (!EMAIL_ASSET_MIME_TYPES.includes(file.type as (typeof EMAIL_ASSET_MIME_TYPES)[number])) {
    issues.push('Email images must be JPEG, PNG, WebP, or GIF.');
  }
  if (file.size <= 0) issues.push('The selected image is empty.');
  if (file.size > EMAIL_ASSET_MAX_BYTES) issues.push('Email images must be 5 MiB or smaller.');
  if (!altText.trim()) issues.push('Meaningful alt text is required before upload.');
  if (altText.trim().length > 240) issues.push('Alt text must be 240 characters or fewer.');
  return issues;
}

export function validateEmailAssetDimensions(width: number, height: number): string[] {
  const issues: string[] = [];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    issues.push('The image dimensions could not be verified.');
  }
  if (width > EMAIL_ASSET_MAX_DIMENSION || height > EMAIL_ASSET_MAX_DIMENSION) {
    issues.push(`Email images must be no larger than ${EMAIL_ASSET_MAX_DIMENSION} × ${EMAIL_ASSET_MAX_DIMENSION} pixels.`);
  }
  return issues;
}

export function sanitizeEmailAssetFilename(filename: string): string {
  const extensionMatch = filename.toLowerCase().match(/\.[a-z0-9]{2,5}$/);
  const extension = extensionMatch?.[0] || '';
  const base = filename
    .slice(0, extension ? -extension.length : undefined)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'email-image';
  return `${base}${extension}`;
}

export async function readEmailAssetDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('The selected file could not be decoded as an image.'));
    };
    image.src = objectUrl;
  });
}
