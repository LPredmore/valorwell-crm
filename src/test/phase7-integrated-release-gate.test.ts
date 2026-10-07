import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANONICAL_MESSAGE_CLASSES } from '@/domain/operations';
import { buildStaffOperatorDisplayName } from '@/domain/staffIdentity';
import { buildTaskViewPlan } from '@/repositories/taskViewSemantics';
import { buildTaskViewDateBounds } from '@/lib/crm/taskViewDates';
import { requireOperatingTenant } from '@/repositories/tenantScope';
import type { CampaignStepFormData } from '@/lib/crm/campaign-types';
import { resolveCampaignEmailStepForSave } from '@/components/crm/campaigns/campaignStepEmailPersistence';
import {
  MESSAGE_CLASSES,
  parseIndividualSmsMessageClass,
} from '../../supabase/functions/_shared/communication-contracts';
import {
  clientGreetingVariables,
} from '../../supabase/functions/_shared/client-personalization';
import {
  renderNewsletterDelivery,
  validateNewsletterTemplateContract,
} from '../../supabase/functions/newsletter-send-worker/rendering';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Phase 7 integrated release gate', () => {
  it('keeps communication classification identical from repository input through Edge policy enforcement and audit metadata', () => {
    expect([...MESSAGE_CLASSES]).toEqual([...CANONICAL_MESSAGE_CLASSES]);
    expect(parseIndividualSmsMessageClass(undefined)).toBe('necessary_scheduling');
    expect(parseIndividualSmsMessageClass('ordinary_promotional')).toBe('ordinary_promotional');
    expect(parseIndividualSmsMessageClass('ordinary_campaign_follow_up')).toBe('ordinary_campaign_follow_up');
    expect(parseIndividualSmsMessageClass('not-a-real-class')).toBeNull();

    const repository = read('src/repositories/supabase/communications.ts');
    const individual = read('supabase/functions/crm-send-client-sms/index.ts');
    const ringcentral = read('supabase/functions/ringcentral-sms/index.ts');
    const suppression = read('supabase/functions/_shared/suppression.ts');

    expect(repository).toContain("messageClass: message.messageClass ?? 'necessary_scheduling'");
    expect(individual).toContain('parseIndividualSmsMessageClass(body?.messageClass)');
    expect(individual).toContain('return json({ error: "Invalid messageClass" }, 400)');
    expect(individual).toContain('message_class: messageClass');
    expect(ringcentral).toContain('messageClass: "ordinary_promotional"');
    expect(ringcentral).toContain('message_class: messageClass');
    expect(suppression).toContain('p_message_class: args.messageClass');
    expect(suppression).toContain('message_class: args.messageClass');
  });

  it('uses one preferred-name salutation contract for campaign and direct client email', () => {
    expect(clientGreetingVariables({
      pat_name_preferred: ' Jon ',
      pat_name_f: 'Jonathan',
    })).toEqual({ first_name: 'Jon', preferred_name: 'Jon' });

    expect(clientGreetingVariables({
      pat_name_preferred: ' ',
      pat_name_f: ' Jonathan ',
    })).toEqual({ first_name: 'Jonathan', preferred_name: 'Jonathan' });

    expect(clientGreetingVariables({
      pat_name_preferred: null,
      pat_name_f: null,
    })).toEqual({ first_name: 'there', preferred_name: 'there' });

    expect(read('supabase/functions/campaign-scheduler/index.ts')).toContain('clientGreetingVariables');
    expect(read('supabase/functions/crm-resend-email/index.ts')).toContain('clientGreetingVariables');
  });

  it('renders every supported newsletter greeting alias, preheader, unsubscribe URL, and postal address without unresolved tokens', () => {
    const rendered = renderNewsletterDelivery({
      template: {
        subject: 'Hello {{newsletter_greeting_name}}',
        preheader: 'Preview for {{greeting_name}}',
        html: '<p>{{first_name}} / {{preferred_name}}</p><a href="{{unsubscribe_url}}">Unsubscribe</a><footer>{{postal_address}}</footer>',
        text: '{{newsletter_greeting_name}} {{unsubscribe_url}} {{postal_address}}',
      },
      greetingName: 'Luke',
      senderName: 'ValorWell',
      unsubscribeUrl: 'https://example.org/unsubscribe?token=recipient-1',
      postalAddress: '100 Main Street, Kansas City, MO',
    });

    expect(rendered.subject).toBe('Hello Luke');
    expect(rendered.preheader).toBe('Preview for Luke');
    expect(rendered.html).toContain('display:none');
    expect(rendered.html).toContain('recipient-1');
    expect(rendered.html).toContain('100 Main Street, Kansas City, MO');
    expect([rendered.subject, rendered.preheader ?? '', rendered.html, rendered.text].join('\n')).not.toMatch(/{{[^}]+}}/);

    expect(() => validateNewsletterTemplateContract({
      subject: 'Bad {{unknown_newsletter_token}}',
      preheader: null,
      html: '<p>Hello</p>',
      text: 'Hello',
    })).toThrow('UNKNOWN_NEWSLETTER_VARIABLE');

    expect(() => validateNewsletterTemplateContract({
      subject: 'Bad {{bad-token}}',
      preheader: null,
      html: '<p>Hello</p>',
      text: 'Hello',
    })).toThrow('MALFORMED_NEWSLETTER_TEMPLATE_EXPRESSION');

    expect(() => renderNewsletterDelivery({
      template: {
        subject: 'Hello {{newsletter_greeting_name}}',
        preheader: null,
        html: '<p>Hello</p>',
        text: 'Hello',
      },
      greetingName: '{{bad.token}}',
      senderName: 'ValorWell',
      unsubscribeUrl: 'https://example.org/unsubscribe',
      postalAddress: '100 Main Street, Kansas City, MO',
    })).toThrow('UNRESOLVED_NEWSLETTER_TEMPLATE_EXPRESSION');
  });

  it('keeps operational owner identity profile-based and human-readable', () => {
    expect(buildStaffOperatorDisplayName({
      preferredDisplayName: ' Dr. Morgan ',
      firstName: 'Morgan',
      lastName: 'Lee',
      email: 'morgan@example.org',
    })).toBe('Dr. Morgan');

    const exceptions = read('src/pages/crm/canonical/CanonicalExceptions.tsx');
    const tasks = read('src/pages/crm/canonical/CanonicalTasks.tsx');
    const reports = read('src/repositories/supabase/reports.ts');

    expect(exceptions).toContain('value={s.profileId as string}');
    expect(tasks).toContain('resolveStaffOperatorLabel(staff, t.ownerId)');
    expect(reports).toContain(".in('profile_id', assigneeIds)");
    expect(reports).not.toContain(".in('id', assigneeIds)");
    expect(reports).toContain('campaignName:');
    expect(reports).toContain('assigneeName:');
  });

  it('gives every visible task view explicit tenant-aware semantics with local calendar boundaries', () => {
    const bounds = buildTaskViewDateBounds(
      new Date('2026-10-07T15:00:00.000Z'),
      'America/Chicago',
    );

    expect(buildTaskViewPlan({
      view: 'my',
      tenantId: 'tenant-a',
      currentProfileId: 'profile-me',
    })).toMatchObject({
      tenantId: 'tenant-a',
      ownerId: 'profile-me',
      excludeTerminal: true,
    });

    expect(buildTaskViewPlan({
      view: 'due-today',
      tenantId: 'tenant-a',
      dateBounds: bounds,
    })).toMatchObject({
      tenantId: 'tenant-a',
      dueGte: bounds.dayStartIso,
      dueLt: bounds.nextDayStartIso,
      excludeTerminal: true,
    });

    expect(buildTaskViewPlan({
      view: 'due-week',
      tenantId: 'tenant-a',
      dateBounds: bounds,
    })).toMatchObject({
      tenantId: 'tenant-a',
      dueGte: bounds.weekStartIso,
      dueLt: bounds.nextWeekStartIso,
      excludeTerminal: true,
    });

    expect(buildTaskViewPlan({ view: 'unassigned', tenantId: 'tenant-a' })).toMatchObject({
      ownerIsNull: true,
      excludeTerminal: true,
    });
    expect(buildTaskViewPlan({ view: 'client-followups', tenantId: 'tenant-a' })).toMatchObject({
      type: 'Client Follow-Up',
      excludeTerminal: true,
    });
    expect(buildTaskViewPlan({ view: 'staff-followups', tenantId: 'tenant-a' })).toMatchObject({
      type: 'Staff Follow-Up',
      excludeTerminal: true,
    });
    expect(buildTaskViewPlan({ view: 'campaign-exceptions', tenantId: 'tenant-a' })).toMatchObject({
      type: 'Campaign Exception',
      excludeTerminal: true,
    });
    expect(buildTaskViewPlan({ view: 'recently-completed', tenantId: 'tenant-a' })).toMatchObject({
      completedOnly: true,
      orderBy: 'completedAt',
      orderAscending: false,
    });
    expect(buildTaskViewPlan({ view: 'all', tenantId: 'tenant-a' })).toMatchObject({
      excludeTerminal: false,
    });
  });

  it('requires an operating tenant and preserves explicit tenant filters in canonical repositories', () => {
    expect(requireOperatingTenant(' tenant-a ')).toBe('tenant-a');
    expect(() => requireOperatingTenant(undefined)).toThrow('Current CRM operating tenant is required');

    for (const path of [
      'src/repositories/supabase/tasks.ts',
      'src/repositories/supabase/exceptions.ts',
      'src/repositories/supabase/staff.ts',
      'src/repositories/supabase/campaigns.ts',
      'src/repositories/supabase/clients.ts',
      'src/repositories/supabase/communications.ts',
    ]) {
      expect(read(path), path).toContain(".eq('tenant_id', tenantId)");
    }
  });

  it('persists the latest validated campaign Email Studio snapshot after collapse and still fails closed without one', async () => {
    const oldContent = {
      schemaVersion: 1,
      mode: 'campaign' as const,
      editorDocument: {
        type: 'doc' as const,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old' }] }],
      },
      renderedHtml: '<p>Old</p>',
      renderedText: 'Old',
      preheader: 'Old preview',
      themeKey: 'valorwell',
      renderHash: 'fnv1a32:old',
    };
    const latestContent = {
      ...oldContent,
      renderedHtml: '<p>Latest</p>',
      renderedText: 'Latest',
      preheader: 'Latest preview',
      renderHash: 'fnv1a32:latest',
    };
    const step: CampaignStepFormData = {
      client_key: 'phase7-step',
      step_order: 1,
      delay_days: 0,
      delay_hours: 0,
      channel: 'email',
      email_subject: 'Subject',
      email_body_html: oldContent.renderedHtml,
      email_body_text: oldContent.renderedText,
      email_preheader: oldContent.preheader,
      email_content: oldContent,
      email_template_id: null,
      email_template_version_id: null,
      sms_body_text: '',
      is_active: true,
      signature_id: null,
    };

    const saved = await resolveCampaignEmailStepForSave(step, 0, null, latestContent);
    expect(saved.email_body_html).toBe('<p>Latest</p>');
    expect(saved.email_preheader).toBe('Latest preview');
    await expect(resolveCampaignEmailStepForSave(step, 0, null, null))
      .rejects.toThrow('contains invalid Email Studio content');
  });

  it('keeps creator source values raw, publication covers signed, retired BTY calls absent, and Drive OAuth read-only', () => {
    const creator = read('src/pages/crm/canonical/CreatorCommunityInterestQueue.tsx');
    const publication = read('src/components/crm/social-media/SocialPublicationMetadataForm.tsx');
    const thumbnails = read('supabase/functions/social-media-manager/handlers/thumbnails.ts');
    const bty = read('src/pages/crm/business-development/BtyAutomationPage.tsx');
    const btyClient = read('src/lib/crm/bty-automation.ts');
    const routes = read('src/App.tsx');
    const drivePage = read('src/pages/crm/business-development/RelationshipOrchestrationPage.tsx');
    const oauthStart = read('supabase/functions/relationship-google-oauth-start/index.ts');
    const oauthCallback = read('supabase/functions/relationship-google-oauth-callback/index.ts');

    expect(creator).toContain('sourceOptions.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)');

    expect(publication).toContain('publicationId: publication.id');
    expect(publication).not.toContain('<img src={publication.thumbnailUrl}');
    expect(publication).toContain('Open cover image in Drive');
    expect(thumbnails).toContain('ai_operations_social_publications');
    expect(thumbnails).toContain('.eq("tenant_id", tenantId)');

    expect(bty).not.toContain('Daily 6:00 AM');
    expect(btyClient).not.toContain('bty_automation_overview');
    expect(routes).toContain('business-development/duplicate-cleanup');
    expect(routes).toContain('Navigate replace to="/crm/business-development/duplicate-cleanup"');

    expect(drivePage).toContain("connect.mutate('drive')");
    expect(oauthStart).toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(oauthStart).toContain('include_granted_scopes: "false"');
    expect(oauthCallback).toContain('store_relationship_google_connection');
    expect(oauthCallback).toContain('new URL("/crm/business-development/orchestration", appUrl)');
    expect(oauthCallback).not.toContain('You can close this window');
  });
});
