export type PreparedRelationshipEmail = {
  subject?: string;
  renderedBody?: string;
  renderedHtml?: string;
  renderedText?: string;
};

export function buildRelationshipResendContent(communication: PreparedRelationshipEmail) {
  const text = communication.renderedText || communication.renderedBody || '';
  return {
    subject: communication.subject || 'ValorWell relationship outreach',
    text,
    ...(communication.renderedHtml ? { html: communication.renderedHtml } : {}),
  };
}
