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

function createConfiguredBlock(
  kind: EmailStudioBlockKind,
  themeKey: EmailStudioThemeKey,
  attrs: Partial<Record<'title' | 'body' | 'href' | 'imageUrl' | 'altText', string>>,
): EmailEditorNode {
  const node = createEmailStudioBlockNodeByKind(kind, themeKey);
  return {
    ...node,
    attrs: {
      ...node.attrs,
      ...attrs,
    },
  };
}

export function createValorWellWeeklyNewsletterDocument(): EmailEditorDocument {
  const themeKey: EmailStudioThemeKey = 'valorwell';
  return {
    type: 'doc',
    content: [
      createConfiguredBlock('hero', themeKey, {
        title: 'ValorWell Weekly',
        body: 'Veteran mental health, practical resources, and the people moving care forward.',
        imageUrl: '',
        altText: '',
      }),
      createConfiguredBlock('text', themeKey, {
        title: 'A quick note from ValorWell',
        body: 'Hi {{newsletter_greeting_name}},\n\nHere is the short version of what is worth knowing from ValorWell this week.',
      }),
      createConfiguredBlock('story', themeKey, {
        title: 'From the care side',
        body: 'Share one concrete care update, lesson, or change that matters to veterans and families.',
      }),
      createConfiguredBlock('callout', themeKey, {
        title: 'One thing worth knowing',
        body: 'Use this space for the single practical point readers should remember after they close the email.',
      }),
      createConfiguredBlock('resource', themeKey, {
        title: 'Resource of the week',
        body: 'Feature one useful ValorWell resource and explain in plain language who it can help.',
        href: 'https://valorwell.org',
        imageUrl: '',
        altText: '',
      }),
      createConfiguredBlock('bty', themeKey, {
        title: 'Beyond The Yellow',
        body: 'Highlight a recent conversation with someone moving beyond awareness and into meaningful action.',
        href: 'https://valorwell.org/watch',
        imageUrl: '',
        altText: '',
      }),
      createConfiguredBlock('cta', themeKey, {
        title: 'Looking for care?',
        body: 'ValorWell provides virtual mental-health care for veterans and their families. Start here when you are ready.',
        href: 'https://valorwell.org/get-care',
      }),
      createEmailStudioBlockNodeByKind('divider', themeKey),
      createConfiguredBlock('social-footer', themeKey, {
        title: 'Stay connected with ValorWell',
        body: 'Find care information, new conversations, and practical resources at ValorWell.org.',
        href: 'https://valorwell.org',
      }),
      createEmailStudioBlockNodeByKind('compliance-footer', themeKey),
    ],
  };
}

export function createEmailStudioDocument(input: {
  mode: EmailContentMode;
  scope: EmailContentScope;
  themeKey?: EmailStudioThemeKey;
}): EmailEditorDocument {
  const themeKey = input.themeKey || 'valorwell';
  const firstName = input.scope === 'client'
    ? variable('first_name', 'Client first name')
    : input.scope === 'staff'
      ? variable('staff_first_name', 'Staff first name')
      : input.scope === 'marketing_newsletter'
        ? variable('newsletter_greeting_name', 'Newsletter greeting name')
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
        ...(input.scope === 'staff' ? [] : [createEmailStudioBlockNodeByKind('compliance-footer', themeKey)]),
      ],
    };
  }

  if (input.scope === 'marketing_newsletter') {
    return createValorWellWeeklyNewsletterDocument();
  }

  if (input.scope === 'staff') {
    return {
      type: 'doc',
      content: [
        createEmailStudioBlockNodeByKind('hero', themeKey),
        paragraph(text('Hi '), firstName, text(',')),
        heading('Staff update'),
        createEmailStudioBlockNodeByKind('story', themeKey),
        createEmailStudioBlockNodeByKind('callout', themeKey),
        createEmailStudioBlockNodeByKind('cta', themeKey),
        createEmailStudioBlockNodeByKind('divider', themeKey),
        paragraph(text('Thank you,')),
        paragraph(variable('sender_name', 'Sender name')),
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
    key: 'valorwell-weekly',
    label: 'ValorWell Weekly',
    description: 'The polished default newsletter for weekly ValorWell updates, resources, and calls to action.',
    mode: 'newsletter',
    themeKey: 'valorwell',
  },
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
  if (preset.key === 'valorwell-weekly') {
    return {
      mode: 'newsletter',
      themeKey: 'valorwell',
      document: createValorWellWeeklyNewsletterDocument(),
    };
  }

  const mode = scope === 'staff' ? 'newsletter' : preset.mode;
  return {
    mode,
    themeKey: preset.themeKey,
    document: createEmailStudioDocument({ mode, scope, themeKey: preset.themeKey }),
  };
}

export function cloneEmailStudioDocument(document: EmailEditorDocument): EmailEditorDocument {
  return JSON.parse(JSON.stringify(document)) as EmailEditorDocument;
}
