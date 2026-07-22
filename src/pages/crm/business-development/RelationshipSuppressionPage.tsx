import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import {
  relationshipSuppressionReasons,
  relationshipSuppressionScopes,
  type RelationshipSuppression,
  type RelationshipSuppressionReason,
  type RelationshipSuppressionScope,
} from '@/domain/relationships/safety-contracts';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

const scopeLabels: Record<RelationshipSuppressionScope, string> = {
  global: 'All relationship outreach',
  organization: 'Organization',
  contact: 'Contact',
  email: 'Email address',
  campaign: 'Campaign',
};

const reasonLabels: Record<RelationshipSuppressionReason, string> = {
  manual: 'Manual safety stop',
  unsubscribe: 'Unsubscribe',
  do_not_contact: 'Do not contact',
  invalid_address: 'Invalid address',
  bounce: 'Delivery bounce',
  complaint: 'Complaint',
  campaign_stop: 'Campaign stop',
};

export default function RelationshipSuppressionPage() {
  const queryClient = useQueryClient();
  const { capability, isLoading: capabilityLoading, isError: capabilityError, refetch } = useRelationshipCapability('suppression');
  const available = capability?.available === true;
  const [scope, setScope] = useState<RelationshipSuppressionScope>('email');
  const [reason, setReason] = useState<RelationshipSuppressionReason>('manual');
  const [target, setTarget] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [showRevoked, setShowRevoked] = useState(false);
  const [revocationReasons, setRevocationReasons] = useState<Record<string, string>>({});

  const listQuery = useQuery({
    queryKey: ['relationship-suppressions', showRevoked],
    queryFn: () => dataProvider.relationships.listSuppressions({ activeOnly: !showRevoked, page: 1, pageSize: 100 }),
    enabled: available,
    retry: false,
  });

  const payload = useMemo(() => {
    const input: Record<string, unknown> = { scope, reason, source: 'crm_manual' };
    const value = target.trim();
    if (scope === 'organization') input.organizationId = value;
    if (scope === 'contact') input.contactId = value;
    if (scope === 'campaign') input.campaignId = value;
    if (scope === 'email') input.email = value.toLowerCase();
    if (expiresAt) input.expiresAt = new Date(expiresAt).toISOString();
    return input;
  }, [expiresAt, reason, scope, target]);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (scope !== 'global' && !target.trim()) throw new Error(`${scopeLabels[scope]} target is required.`);
      return dataProvider.relationships.applySuppression(payload as Parameters<typeof dataProvider.relationships.applySuppression>[0]);
    },
    onSuccess: async () => {
      setTarget('');
      setExpiresAt('');
      await queryClient.invalidateQueries({ queryKey: ['relationship-suppressions'] });
      await queryClient.invalidateQueries({ queryKey: ['relationship-enrollments'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (suppression: RelationshipSuppression) => dataProvider.relationships.revokeSuppression(suppression.id, {
      expectedVersion: suppression.version,
      reason: revocationReasons[suppression.id]?.trim() || undefined,
    }),
    onSuccess: async (suppression) => {
      setRevocationReasons((current) => ({ ...current, [suppression.id]: '' }));
      await queryClient.invalidateQueries({ queryKey: ['relationship-suppressions'] });
      await queryClient.invalidateQueries({ queryKey: ['relationship-enrollments'] });
    },
  });

  const pending = applyMutation.isPending || revokeMutation.isPending;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex flex-wrap gap-2"><Badge variant="outline">Pass 11</Badge><Badge variant="secondary">Communication safety</Badge></div>
        <h1 className="text-3xl font-bold tracking-tight">Relationship suppressions</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">Apply deterministic relationship-outreach safety stops. Active suppressions immediately block matching enrollments and cancel dormant work.</p>
      </div>

      <RelationshipCapabilityState state={capability} isLoading={capabilityLoading} isError={capabilityError} onRetry={() => { void refetch(); }} />

      <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
        <CardHeader>
          <CardTitle>Delivery remains disabled</CardTitle>
          <CardDescription>Pass 11 evaluates safety, records suppression evidence, and processes unsubscribe requests. It does not send messages or enable campaign execution.</CardDescription>
        </CardHeader>
      </Card>

      {available && (
        <Card>
          <CardHeader><CardTitle>Apply suppression</CardTitle><CardDescription>Global stops outrank email, contact, organization, and campaign stops during deterministic policy evaluation.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Scope" id="suppression-scope"><select id="suppression-scope" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={scope} onChange={(event) => { setScope(event.target.value as RelationshipSuppressionScope); setTarget(''); }}>{relationshipSuppressionScopes.map((item) => <option key={item} value={item}>{scopeLabels[item]}</option>)}</select></Field>
              <Field label="Reason" id="suppression-reason"><select id="suppression-reason" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={reason} onChange={(event) => setReason(event.target.value as RelationshipSuppressionReason)}>{relationshipSuppressionReasons.map((item) => <option key={item} value={item}>{reasonLabels[item]}</option>)}</select></Field>
              {scope !== 'global' && <Field label={scope === 'email' ? 'Email address' : `${scopeLabels[scope]} ID`} id="suppression-target"><Input id="suppression-target" value={target} onChange={(event) => setTarget(event.target.value)} placeholder={scope === 'email' ? 'person@example.org' : 'UUID'} /></Field>}
              <Field label="Optional expiration" id="suppression-expiration"><Input id="suppression-expiration" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></Field>
            </div>
            <Button disabled={pending || (scope !== 'global' && !target.trim())} onClick={() => applyMutation.mutate()}>{applyMutation.isPending ? 'Applying…' : 'Apply safety stop'}</Button>
            {applyMutation.isError && <p className="text-sm text-destructive">{errorMessage(applyMutation.error, 'Suppression could not be applied.')}</p>}
          </CardContent>
        </Card>
      )}

      {available && (
        <Card>
          <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Suppression ledger</CardTitle><CardDescription>{listQuery.data ? `${listQuery.data.total} records.` : 'Loading safety records.'}</CardDescription></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showRevoked} onChange={(event) => setShowRevoked(event.target.checked)} /> Include revoked</label></div></CardHeader>
          <CardContent className="space-y-4">
            {listQuery.isLoading && <p className="text-sm text-muted-foreground">Loading suppressions…</p>}
            {listQuery.isError && <p className="text-sm text-destructive">{errorMessage(listQuery.error, 'Suppressions could not be loaded.')}</p>}
            {listQuery.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No suppressions match this view.</p>}
            {listQuery.data?.items.map((suppression) => <SuppressionCard key={suppression.id} suppression={suppression} reason={revocationReasons[suppression.id] ?? ''} pending={pending} onReasonChange={(value) => setRevocationReasons((current) => ({ ...current, [suppression.id]: value }))} onRevoke={() => revokeMutation.mutate(suppression)} />)}
            {revokeMutation.isError && <p className="text-sm text-destructive">{errorMessage(revokeMutation.error, 'Suppression could not be revoked.')}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SuppressionCard({ suppression, reason, pending, onReasonChange, onRevoke }: { suppression: RelationshipSuppression; reason: string; pending: boolean; onReasonChange: (value: string) => void; onRevoke: () => void }) {
  const target = suppression.email ?? suppression.contactId ?? suppression.organizationId ?? suppression.campaignId ?? 'All relationship outreach';
  return <div className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{scopeLabels[suppression.scope]} · {reasonLabels[suppression.reason]}</p><p className="text-sm text-muted-foreground">{target}</p></div><div className="flex gap-2"><Badge variant={suppression.revokedAt ? 'secondary' : 'destructive'}>{suppression.revokedAt ? 'Revoked' : 'Active'}</Badge><Badge variant="outline">Version {suppression.version}</Badge></div></div><div className="grid gap-2 text-sm md:grid-cols-3"><p><span className="font-medium">Effective:</span> {new Date(suppression.effectiveAt).toLocaleString()}</p><p><span className="font-medium">Expires:</span> {suppression.expiresAt ? new Date(suppression.expiresAt).toLocaleString() : 'No expiration'}</p><p><span className="font-medium">Source:</span> {suppression.source}</p></div>{!suppression.revokedAt && <div className="space-y-2"><Label htmlFor={`revoke-${suppression.id}`}>Revocation reason</Label><Textarea id={`revoke-${suppression.id}`} value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="Why is this suppression being revoked?" /><Button variant="outline" disabled={pending} onClick={onRevoke}>Revoke without resuming outreach</Button></div>}</div>;
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
