export const EMAIL_STUDIO_SPIKE_MODES = ['direct', 'campaign', 'newsletter'] as const;

export type EmailStudioSpikeMode = (typeof EMAIL_STUDIO_SPIKE_MODES)[number];

export type EmailStudioSpikeNode = {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: EmailStudioSpikeNode[];
};

export type EmailStudioSpikeDocument = {
  type: 'doc';
  content: EmailStudioSpikeNode[];
};

export type EmailStudioSpikeSnapshot = {
  mode: EmailStudioSpikeMode;
  preheader: string;
  editorDocument: EmailStudioSpikeDocument;
  html: string;
  text: string;
};

export type EmailStudioSpikeVariable = {
  key: string;
  label: string;
  scope: 'client' | 'relationship' | 'system';
  sampleValue: string;
};

export const EMAIL_STUDIO_SPIKE_VARIABLES: readonly EmailStudioSpikeVariable[] = [
  {
    key: 'first_name',
    label: 'Client first name',
    scope: 'client',
    sampleValue: 'Jordan',
  },
  {
    key: 'organization_name',
    label: 'Organization name',
    scope: 'relationship',
    sampleValue: 'Community Veterans Network',
  },
  {
    key: 'unsubscribe_url',
    label: 'Unsubscribe URL',
    scope: 'system',
    sampleValue: 'https://crm.valorwell.org/unsubscribe/example',
  },
] as const;

export const EMAIL_STUDIO_RENDERING_DECISION = {
  strategy: 'client_export_server_validation' as const,
  reason:
    'The supported editor export API requires a live TipTap Editor instance. Pass 1 therefore uses browser export and requires server validation before persistence or delivery. Edge-side rendering remains deferred until a dedicated Deno compatibility harness proves the full editor serializer dependency graph.',
};
