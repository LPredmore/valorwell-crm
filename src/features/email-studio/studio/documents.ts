import type {
  EmailContentMode,
  EmailContentScope,
  EmailEditorDocument,
  EmailEditorNode,
} from '../contracts';
import {
  EMAIL_STUDIO_BLOCKS,
  type EmailStudioBlockDefinition,
  type EmailStudioBlockKind,
  type EmailStudioThemeKey,
} from './config';

const text = (value: string): EmailEditorNode => ({ type: 'text', text: value });
const paragraph = (...content: EmailEditorNode[]): EmailEditorNode => ({ type: 'paragraph', content });
const heading = (value: string, level = 1): EmailEditorNode => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const variable = (key: string, label: string): EmailEditorNode => ({
  type: 'emailVariable',
  attrs: { key, label },
});

export function createEmailStudioBlockNode(
  definition: EmailStudioBlockDefinition,
  themeKey: EmailStudioThemeKey,
): EmailEditorNode {
  return {
    type: 'emailStudioBlock',
    attrs: {
      kind: definition.kind,
      title: definition.title,
      body: definition.body,
      href: definition.href || '',
      imageUrl: definition.imageUrl || '',
      altText: definition.altText || '',
      themeKey,
      locked: Boolean(definition.locked),
    },
  };
}

export function createEmailStudioBlockNodeByKind(
  kind: EmailStudioBlockKind,
  themeKey: EmailStudioThemeKey,
): EmailEditorNode {
  const definition = EMAIL_STUDIO_BLOCKS.find((entry) => entry.kind === kind);
  if (!definition) throw new Error(`Unknown Email Studio block: ${kind}`);
  return createEmailStudioBlockNode(definition, themeKey);
}

export function createEmailStudioDocument(input: {
  mode: EmailContentMode;
  scope: EmailContentScope;
  themeKey?: EmailStudioThemeKey;
}): EmailEditorDocument {
  const themeKey = input.themeKey || 'valorwell';
  const firstName = input.scope === 'client'
    ? variable('first_name', 'Client first name')
    : variable('contact_first_name', 'Contact first name');

  if (input.mode === 'direct') {
    return {
      type: 'doc',
      content: [
        paragraph(text('Hi '), firstName, text(',')),
        paragraph(text('I wanted to follow up personally with a clear next step.')),
        paragraph(text('Reply to this email when you are ready, and we will take it from there.')),
        paragraph(text('Take care,')),
        paragraph(variable('sender_name', 'Sender name')),
      ],
    };
  }

  if (input.mode === 'campaign') {
    return {
      type: 'doc',
      content: [
        createEmailStudioBlockNodeByKind('hero', themeKey),
        paragraph(text('Hi '), firstName, text(',')),
        paragraph(text('This campaign message uses structured content that remains readable in HTML and plain text.')),
        createEmailStudioBlockNodeByKind('callout', themeKey),
        createEmailStudioBlockNodeByKind('cta', themeKey),
        createEmailStudioBlockNodeByKind('compliance-footer', themeKey),
      ],
    };
  }

  return {
    type: 'doc',
    content: [
      createEmailStudioBlockNodeByKind('hero', themeKey),
      heading('What is happening now'),
      createEmailStudioBlockNodeByKind('story', themeKey),
      createEmailStudioBlockNodeByKind('stats', themeKey),
      heading('Resources and conversations', 2),
      createEmailStudioBlockNodeByKind('bty', themeKey),
      createEmailStudioBlockNodeByKind('ocs-resource', themeKey),
      createEmailStudioBlockNodeByKind('social-footer', themeKey),
      createEmailStudioBlockNodeByKind('compliance-footer', themeKey),
    ],
  };
}

export type EmailStudioPreset = {
  key: string;
  label: string;
  description: string;
  mode: EmailContentMode;
  themeKey: EmailStudioThemeKey;
};

export const EMAIL_STUDIO_PRESETS: readonly EmailStudioPreset[] = [
  {
    key: 'personal-follow-up',
    label: 'Personal follow-up',
    description: 'A restrained direct message with structured personalization.',
    mode: 'direct',
    themeKey: 'plain-outreach',
  },
  {
    key: 'care-next-step',
    label: 'Care next step',
    description: 'A campaign layout with a hero, callout, and focused action.',
    mode: 'campaign',
    themeKey: 'valorwell',
  },
  {
    key: 'community-update',
    label: 'Community update',
    description: 'A full newsletter with stories, resources, statistics, and footers.',
    mode: 'newsletter',
    themeKey: 'bty',
  },
];

export function createEmailStudioPresetDocument(
  presetKey: string,
  scope: EmailContentScope,
): { mode: EmailContentMode; themeKey: EmailStudioThemeKey; document: EmailEditorDocument } {
  const preset = EMAIL_STUDIO_PRESETS.find((entry) => entry.key === presetKey) || EMAIL_STUDIO_PRESETS[0];
  return {
    mode: preset.mode,
    themeKey: preset.themeKey,
    document: createEmailStudioDocument({ mode: preset.mode, scope, themeKey: preset.themeKey }),
  };
}

export function cloneEmailStudioDocument(document: EmailEditorDocument): EmailEditorDocument {
  return JSON.parse(JSON.stringify(document)) as EmailEditorDocument;
}
