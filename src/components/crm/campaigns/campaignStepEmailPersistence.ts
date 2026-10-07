import type { CampaignStepFormData } from '@/lib/crm/campaign-types';

export type CanonicalCampaignEmailContent = NonNullable<CampaignStepFormData['email_content']>;

export function applyCanonicalCampaignEmailContent(
  step: CampaignStepFormData,
  emailContent: CanonicalCampaignEmailContent,
): CampaignStepFormData {
  return {
    ...step,
    email_body_html: emailContent.renderedHtml,
    email_body_text: emailContent.renderedText,
    email_preheader: emailContent.preheader || '',
    email_content: emailContent,
  };
}

export async function resolveCampaignEmailStepForSave(
  step: CampaignStepFormData,
  stepIndex: number,
  mountedExporter: (() => Promise<CanonicalCampaignEmailContent | null>) | null,
  cachedContent: CanonicalCampaignEmailContent | null,
): Promise<CampaignStepFormData> {
  const emailContent = mountedExporter ? await mountedExporter() : cachedContent;
  if (!emailContent) {
    throw new Error(`Step ${stepIndex + 1} contains invalid Email Studio content.`);
  }
  return applyCanonicalCampaignEmailContent(step, emailContent);
}
