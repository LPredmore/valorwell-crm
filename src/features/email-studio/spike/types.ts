import {
  EMAIL_CONTENT_MODES,
  getEmailVariablesForScope,
  type EmailContentMode,
  type EmailEditorDocument,
  type EmailEditorNode,
  type EmailVariableDefinition,
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

const SPIKE_VARIABLE_KEYS = new Set(['first_name', 'organization_name', 'unsubscribe_url']);

export const EMAIL_STUDIO_SPIKE_VARIABLES = [
  ...getEmailVariablesForScope('client'),
  ...getEmailVariablesForScope('relationship'),
].filter(
  (variable, index, variables): variable is EmailVariableDefinition =>
    SPIKE_VARIABLE_KEYS.has(variable.key) &&
    variables.findIndex((candidate) => candidate.key === variable.key) === index,
);

export const EMAIL_STUDIO_RENDERING_DECISION = {
  strategy: 'client_export_server_validation' as const,
  reason:
    'The supported editor export API requires a live TipTap Editor instance. Pass 1 therefore uses browser export and requires server validation before persistence or delivery. Edge-side rendering remains deferred until a dedicated Deno compatibility harness proves the full editor serializer dependency graph.',
};
