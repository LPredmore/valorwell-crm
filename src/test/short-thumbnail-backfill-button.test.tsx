import {describe,expect,it} from 'vitest';
import {thumbnailStatusLabel} from '@/lib/crm/social-media';

// Replaces the obsolete automatic-backfill-button test. That button and its
// backfill APIs are no longer present in this CRM. Current thumbnail statuses
// must still accurately distinguish manual work from provider confirmation.
describe('Social-media thumbnail status labels',()=>{
 it('does not mistake manual-required for completed',()=>{
  expect(thumbnailStatusLabel('manual_required')).toBe('Thumbnail Manual Required');
  expect(thumbnailStatusLabel('manual_confirmed')).toBe('Thumbnail Done');
 });
 it('does not mistake provider acceptance for a verified YouTube thumbnail',()=>{
  expect(thumbnailStatusLabel('accepted_unverified')).toBe('Thumbnail API Accepted');
  expect(thumbnailStatusLabel('api_confirmed')).toBe('Thumbnail API Confirmed');
  expect(thumbnailStatusLabel('waiting_processing')).toBe('Thumbnail Pending');
 });
 it('fails closed for unknown thumbnail states',()=>{
  expect(thumbnailStatusLabel('unexpected')).toBeNull();
  expect(thumbnailStatusLabel(null)).toBeNull();
 });
});
