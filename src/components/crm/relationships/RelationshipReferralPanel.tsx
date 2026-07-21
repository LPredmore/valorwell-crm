import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileCheck2, ShieldAlert, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { SafeExternalLink } from '@/components/crm/relationships/RelationshipWorkspacePrimitives';
import {
  approvedSourceLanguage,
  type Referral,
  type ReferralDisclosure,
} from '@/domain/relationships/contracts';
import {
  parseEvidenceUrlLines,
  referralDisclosureLabel,
  referralDisclosures,
  validateReferralInput,
} from '@/domain/relationships/referral-workflow';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import type { RelationshipSubject } from '@/repositories/relationships';
import { dataProvider } from '@/services/dataProvider';

export function RelationshipReferralPanel({
  subject,
  entityLabel,
}: {
  subject: Pick<RelationshipSubject, 'organizationId' | 'contactId'>;
  entityLabel: string;
}) {
  const capability = useRelationshipCapability('referrals');
  const available = capability.capability?.available === true;
  const queryClient = useQueryClient();
  const queryKey = ['relationship-referrals', subject.organizationId ?? null, subject.contactId ?? null];
  const [sourceCategory, setSourceCategory] = useState('community_referral');
  const [summary, setSummary] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  const [disclosure, setDisclosure] = useState<ReferralDisclosure>('internal');
  const [namedReferrer, setNamedReferrer] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const referrals = useQuery({
    queryKey,
    queryFn: () => dataProvider.relationships.listReferrals(subject),
    enabled: available,
    retry: false,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ['relationship-interactions'] }),
    ]);
  };

  const create = useMutation({
    mutationFn: () => dataProvider.relationships.createReferral({
      ...subject,
      sourceCategory,
      summary,
      evidenceUrls: parseEvidenceUrlLines(evidenceText),
      verified: false,
      disclosure,
      namedReferrer: disclosure === 'named_referrer' ? namedReferrer : undefined,
      notes,
    }),
    onSuccess: async () => {
      setSummary('');
      setEvidenceText('');
      setDisclosure('internal');
      setNamedReferrer('');
      setNotes('');
      setErrors({});
      await refresh();
    },
  });

  const submit = () => {
    const validation = validateReferralInput({
      ...subject,
      sourceCategory,
      summary,
      evidenceUrls: parseEvidenceUrlLines(evidenceText),
      verified: false,
      disclosure,
      namedReferrer,
      notes,
    });
    setErrors(validation.fieldErrors);
    if (!validation.valid) return;
    create.mutate();
  };

  return (
    <div className="space-y-6">
      <RelationshipCapabilityState
        state={capability.capability}
        isLoading={capability.isLoading}
        isError={capability.isError}
        onRetry={() => { void capability.refetch(); }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Referral and source evidence</CardTitle>
          <CardDescription>
            Record why {entityLabel} entered the relationship pipeline. Source identity is never implied unless the referral is verified for that disclosure mode.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field
            id="referral-source-category"
            label="Source category"
            value={sourceCategory}
            onChange={setSourceCategory}
            error={errors.sourceCategory}
            placeholder="community_referral"
          />
          <div className="space-y-2">
            <Label htmlFor="referral-disclosure">Disclosure handling</Label>
            <select
              id="referral-disclosure"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={disclosure}
              disabled={!available || create.isPending}
              onChange={(event) => setDisclosure(event.target.value as ReferralDisclosure)}
            >
              {referralDisclosures.map((value) => (
                <option value={value} key={value}>{referralDisclosureLabel(value)}</option>
              ))}
            </select>
            {errors.disclosure && <p className="text-sm text-destructive">{errors.disclosure}</p>}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="referral-summary">Source summary</Label>
            <Textarea
              id="referral-summary"
              value={summary}
              disabled={!available || create.isPending}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="What is known, how it was learned, and what remains unverified?"
            />
            {errors.summary && <p className="text-sm text-destructive">{errors.summary}</p>}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="referral-evidence">Evidence URLs</Label>
            <Textarea
              id="referral-evidence"
              value={evidenceText}
              disabled={!available || create.isPending}
              onChange={(event) => setEvidenceText(event.target.value)}
              placeholder="One public evidence URL per line"
            />
          </div>
          {disclosure === 'named_referrer' && (
            <Field
              id="referral-named-referrer"
              label="Named referrer"
              value={namedReferrer}
              onChange={setNamedReferrer}
              error={errors.namedReferrer}
              placeholder="Name authorized for disclosure"
            />
          )}
          <Field
            id="referral-notes"
            label="Internal notes"
            value={notes}
            onChange={setNotes}
            placeholder="Optional review notes"
          />
          {create.isError && (
            <p className="text-sm text-destructive md:col-span-2">
              {create.error instanceof Error ? create.error.message : 'The referral could not be created.'}
            </p>
          )}
          <div className="md:col-span-2">
            <Button type="button" disabled={!available || create.isPending} onClick={submit}>
              <FileCheck2 className="mr-2 h-4 w-4" />
              {create.isPending ? 'Recording source…' : 'Record referral evidence'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recorded referrals</CardTitle>
          <CardDescription>Verification and revocation actions are audit-attributed and also appear in the relationship timeline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {referrals.isLoading && <p className="text-sm text-muted-foreground">Loading referrals…</p>}
          {referrals.isError && <p className="text-sm text-destructive">{referrals.error instanceof Error ? referrals.error.message : 'Referrals could not be loaded.'}</p>}
          {referrals.data?.length === 0 && <p className="text-sm text-muted-foreground">No referral evidence has been recorded.</p>}
          {referrals.data?.map((referral) => (
            <ReferralRecord key={referral.id} referral={referral} onChanged={refresh} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ReferralRecord({ referral, onChanged }: { referral: Referral; onChanged: () => Promise<void> }) {
  const [disclosure, setDisclosure] = useState(referral.disclosure);
  const [namedReferrer, setNamedReferrer] = useState(referral.namedReferrer ?? '');
  const [notes, setNotes] = useState(referral.notes ?? '');
  const [error, setError] = useState<string>();

  useEffect(() => {
    setDisclosure(referral.disclosure);
    setNamedReferrer(referral.namedReferrer ?? '');
    setNotes(referral.notes ?? '');
  }, [referral]);

  const save = useMutation({
    mutationFn: () => dataProvider.relationships.updateReferral(referral.id, {
      disclosure,
      namedReferrer: disclosure === 'named_referrer' ? namedReferrer : undefined,
      notes,
    }),
    onSuccess: onChanged,
  });

  const verify = useMutation({
    mutationFn: async () => {
      if (disclosure === 'named_referrer' && !namedReferrer.trim()) {
        throw new Error('A named referrer is required before named verification.');
      }
      await dataProvider.relationships.updateReferral(referral.id, {
        disclosure,
        namedReferrer: disclosure === 'named_referrer' ? namedReferrer : undefined,
        notes,
      });
      return dataProvider.relationships.verifyReferral(referral.id, {
        verified: true,
        disclosure,
        verifiedBy: 'server-authoritative',
        verifiedAt: new Date().toISOString(),
        notes,
      });
    },
    onSuccess: onChanged,
  });

  const clearVerification = useMutation({
    mutationFn: () => dataProvider.relationships.verifyReferral(referral.id, {
      verified: false,
      disclosure,
      verifiedBy: 'server-authoritative',
      verifiedAt: new Date().toISOString(),
      notes,
    }),
    onSuccess: onChanged,
  });

  const revoke = useMutation({
    mutationFn: () => dataProvider.relationships.revokeReferral(referral.id, {
      revokedAt: new Date().toISOString(),
      note: notes,
    }),
    onSuccess: onChanged,
  });

  const pending = save.isPending || verify.isPending || clearVerification.isPending || revoke.isPending;
  const mutationError = save.error ?? verify.error ?? clearVerification.error ?? revoke.error;
  const sourceLanguage = approvedSourceLanguage(referral);

  const verifyNow = () => {
    setError(undefined);
    if (disclosure === 'named_referrer' && !namedReferrer.trim()) {
      setError('A named referrer is required before named verification.');
      return;
    }
    verify.mutate();
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{referral.sourceCategory.replace(/_/g, ' ')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{referral.summary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={referral.verified && !referral.revokedAt ? 'secondary' : 'outline'}>
            {referral.revokedAt ? 'Verification revoked' : referral.verified ? 'Verified' : 'Unverified'}
          </Badge>
          <Badge variant="outline">Source language: {sourceLanguage.replace(/_/g, ' ')}</Badge>
        </div>
      </div>

      {referral.evidenceUrls.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {referral.evidenceUrls.map((url, index) => (
            <SafeExternalLink href={url} key={url}>Evidence {index + 1}</SafeExternalLink>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`referral-disclosure-${referral.id}`}>Disclosure handling</Label>
          <select
            id={`referral-disclosure-${referral.id}`}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={disclosure}
            disabled={pending}
            onChange={(event) => setDisclosure(event.target.value as ReferralDisclosure)}
          >
            {referralDisclosures.map((value) => (
              <option value={value} key={value}>{referralDisclosureLabel(value)}</option>
            ))}
          </select>
        </div>
        {disclosure === 'named_referrer' && (
          <Field
            id={`referral-name-${referral.id}`}
            label="Named referrer"
            value={namedReferrer}
            onChange={setNamedReferrer}
            placeholder="Name authorized for disclosure"
          />
        )}
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor={`referral-notes-${referral.id}`}>Internal review notes</Label>
          <Textarea
            id={`referral-notes-${referral.id}`}
            value={notes}
            disabled={pending}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </div>

      {(error || mutationError) && (
        <p className="text-sm text-destructive">
          {error ?? (mutationError instanceof Error ? mutationError.message : 'The referral action failed.')}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => save.mutate()}>
          Save referral details
        </Button>
        {(!referral.verified || referral.revokedAt) && (
          <Button type="button" disabled={pending} onClick={verifyNow}>
            <CheckCircle2 className="mr-2 h-4 w-4" />Verify referral
          </Button>
        )}
        {referral.verified && !referral.revokedAt && (
          <>
            <Button type="button" variant="outline" disabled={pending} onClick={() => clearVerification.mutate()}>
              <ShieldAlert className="mr-2 h-4 w-4" />Clear verification
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={() => revoke.mutate()}>
              <XCircle className="mr-2 h-4 w-4" />Revoke verification
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Recorded {new Date(referral.createdAt).toLocaleString()}{referral.verifiedAt ? ` · verified ${new Date(referral.verifiedAt).toLocaleString()}` : ''}</p>
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