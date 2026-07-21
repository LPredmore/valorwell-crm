import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import {
  opportunityStatusLabel,
  parseQualificationLines,
  validateOpportunityInput,
} from '@/domain/relationships/opportunity-workflow';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

export function RelationshipOpportunityPanel({
  organizationId,
  contactId,
  entityLabel,
}: {
  organizationId?: string;
  contactId?: string;
  entityLabel: string;
}) {
  const capability = useRelationshipCapability('opportunities');
  const available = capability.capability?.available === true;
  const queryClient = useQueryClient();
  const queryKey = ['relationship-opportunities', organizationId ?? null, contactId ?? null];
  const [causeArea, setCauseArea] = useState('');
  const [veteranPriority, setVeteranPriority] = useState(false);
  const [nextAction, setNextAction] = useState('');
  const [nextActionDueAt, setNextActionDueAt] = useState('');
  const [qualificationText, setQualificationText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const opportunities = useQuery({
    queryKey,
    queryFn: () => dataProvider.relationships.listOpportunities({
      organizationIds: organizationId ? [organizationId] : undefined,
      contactIds: contactId ? [contactId] : undefined,
      page: 1,
      pageSize: 100,
      sortBy: 'updatedAt',
      sortDirection: 'desc',
    }),
    enabled: available && Boolean(organizationId || contactId),
    retry: false,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error('Create opportunities from an organization record.');
      const qualification = parseQualificationLines(qualificationText);
      const input = {
        organizationId,
        primaryContactId: contactId,
        status: 'identified' as const,
        veteranPriority,
        causeArea: causeArea.trim() || undefined,
        qualification,
        nextAction: nextAction.trim() || undefined,
        nextActionDueAt: nextActionDueAt ? new Date(nextActionDueAt).toISOString() : undefined,
      };
      const validation = validateOpportunityInput(input);
      setErrors(validation.fieldErrors);
      if (!validation.valid) throw new Error(validation.formError ?? 'Correct the opportunity fields.');
      return dataProvider.relationships.createOpportunity(input);
    },
    onSuccess: async () => {
      setCauseArea('');
      setVeteranPriority(false);
      setNextAction('');
      setNextActionDueAt('');
      setQualificationText('');
      setErrors({});
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  return (
    <div className="space-y-6">
      <RelationshipCapabilityState
        state={capability.capability}
        isLoading={capability.isLoading}
        isError={capability.isError}
        onRetry={() => { void capability.refetch(); }}
      />

      {organizationId && (
        <Card>
          <CardHeader>
            <CardTitle>Create opportunity</CardTitle>
            <CardDescription>
              Open a non-clinical Business Development opportunity for {entityLabel}. New opportunities start in Identified status.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field id="opportunity-cause-area" label="Cause area" value={causeArea} onChange={setCauseArea} error={errors.causeArea} placeholder="Veteran mental health, claims education, community action…" />
            <div className="space-y-2">
              <Label htmlFor="opportunity-next-action-due">Next action due</Label>
              <Input id="opportunity-next-action-due" type="datetime-local" value={nextActionDueAt} disabled={!available || create.isPending} onChange={(event) => setNextActionDueAt(event.target.value)} />
              {errors.nextActionDueAt && <p className="text-sm text-destructive">{errors.nextActionDueAt}</p>}
            </div>
            <Field id="opportunity-next-action" label="Next action" value={nextAction} onChange={setNextAction} placeholder="Research audience fit" />
            <label className="flex items-center gap-2 self-end rounded-md border p-3 text-sm">
              <input type="checkbox" checked={veteranPriority} disabled={!available || create.isPending} onChange={(event) => setVeteranPriority(event.target.checked)} />
              Veteran-priority opportunity
            </label>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="opportunity-qualification">Qualification evidence</Label>
              <Textarea id="opportunity-qualification" value={qualificationText} disabled={!available || create.isPending} onChange={(event) => setQualificationText(event.target.value)} placeholder={'One key=value per line\nmission_fit=true\naudience_reach=4\nreal_action=Runs weekly peer-support events'} />
              {errors.qualification && <p className="text-sm text-destructive">{errors.qualification}</p>}
            </div>
            {create.isError && <p className="text-sm text-destructive md:col-span-2">{create.error instanceof Error ? create.error.message : 'The opportunity could not be created.'}</p>}
            <div className="md:col-span-2">
              <Button type="button" disabled={!available || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Creating opportunity…' : 'Create opportunity'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Relationship opportunities</CardTitle>
          <CardDescription>Qualification and pipeline records associated with this relationship.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {opportunities.isLoading && <p className="text-sm text-muted-foreground">Loading opportunities…</p>}
          {opportunities.isError && <p className="text-sm text-destructive">{opportunities.error instanceof Error ? opportunities.error.message : 'Opportunities could not be loaded.'}</p>}
          {opportunities.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No opportunities are linked to this record.</p>}
          {opportunities.data?.items.map((opportunity) => (
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4" key={opportunity.id}>
              <div>
                <Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/crm/business-development/opportunities/${opportunity.id}`}>
                  {opportunity.causeArea ?? 'Business Development opportunity'}
                </Link>
                <p className="mt-1 text-sm text-muted-foreground">{opportunity.nextAction ?? 'No next action recorded'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{opportunityStatusLabel(opportunity.status)}</Badge>
                {opportunity.veteranPriority && <Badge variant="outline">Veteran priority</Badge>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
