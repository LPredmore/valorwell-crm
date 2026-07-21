import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { RelationshipLifecyclePanel } from '@/components/crm/relationships/RelationshipLifecyclePanel';
import { RelationshipOpportunityPanel } from '@/components/crm/relationships/RelationshipOpportunityPanel';
import { RelationshipReferralPanel } from '@/components/crm/relationships/RelationshipReferralPanel';
import { relationshipStageLabel } from '@/domain/relationships/lifecycle-workflow';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

export default function ContactDetailPage() {
  const { id } = useParams();
  const contacts = useRelationshipCapability('contacts');
  const organizations = useRelationshipCapability('organizations');
  const contactAvailable = contacts.capability?.available === true;
  const organizationsAvailable = organizations.capability?.available === true;

  const contact = useQuery({
    queryKey: ['relationship-contact', id],
    queryFn: () => dataProvider.relationships.getContact(id!),
    enabled: contactAvailable && Boolean(id),
    retry: false,
  });

  const organizationQueries = useQueries({
    queries: (contact.data?.affiliations ?? []).map((affiliation) => ({
      queryKey: ['relationship-organization', affiliation.organizationId],
      queryFn: () => dataProvider.relationships.getOrganization(affiliation.organizationId),
      enabled: organizationsAvailable,
      retry: false,
    })),
  });

  const organizationNames = new Map(
    organizationQueries.flatMap((query) => query.data
      ? [[query.data.id, query.data.name] as const]
      : []),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{contact.data?.displayName ?? 'Contact detail'}</h1>
          <p className="mt-2 text-muted-foreground">Non-clinical relationship contact stored separately from client records.</p>
        </div>
        <Button asChild variant="outline"><Link to="/crm/business-development/contacts">Back to contacts</Link></Button>
      </div>

      <RelationshipCapabilityState state={contacts.capability} isLoading={contacts.isLoading} isError={contacts.isError} onRetry={() => { void contacts.refetch(); }} />

      {contact.isLoading && <Card><CardHeader><CardTitle>Loading contact…</CardTitle></CardHeader></Card>}
      {contact.isError && <Card><CardHeader><CardTitle>Contact could not be loaded</CardTitle><CardDescription>{contact.error instanceof Error ? contact.error.message : 'Unknown query error.'}</CardDescription></CardHeader></Card>}
      {contact.data === null && <Card><CardHeader><CardTitle>Contact not found</CardTitle><CardDescription>No relationship contact with this ID exists in the selected tenant.</CardDescription></CardHeader></Card>}

      {contact.data && <Card>
        <CardHeader><CardTitle>Contact summary</CardTitle><CardDescription>Values shown here are direct Billing Hub relationship fields.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Summary label="Lifecycle stage" value={relationshipStageLabel(contact.data.stage)} />
          <Summary label="Outreach status" value={contact.data.outreachStatus.replace(/_/g, ' ')} />
          <Summary label="Contact kind" value={contact.data.kind.replace(/_/g, ' ')} />
          <Summary label="Veteran affiliation" value={contact.data.veteranAffiliation.replace(/_/g, ' ')} />
          <Summary label="Email" value={contact.data.email ?? 'Not recorded'} />
          <Summary label="Phone" value={contact.data.phone ?? 'Not recorded'} />
          <Summary label="State" value={contact.data.state ?? 'Not recorded'} />
          <Summary label="Assigned owner" value={contact.data.ownerId ?? 'Unassigned'} />
          <Summary label="Next action" value={contact.data.nextAction ?? 'None'} />
          <Summary label="Next action due" value={formatDate(contact.data.nextActionDueAt)} />
          <Summary label="Last contact" value={formatDate(contact.data.lastContactAt)} />
          <div className="sm:col-span-2 lg:col-span-4"><Badge variant={contact.data.doNotContact ? 'destructive' : 'secondary'}>{contact.data.doNotContact ? 'Do not contact' : 'Contact allowed'}</Badge></div>
        </CardContent>
      </Card>}

      {contact.data && (
        <RelationshipLifecyclePanel
          subject={{ contactId: contact.data.id }}
          currentStage={contact.data.stage}
          entityLabel={contact.data.displayName}
        />
      )}

      {contact.data && (
        <RelationshipReferralPanel
          subject={{ contactId: contact.data.id }}
          entityLabel={contact.data.displayName}
        />
      )}

      {contact.data && (
        <RelationshipOpportunityPanel
          contactId={contact.data.id}
          entityLabel={contact.data.displayName}
        />
      )}

      {contact.data && <Card>
        <CardHeader><CardTitle>Organization affiliations</CardTitle><CardDescription>Each affiliation remains tenant-scoped and identifies the contact's role and primary organization.</CardDescription></CardHeader>
        <CardContent>
          {contact.data.affiliations.length === 0 && <p className="text-sm text-muted-foreground">This contact has no organization affiliations.</p>}
          {contact.data.affiliations.length > 0 && <div className="divide-y rounded border">{contact.data.affiliations.map((affiliation) => (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3" key={affiliation.organizationId}>
              <div>
                <Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/crm/business-development/organizations/${affiliation.organizationId}`}>
                  {organizationNames.get(affiliation.organizationId) ?? 'Organization detail'}
                </Link>
                <p className="text-xs text-muted-foreground">{affiliation.organizationId}</p>
              </div>
              <div className="text-right">
                <p className="text-sm">{affiliation.roleTitle ?? 'Role not recorded'}</p>
                {affiliation.isPrimary && <Badge variant="secondary">Primary</Badge>}
              </div>
            </div>
          ))}</div>}
        </CardContent>
      </Card>}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm">{value}</p></div>;
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}
