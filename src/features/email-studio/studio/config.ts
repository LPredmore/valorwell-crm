import type { EmailContentMode } from '../contracts';

export const EMAIL_STUDIO_THEME_KEYS = ['valorwell', 'ocs', 'bty', 'plain-outreach'] as const;
export type EmailStudioThemeKey = (typeof EMAIL_STUDIO_THEME_KEYS)[number];

export type EmailStudioTheme = {
  key: EmailStudioThemeKey;
  label: string;
  description: string;
  accentColor: string;
  accentTextColor: string;
  secondaryAccentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  subtleSurfaceColor: string;
  highlightColor: string;
  textColor: string;
  mutedTextColor: string;
  borderColor: string;
  buttonColor: string;
  buttonTextColor: string;
  fontFamily: string;
};

export const EMAIL_STUDIO_LAYOUT = {
  contentWidth: 600,
  outerPadding: 24,
  sectionGap: 20,
  cardRadius: 12,
  imageRadius: 10,
} as const;

export const EMAIL_STUDIO_THEMES: Record<EmailStudioThemeKey, EmailStudioTheme> = {
  valorwell: {
    key: 'valorwell',
    label: 'ValorWell',
    description: 'Grounded veteran mental-health communication with forest green, warm gold, charcoal, and off-white.',
    accentColor: '#315B45',
    accentTextColor: '#FFFFFF',
    secondaryAccentColor: '#C69A45',
    backgroundColor: '#F5F3ED',
    surfaceColor: '#FFFFFF',
    subtleSurfaceColor: '#EDF3EF',
    highlightColor: '#F5EAD3',
    textColor: '#202823',
    mutedTextColor: '#667269',
    borderColor: '#D8E0DA',
    buttonColor: '#C69A45',
    buttonTextColor: '#18221C',
    fontFamily: 'Arial, Helvetica, sans-serif',
  },
  ocs: {
    key: 'ocs',
    label: 'Operation Claims Success',
    description: 'Evidence-forward veteran claims education.',
    accentColor: '#8A5A1F',
    accentTextColor: '#FFFFFF',
    secondaryAccentColor: '#C28B45',
    backgroundColor: '#F7F0E6',
    surfaceColor: '#FFFFFF',
    subtleSurfaceColor: '#FBF6EE',
    highlightColor: '#F3E5D0',
    textColor: '#3D2B16',
    mutedTextColor: '#75634E',
    borderColor: '#E5D7C2',
    buttonColor: '#8A5A1F',
    buttonTextColor: '#FFFFFF',
    fontFamily: 'Arial, Helvetica, sans-serif',
  },
  bty: {
    key: 'bty',
    label: 'Beyond The Yellow',
    description: 'Community, conversation, and collaboration.',
    accentColor: '#315A7D',
    accentTextColor: '#FFFFFF',
    secondaryAccentColor: '#D0A33E',
    backgroundColor: '#EDF3F8',
    surfaceColor: '#FFFFFF',
    subtleSurfaceColor: '#F3F7FA',
    highlightColor: '#F7EED5',
    textColor: '#19354C',
    mutedTextColor: '#607384',
    borderColor: '#D6E0E8',
    buttonColor: '#315A7D',
    buttonTextColor: '#FFFFFF',
    fontFamily: 'Arial, Helvetica, sans-serif',
  },
  'plain-outreach': {
    key: 'plain-outreach',
    label: 'Plain Outreach',
    description: 'Minimal formatting for personal outreach.',
    accentColor: '#3F3F46',
    accentTextColor: '#FFFFFF',
    secondaryAccentColor: '#71717A',
    backgroundColor: '#F4F4F5',
    surfaceColor: '#FFFFFF',
    subtleSurfaceColor: '#FAFAFA',
    highlightColor: '#F4F4F5',
    textColor: '#18181B',
    mutedTextColor: '#71717A',
    borderColor: '#E4E4E7',
    buttonColor: '#3F3F46',
    buttonTextColor: '#FFFFFF',
    fontFamily: 'Arial, Helvetica, sans-serif',
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
    description: 'A prominent branded title, summary, and optional image.',
    modes: CAMPAIGN_AND_UP,
    title: 'A clearer next step',
    body: 'Use this space to frame the most important message in the email.',
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
    description: 'A narrative card for a person, care update, or community outcome.',
    modes: CAMPAIGN_AND_UP,
    title: 'A story worth sharing',
    body: 'Describe the situation, the action taken, and what changed.',
  },
  {
    kind: 'resource',
    label: 'Resource',
    description: 'Feature an external or internal resource as an article card.',
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
    description: 'Show a compact set of verified outcome or activity numbers.',
    modes: NEWSLETTER_ONLY,
    title: 'This month in numbers',
    body: 'Replace this copy with verified numbers before sending.',
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
    description: 'Add approved ValorWell destinations.',
    modes: NEWSLETTER_ONLY,
    title: 'Stay connected',
    body: 'Visit ValorWell for care information, new conversations, and practical resources.',
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
