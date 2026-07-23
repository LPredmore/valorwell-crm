import type { EmailContentMode } from '../contracts';

export const EMAIL_STUDIO_THEME_KEYS = ['valorwell', 'ocs', 'bty', 'plain-outreach'] as const;
export type EmailStudioThemeKey = (typeof EMAIL_STUDIO_THEME_KEYS)[number];

export type EmailStudioTheme = {
  key: EmailStudioThemeKey;
  label: string;
  description: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
};

export const EMAIL_STUDIO_THEMES: Record<EmailStudioThemeKey, EmailStudioTheme> = {
  valorwell: {
    key: 'valorwell',
    label: 'ValorWell',
    description: 'Clinical, grounded, and mission connected.',
    accentColor: '#315b45',
    backgroundColor: '#eef4f0',
    surfaceColor: '#ffffff',
    textColor: '#173326',
  },
  ocs: {
    key: 'ocs',
    label: 'Operation Claims Success',
    description: 'Evidence-forward veteran claims education.',
    accentColor: '#8a5a1f',
    backgroundColor: '#f7f0e6',
    surfaceColor: '#ffffff',
    textColor: '#3d2b16',
  },
  bty: {
    key: 'bty',
    label: 'Beyond The Yellow',
    description: 'Community, conversation, and collaboration.',
    accentColor: '#315a7d',
    backgroundColor: '#edf3f8',
    surfaceColor: '#ffffff',
    textColor: '#19354c',
  },
  'plain-outreach': {
    key: 'plain-outreach',
    label: 'Plain Outreach',
    description: 'Minimal formatting for personal outreach.',
    accentColor: '#3f3f46',
    backgroundColor: '#f4f4f5',
    surfaceColor: '#ffffff',
    textColor: '#18181b',
  },
};

export const EMAIL_STUDIO_BLOCK_KINDS = [
  'hero',
  'text',
  'callout',
  'cta',
  'story',
  'resource',
  'video',
  'quote',
  'stats',
  'clinician-spotlight',
  'bty',
  'ocs-resource',
  'divider',
  'social-footer',
  'compliance-footer',
] as const;

export type EmailStudioBlockKind = (typeof EMAIL_STUDIO_BLOCK_KINDS)[number];

export type EmailStudioBlockDefinition = {
  kind: EmailStudioBlockKind;
  label: string;
  description: string;
  modes: readonly EmailContentMode[];
  title: string;
  body: string;
  href?: string;
  imageUrl?: string;
  altText?: string;
  locked?: boolean;
};

const DIRECT_AND_UP: readonly EmailContentMode[] = ['direct', 'campaign', 'newsletter'];
const CAMPAIGN_AND_UP: readonly EmailContentMode[] = ['campaign', 'newsletter'];
const NEWSLETTER_ONLY: readonly EmailContentMode[] = ['newsletter'];

export const EMAIL_STUDIO_BLOCKS: readonly EmailStudioBlockDefinition[] = [
  {
    kind: 'hero',
    label: 'Hero',
    description: 'A prominent title, summary, and optional image.',
    modes: CAMPAIGN_AND_UP,
    title: 'A clearer next step',
    body: 'Use this space to frame the most important message in the email.',
    imageUrl: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1200&q=80',
    altText: 'A care professional speaking with a client',
  },
  {
    kind: 'text',
    label: 'Text section',
    description: 'A structured editorial text section.',
    modes: DIRECT_AND_UP,
    title: 'Section heading',
    body: 'Add the supporting explanation, context, or next step here.',
  },
  {
    kind: 'callout',
    label: 'Callout',
    description: 'Highlight one important fact or instruction.',
    modes: DIRECT_AND_UP,
    title: 'Important',
    body: 'Use a callout for information that should not be missed.',
  },
  {
    kind: 'cta',
    label: 'Call to action',
    description: 'A focused action with a safe destination URL.',
    modes: CAMPAIGN_AND_UP,
    title: 'Take the next step',
    body: 'Open the linked resource when you are ready.',
    href: 'https://valorwell.org',
  },
  {
    kind: 'story',
    label: 'Story',
    description: 'A narrative section for a person or community outcome.',
    modes: CAMPAIGN_AND_UP,
    title: 'A story worth sharing',
    body: 'Describe the situation, the action taken, and what changed.',
  },
  {
    kind: 'resource',
    label: 'Resource',
    description: 'Feature an external or internal resource.',
    modes: CAMPAIGN_AND_UP,
    title: 'Featured resource',
    body: 'Explain why this resource is useful and who it is for.',
    href: 'https://valorwell.org',
  },
  {
    kind: 'video',
    label: 'Video',
    description: 'Link to a video with an accessible description.',
    modes: CAMPAIGN_AND_UP,
    title: 'Watch the latest conversation',
    body: 'A concise description of what viewers will learn.',
    href: 'https://www.youtube.com',
  },
  {
    kind: 'quote',
    label: 'Quote',
    description: 'Emphasize a short attributed statement.',
    modes: CAMPAIGN_AND_UP,
    title: 'Community voice',
    body: '“Connection became possible when someone stayed long enough to listen.”',
  },
  {
    kind: 'stats',
    label: 'Statistics',
    description: 'Show a compact set of outcome or activity numbers.',
    modes: NEWSLETTER_ONLY,
    title: 'This month in numbers',
    body: '42 conversations • 18 new connections • 7 community partners',
  },
  {
    kind: 'clinician-spotlight',
    label: 'Clinician spotlight',
    description: 'Introduce a clinician and their area of care.',
    modes: NEWSLETTER_ONLY,
    title: 'Clinician spotlight',
    body: 'Introduce the clinician, their experience, and the people they support.',
  },
  {
    kind: 'bty',
    label: 'Beyond The Yellow',
    description: 'Feature a Beyond The Yellow story or episode.',
    modes: CAMPAIGN_AND_UP,
    title: 'Beyond The Yellow',
    body: 'A conversation about the person, work, or community beyond a label.',
    href: 'https://valorwell.org/watch',
  },
  {
    kind: 'ocs-resource',
    label: 'OCS resource',
    description: 'Feature an Operation Claims Success educational resource.',
    modes: CAMPAIGN_AND_UP,
    title: 'Operation Claims Success resource',
    body: 'Evidence-focused education without shortcuts or document factories.',
    href: 'https://valorwell.org',
  },
  {
    kind: 'divider',
    label: 'Divider',
    description: 'Separate sections without adding content.',
    modes: DIRECT_AND_UP,
    title: '',
    body: '',
  },
  {
    kind: 'social-footer',
    label: 'Social footer',
    description: 'Add approved social destinations.',
    modes: NEWSLETTER_ONLY,
    title: 'Stay connected',
    body: 'Follow ValorWell for new conversations and resources.',
    href: 'https://valorwell.org',
  },
  {
    kind: 'compliance-footer',
    label: 'Compliance footer',
    description: 'Add required preference and postal-address tokens.',
    modes: CAMPAIGN_AND_UP,
    title: 'Email preferences',
    body: 'Manage preferences: {{unsubscribe_url}} • {{postal_address}}',
    locked: true,
  },
];

export const EMAIL_STUDIO_MODE_LABELS: Record<EmailContentMode, string> = {
  direct: 'Direct Email',
  campaign: 'Campaign Email',
  newsletter: 'Newsletter',
};

export function getEmailStudioTheme(key: string): EmailStudioTheme {
  return EMAIL_STUDIO_THEMES[key as EmailStudioThemeKey] ?? EMAIL_STUDIO_THEMES.valorwell;
}

export function getEmailStudioBlocksForMode(mode: EmailContentMode): readonly EmailStudioBlockDefinition[] {
  return EMAIL_STUDIO_BLOCKS.filter((block) => block.modes.includes(mode));
}

export function isEmailStudioBlockAllowed(kind: EmailStudioBlockKind, mode: EmailContentMode): boolean {
  return EMAIL_STUDIO_BLOCKS.some((block) => block.kind === kind && block.modes.includes(mode));
}
