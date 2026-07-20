import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { prepareOrganizationSubmissionInput, validateOrganizationInput } from '@/domain/relationships/organization-form';
import {
  relationshipOutreachStatuses,
  type RelationshipOrganizationInput,
} from '@/domain/relationships/records';
import { dataProvider } from '@/services/dataProvider';

const initial: RelationshipOrganizationInput = {
  name: '',
  outreachStatus: 'new',
  doNotContact: false,
};

export default function OrganizationFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('organizations');
  const [input, setInput] = useState<RelationshipOrganizationInput>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editing = Boolean(id);
  const available = capability?.available === true;

  const existing = useQuery({
    queryKey: ['relationship-organization', id],
    queryFn: () => dataProvider.relationships.getOrganization(id!),
    enabled: available && editing,
    retry: false,
  });

  useEffect(() => {
    if (!existing.data) return;
    setInput({
      name: existing.data.name,
      website: existing.data.website,
      organizationKind: existing.data.organizationKind,
      veteranAffiliated: existing.data.veteranAffiliated,
      outreachStatus: existing.data.outreachStatus,
      ownerId: existing.data.ownerId,
      nextAction: existing.data.nextAction,
      nextActionDueAt: existing.data.nextActionDueAt,
      doNotContact: existing.data.doNotContact,
    });
  }, [existing.data]);

  const save = useMutation({
    mutationFn: (submission: RelationshipOrganizationInput) => editing
      ? dataProvider.relationships.updateOrganization(id!, submission)
      : dataProvider.relationships.createOrganization(submission),
    onSuccess: (organization) => {
      void queryClient.invalidateQueries({ queryKey: ['relationship-organizations'] });
      void queryClient.invalidateQueries({ queryKey: ['relationship-organization', organization.id] });
      navigate(`/crm/business-development/organizations/${organization.id}`);
    },
  });

  const submit = () => {
    const submissionInput = prepareOrganizationSubmissionInput(input);
    const result = validateOrganizationInput(submissionInput);
    setErrors(result.fieldErrors);
    if (!result.valid) return;
    save.mutate(submissionInput as RelationshipOrganizationInput);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{editing ? 'Edit organization' : 'New organization'}</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">Organization records are written only to the tenant-scoped Billing Hub relationship tables.</p>
        </div>
        <Button asChild variant="outline"><Link to="/crm/business-development/organizations">Back to organizations</Link></Button>
      </div>

      <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />

      {existing.isError && <Card><CardHeader><CardTitle>Organization could not be loaded</CardTitle><CardDescription>{existing.error instanceof Error ? existing.error.message : 'Unknown query error.'}</CardDescription></CardHeader></Card>}

      <Card>
        <CardHeader><CardTitle>Organization details</CardTitle><CardDescription>Lifecycle, review, opportunity, campaign, and free-form context fields remain disabled until their database contracts exist.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field id="name" label="Organization name" value={input.name} error={errors.name} onChange={(value) => setInput((current) => ({ ...current, name: value }))} placeholder="Required" />
          <Field id="website" label="Website" value={input.website ?? ''} error={errors.website} onChange={(value) => setInput((current) => ({ ...current, website: value }))} placeholder="https://example.org" />
          <Field id="organizationKind" label="Organization kind" value={input.organizationKind ?? ''} onChange={(value) => setInput((current) => ({ ...current, organizationKind: value }))} placeholder="e.g. nonprofit" />
          <Field id="ownerId" label="Assigned owner" value={input.ownerId ?? ''} onChange={(value) => setInput((current) => ({ ...current, ownerId: value }))} placeholder="Owner profile ID" />
          <div className="space-y-2"><Label htmlFor="outreachStatus">Outreach status</Label><select id="outreachStatus" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={input.outreachStatus ?? 'new'} onChange={(event) => setInput((current) => ({ ...current, outreachStatus: event.target.value as RelationshipOrganizationInput['outreachStatus'] }))}>{relationshipOutreachStatuses.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="veteranAffiliated">Veteran affiliated</Label><select id="veteranAffiliated" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={input.veteranAffiliated === undefined ? '' : String(input.veteranAffiliated)} onChange={(event) => setInput((current) => ({ ...current, veteranAffiliated: event.target.value === '' ? undefined : event.target.value === 'true' }))}><option value="">Not recorded</option><option value="true">Yes</option><option value="false">No</option></select></div>
          <Field id="nextAction" label="Next action" value={input.nextAction ?? ''} onChange={(value) => setInput((current) => ({ ...current, nextAction: value }))} placeholder="e.g. Research decision maker" />
          <Field id="nextActionDueAt" label="Next-action due date" type="datetime-local" value={input.nextActionDueAt ? toLocalDateTime(input.nextActionDueAt) : ''} onChange={(value) => setInput((current) => ({ ...current, nextActionDueAt: value ? new Date(value).toISOString() : undefined }))} />
          <div className="flex items-center gap-3 md:col-span-2"><Checkbox id="doNotContact" checked={input.doNotContact ?? false} onCheckedChange={(checked) => setInput((current) => ({ ...current, doNotContact: checked === true }))} /><Label htmlFor="doNotContact">Do not contact this organization</Label></div>
          {save.isError && <p className="text-sm text-destructive md:col-span-2">{save.error instanceof Error ? save.error.message : 'Organization could not be saved.'}</p>}
          <Button type="button" disabled={!available || existing.isLoading || save.isPending} title={!available ? 'Tenant-scoped database access is unavailable.' : undefined} onClick={submit}>{save.isPending ? 'Saving…' : editing ? 'Save organization' : 'Create organization'}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ id, label, value, onChange, placeholder, error, type = 'text' }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string; error?: string; type?: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-invalid={Boolean(error)} />{error && <p className="text-sm text-destructive">{error}</p>}</div>;
}

function toLocalDateTime(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
