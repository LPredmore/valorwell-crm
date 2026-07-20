import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RelationshipCampaignPreview } from '@/components/crm/relationships/RelationshipCampaignPreview';
import type { CommunicationPersonalizationContext, Referral } from '@/domain/relationships/contracts';

const namedContactContext: CommunicationPersonalizationContext = {
  contactKind: 'person',
  contactFirstName: 'Mina',
  contactDisplayName: 'Mina Rivera',
  organizationName: 'ValorWell Partners',
  organizationType: 'nonprofit',
  realActionSummary: 'Hosted a volunteer orientation',
  causeArea: 'veteran services',
  opportunityContext: 'A proven fit for community outreach',
  senderName: 'Tina',
  postalAddress: '123 Main St, Suite 200, Austin, TX 78701',
  unsubscribeUrl: 'https://example.test/unsubscribe',
  approvedSourceLanguage: 'research',
};

const roleInboxContext: CommunicationPersonalizationContext = {
  ...namedContactContext,
  contactKind: 'role_inbox',
  contactDisplayName: 'partnerships@valorwell.org',
  contactFirstName: undefined,
};

const researchReferral: Referral = {
  id: 'ref-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  sourceCategory: 'research',
  summary: 'Listed in a local veteran resource directory',
  evidenceUrls: [],
  verified: true,
  disclosure: 'community_anonymous',
};

const namedReferral: Referral = {
  id: 'ref-2',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  sourceCategory: 'partner',
  summary: 'Shared by a known partner',
  evidenceUrls: [],
  verified: true,
  disclosure: 'named_referrer',
  namedReferrer: 'Pat',
};

export default function RelationshipCampaignPreviewPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Relationship campaign preview</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">Preview how relationship campaigns render for named contacts, role inboxes, and approved referral language without using clinical campaign data.</p>
        </div>
        <Button asChild variant="outline"><Link to="/crm/business-development/campaigns">Back to campaigns</Link></Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preview scenarios</CardTitle>
          <CardDescription>Each preview validates safe variable resolution and surfaces unresolved or blocked content before activation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RelationshipCampaignPreview
            template="Hi {{contact_first_name}}, we saw {{organization_name}} and wanted to share {{real_action_summary}}. {{approved_source_sentence}}"
            context={namedContactContext}
            referral={researchReferral}
          />
          <RelationshipCampaignPreview
            template="Hello {{contact_display_name}}, we can help with {{cause_area}}. {{approved_source_sentence}}"
            context={roleInboxContext}
            referral={researchReferral}
          />
          <RelationshipCampaignPreview
            template="Hello {{contact_display_name}} from {{organization_name}}. {{approved_source_sentence}} and {{referral_claim}}"
            context={namedContactContext}
            referral={namedReferral}
          />
          <RelationshipCampaignPreview
            template="Hello {{contact_first_name}} from {{organization_name}}. {{organization_type}} {{cause_area}}"
            context={{ ...namedContactContext, organizationType: undefined, causeArea: undefined }}
            referral={undefined}
          />
        </CardContent>
      </Card>
    </div>
  );
}
