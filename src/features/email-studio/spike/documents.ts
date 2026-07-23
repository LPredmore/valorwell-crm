import type { EmailStudioSpikeDocument, EmailStudioSpikeMode, EmailStudioSpikeNode } from './types';

const text = (value: string): EmailStudioSpikeNode => ({ type: 'text', text: value });
const paragraph = (...content: EmailStudioSpikeNode[]): EmailStudioSpikeNode => ({ type: 'paragraph', content });
const heading = (value: string): EmailStudioSpikeNode => ({
  type: 'heading',
  attrs: { level: 1 },
  content: [text(value)],
});
const variable = (key: string, label: string): EmailStudioSpikeNode => ({
  type: 'emailVariable',
  attrs: { key, label },
});
const callout = (value: string): EmailStudioSpikeNode => ({
  type: 'valorWellCallout',
  content: [text(value)],
});

export function createEmailStudioSpikeDocument(mode: EmailStudioSpikeMode): EmailStudioSpikeDocument {
  if (mode === 'direct') {
    return {
      type: 'doc',
      content: [
        paragraph(text('Hi '), variable('first_name', 'Client first name'), text(',')),
        paragraph(text('This direct-email proof keeps the message conversational while preserving structured personalization.')),
        paragraph(text('Take care,')),
        paragraph(text('ValorWell')),
      ],
    };
  }

  if (mode === 'campaign') {
    return {
      type: 'doc',
      content: [
        heading('A practical next step'),
        paragraph(text('Hi '), variable('first_name', 'Client first name'), text(',')),
        paragraph(text('This campaign-email proof demonstrates reusable formatting and structured variables.')),
        callout('A custom ValorWell callout block exported through React Email.'),
        paragraph(text('Reply to this email when you are ready to continue.')),
      ],
    };
  }

  return {
    type: 'doc',
    content: [
      heading('ValorWell Community Update'),
      paragraph(
        text('A newsletter proof for '),
        variable('organization_name', 'Organization name'),
        text(' and the broader ValorWell community.'),
      ),
      callout('One mission. Clear resources. Ongoing connection.'),
      heading('What is happening now'),
      paragraph(text('This prototype verifies JSON round-trip and HTML/plain-text export.')),
      paragraph(text('Manage preferences: '), variable('unsubscribe_url', 'Unsubscribe URL')),
    ],
  };
}

export function cloneEmailStudioSpikeDocument(document: EmailStudioSpikeDocument): EmailStudioSpikeDocument {
  return JSON.parse(JSON.stringify(document)) as EmailStudioSpikeDocument;
}

export function collectEmailStudioVariableKeys(document: EmailStudioSpikeDocument): string[] {
  const keys = new Set<string>();

  const visit = (node: EmailStudioSpikeNode) => {
    if (node.type === 'emailVariable' && typeof node.attrs?.key === 'string') {
      keys.add(node.attrs.key);
    }
    node.content?.forEach(visit);
  };

  document.content.forEach(visit);
  return Array.from(keys).sort();
}
