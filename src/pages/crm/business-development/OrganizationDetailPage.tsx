import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { RelationshipLifecyclePanel } from '@/components/crm/relationships/RelationshipLifecyclePanel';
import { relationshipStageLabel } from '@/domain/relationships/lifecycle-workflow';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

export default function OrganizationDetailPage() {
  const { id } = useParams();
  const organizations = useRelationshipCapability('organizations');
  const contacts = useRelationshipCapability('contacts');
  const organizationAvailable = organizations.capability?.available === true;
  const contactsAvailable = contacts.capability?.available === true;

  const organization = useQuery({
    queryKey: ['relationship-organization', id],
    queryFn: () => dataProvider.relationships.getOrganization(id!),
    enabled: organizationAvailable && Boolean(id),
    retry: false,
  });

  const affiliatedContacts = useQuery({
    queryKey: ['relationship-organization-contacts', id],
    queryFn: () => dataProvider.relationships.listContacts({ organizationIds: [id!], page: 1, pageSize: 100 }),
    enabled: contactsAvailable && Boolean(id),
    retry: false,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{organization.data?.name ?? 'Organization detail'}</h1>
          <p className="mt-2 text-muted-foreground">Tenant-scoped, non-clinical relationship record.</p>
        </div>
        <div className="flex gap-2">
          {organization.data && <Button asChild><Link to={`/crm/business-development/organizations/${organization.data.id}/edit`}>Edit organization</Link></Button>}
          <Button asChild variant="outline"><Link to="/crm/business-development/organizations">Back to organizations</Link></Button>
        </div>
      </div>

      <RelationshipCapabilityState state={organizations.capability} isLoading={organizations.isLoading} isError={organizations.isError} onRetry={() => { void organizations.refetch(); }} />

      {organization.isLoading && <Card><CardHeader><CardTitle>Loading organization…</CardTitle></CardHeader></Card>}
      {organization.isError && <Card><CardHeader><CardTitle>Organization could not be loaded</CardTitle><CardDescription>{organization.error instanceof Error ? organization.error.message : 'Unknown query error.'}</CardDescription></CardHeader></Card>}
      {organization.data === null && <Card><CardHeader><CardTitle>Organization not found</CardTitle><CardDescription>No organization with this ID exists in the selected tenant.</CardDescription></CardHeader></Card>}

      {organization.data && <Card>
        <CardHeader><CardTitle>Organization summary</CardTitle><CardDescription>Values shown here are direct Billing Hub relationship fields.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Summary label="Lifecycle stage" value={relationshipStageLabel(organization.data.stage)} />
          <Summary label="Outreach status" value={organization.data.outreachStatus.replace(/_/g, ' ')} />
          <Summary label="Organization kind" value={organization.data.organizationKind ?? 'Not recorded'} />
          <Summary label="Veteran affiliated" value={organization.data.veteranAffiliated === undefined ? 'Not recorded' : organization.data.veteranAffiliated ? 'Yes' : 'No'} />
          <Summary label="Assigned owner" value={organization.data.ownerId ?? 'Unassigned'} />
          <Summary label="Website" value={organization.data.website ?? 'Not recorded'} />
          <Summary label="Next action" value={organization.data.nextAction ?? 'None'} />
          <Summary label="Next action due" value={formatDate(organization.data.nextActionDueAt)} />
          <Summary label="Last contact" value={formatDate(organization.data.lastContactAt)} />
          <div className="sm:col-span-2 lg:col-span-4"><Badge variant={organization.data.doNotContact ? 'destructive' : 'secondary'}>{organization.data.doNotContact ? 'Do not contact' : 'Contact allowed'}</Badge></div>
        </CardContent>
      </Card>}

      {organization.data && (
        <RelationshipLifecyclePanel
          subject={{ organizationId: organization.data.id }}
          currentStage={organization.data.stage}
          entityLabel={organization.data.name}
        />
      )}

      <Card>
        <CardHeader><CardTitle>Affiliated contacts</CardTitle><CardDescription>Contact membership is loaded through the composite tenant/contact/organization affiliation table.</CardDescription></CardHeader>
        <CardContent>
          {!contactsAvailable && <p className="text-sm text-muted-foreground">Contact database access is unavailable.</p>}
          {contactsAvailable && affiliatedContacts.isLoading && <p className="text-sm text-muted-foreground">Loading contacts…</p>}
          {affiliatedContacts.isError && <p className="text-sm text-destructive">{affiliatedContacts.error instanceof Error ? affiliatedContacts.error.message : 'Contacts could not be loaded.'}</p>}
          {affiliatedContacts.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No contacts are affiliated with this organization.</p>}
          {affiliatedContacts.data && affiliatedContacts.data.items.length > 0 && <div className="divide-y rounded border">{affiliatedContacts.data.items.map((contact) => {
            const affiliation = contact.affiliations.find((item) => item.organizationId === id);
            return <div className="flex flex-wrap items-center justify-between gap-2 p-3" key={contact.id}><div><Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/crm/business-development/contacts/${contact.id}`}>{contact.displayName}</Link><p className="text-sm text-muted-foreground">{contact.email ?? 'No email recorded'} · {relationshipStageLabel(contact.stage)}</p></div><div className="text-right"><p className="text-sm">{affiliation?.roleTitle ?? 'Role not recorded'}</p>{affiliation?.isPrimary && <Badge variant="secondary">Primary</Badge>}</div></div>;
          })}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Remaining relationship functions</CardTitle><CardDescription>Referrals, opportunities, campaigns, suppressions, and automated communications remain capability-gated for later implementation passes.</CardDescription></CardHeader>
      </Card>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm">{value}</p></div>;
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}
