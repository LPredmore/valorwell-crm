import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NEWSLETTER_AUDIENCE_DOMAINS,
  NEWSLETTER_AUDIENCE_LABELS,
} from '@/lib/crm/newsletter-control-plane';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const managementPage = read('src/pages/crm/NewsletterManagementPage.tsx');
const composer = read('src/features/email-studio/newsletter/ClientNewsletterEmailStudioComposer.tsx');
const bulkDialog = read('src/components/crm/canonical/BulkNewsletterDialog.tsx');

describe('newsletter production fixes', () => {
  describe('audience restoration', () => {
    it('offers all six audience domains including relationship contacts and provider applicants', () => {
      expect(NEWSLETTER_AUDIENCE_DOMAINS).toContain('relationship');
      expect(NEWSLETTER_AUDIENCE_DOMAINS).toContain('provider_applicant');
      expect(NEWSLETTER_AUDIENCE_LABELS.relationship).toBe('Relationship contacts');
      expect(NEWSLETTER_AUDIENCE_LABELS.provider_applicant).toBe('Provider applicants');
    });
  });

  describe('cancel send for scheduled newsletters', () => {
    it('shows the action panel for scheduled or sending newsletters even without canonical content', () => {
      expect(managementPage).toContain(
        "canMutate && (letter.canonical || letter.status === 'scheduled' || letter.status === 'sending')",
      );
    });

    it('offers Cancel send for both scheduled and sending newsletters', () => {
      expect(managementPage).toContain("(letter.status === 'scheduled' || letter.status === 'sending')");
      expect(managementPage).toContain('Cancel send');
    });

    it('keeps duplicate and schedule actions gated on canonical drafts', () => {
      expect(managementPage).toContain("letter.canonical && letter.status === 'draft'");
    });
  });

  describe('send worker activation', () => {
    it('surfaces the send worker last-run status on the management page', () => {
      expect(managementPage).toContain('crm_newsletter_worker_status');
      expect(managementPage).toContain('Send worker:');
    });
  });

  describe('template attribution preservation', () => {
    it('does not mark the composer dirty from the mount-time compliance footer repair', () => {
      // The repair is a system normalization: it must never call onDirty,
      // because the bulk dialog wires onDirty to clearing template attribution.
      expect(composer).toContain('deliberately does NOT call');
      expect(composer).not.toContain('repairedOnLoadRef.current');
      const mountEffects = composer.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/g) ?? [];
      for (const effect of mountEffects) {
        expect(effect).not.toContain('onDirty');
      }
    });
  });

  describe('bulk dialog layout', () => {
    it('renders the composer in dialog layout inside the bulk newsletter dialog', () => {
      expect(bulkDialog).toContain('layout="dialog"');
    });

    it('supports a dialog layout without the fixed workspace minimum width', () => {
      expect(composer).toContain("layout?: 'workspace' | 'dialog'");
      expect(composer).toContain("layout === 'dialog'");
    });
  });
});
