import {
  EMAIL_CONTENT_MODES,
  type EmailContentMode,
  type EmailEditorDocument,
  type EmailEditorNode,
} from '../contracts';

export const EMAIL_STUDIO_SPIKE_MODES = EMAIL_CONTENT_MODES;

export type EmailStudioSpikeMode = EmailContentMode;
export type EmailStudioSpikeNode = EmailEditorNode;
export type EmailStudioSpikeDocument = EmailEditorDocument;

export type EmailStudioSpikeSnapshot = {
  mode: EmailStudioSpikeMode;
  preheader: string;
  editorDocument: EmailStudioSpikeDocument;
  html: string;
  text: string;
};

export const EMAIL_STUDIO_RENDERING_DECISION = {
  strategy: 'client_export_server_validation' as const,
  reason:
    'The supported editor export API requires a live TipTap Editor instance. Pass 1 therefore uses browser export and requires server validation before persistence or delivery. Edge-side rendering remains deferred until a dedicated Deno compatibility harness proves the full editor serializer dependency graph.',
};
