import { PRIVACY_LABELS, type PublicationStatus, type SocialPublication } from '@/lib/crm/social-media';
import { centralDateKey } from './centralTime';

/** One Publishing Queue section per real state. A Private upload is "Uploaded / Private", never Published. */
export const QUEUE_SECTIONS: { value: string; label: string; statuses: PublicationStatus[] }[] = [
  { value: 'draft', label: 'Draft', statuses: ['draft'] },
  { value: 'ready', label: 'Ready', statuses: ['ready'] },
  { value: 'approved', label: 'Approved', statuses: ['approved'] },
  { value: 'in_progress', label: 'Queued / Uploading', statuses: ['upload_queued', 'uploading'] },
  { value: 'uploaded', label: 'Uploaded / Private', statuses: ['uploaded'] },
  { value: 'scheduled', label: 'Scheduled', statuses: ['scheduled'] },
  { value: 'published', label: 'Published', statuses: ['published'] },
  { value: 'failed', label: 'Failed', statuses: ['failed'] },
  { value: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
];

/** Visibility as YouTube will apply it: a scheduled video is Private until its publish time. */
export function visibilityLabel(publication: Pick<SocialPublication, 'deliveryMode' | 'desiredPrivacyStatus'>): string {
  return publication.deliveryMode === 'scheduled' ? 'Private → Public at schedule' : PRIVACY_LABELS[publication.desiredPrivacyStatus];
}

/** Groups scheduled publications by their America/Chicago calendar day, earliest first. */
export function groupByCentralDay(publications: SocialPublication[] | undefined): Map<string, SocialPublication[]> {
  const map = new Map<string, SocialPublication[]>();
  for (const pub of publications ?? []) {
    if (!pub.scheduledFor) continue;
    const key = centralDateKey(pub.scheduledFor);
    map.set(key, [...(map.get(key) ?? []), pub]);
  }
  for (const events of map.values()) events.sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
  return map;
}
