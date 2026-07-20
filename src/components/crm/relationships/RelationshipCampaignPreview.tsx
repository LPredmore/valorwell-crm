import { AlertTriangle, CircleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { CommunicationPersonalizationContext, PersonalizationResult, Referral } from '@/domain/relationships/contracts';
import { resolveRelationshipCampaignPersonalization } from '@/services/relationships/personalization';

export function RelationshipCampaignPreview({
  template,
  context,
  referral,
}: {
  template: string;
  context: CommunicationPersonalizationContext;
  referral?: Referral;
}) {
  const result = resolveRelationshipCampaignPersonalization(template, context, referral);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaign preview</CardTitle>
        <CardDescription>Review how the relationship campaign will render for named contacts, role inboxes, and supported referral language.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded border bg-muted/30 p-3">
          <p className="text-sm whitespace-pre-wrap">{result.rendered}</p>
        </div>
        {result.unresolvedVariables.length > 0 && (
          <div className="rounded border border-amber-500/40 bg-amber-50/50 p-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <CircleAlert className="h-4 w-4" />
              Unresolved variables
            </div>
            <ul className="list-disc space-y-1 pl-5">
              {result.unresolvedVariables.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}
        {result.blockedClaims.length > 0 && (
          <div className="rounded border border-red-500/40 bg-red-50/50 p-3 text-sm text-red-900 dark:bg-red-950/20 dark:text-red-200">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Blocked claims
            </div>
            <ul className="list-disc space-y-1 pl-5">
              {result.blockedClaims.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Named contact</Badge>
          <Badge variant="outline">Role inbox</Badge>
          <Badge variant="outline">Research referral</Badge>
          <Badge variant="outline">Verified referral</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
