import {
  mapDbClosureReasonToDomain,
  mapDbEngagementToDomain,
  mapDbLifecycleToDomain,
} from '@/domain/canonical';

function formatBucketDate(value: string | null): string {
  if (!value) return 'Unknown date';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);
}

export function formatReportBucketRange(
  bucketStart: string | null,
  bucketEnd: string | null,
): string {
  return `${formatBucketDate(bucketStart)} – ${formatBucketDate(bucketEnd)}`;
}

export function formatLifecycleStage(value: string | null): string {
  return value === null ? 'Unspecified' : mapDbLifecycleToDomain(value);
}

export function formatEngagementState(value: string | null): string {
  return value === null ? 'Unspecified' : mapDbEngagementToDomain(value);
}

export function formatClosureDisposition(value: string | null): string {
  return value === null || value === 'unspecified'
    ? 'Unspecified'
    : mapDbClosureReasonToDomain(value);
}

export function formatDimensionLabel(value: string | null): string {
  if (!value) return 'Unspecified';
  return value
    .split('_')
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
