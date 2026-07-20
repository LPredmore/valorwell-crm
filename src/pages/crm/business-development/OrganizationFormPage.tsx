import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { prepareOrganizationSubmissionInput, validateOrganizationInput } from '@/domain/relationships/organization-form';
import type { OrganizationInput } from '@/domain/relationships/contracts';

const initial: Partial<OrganizationInput> = { stage: 'identified', doNotContact: false, roles: [], socialProfiles: [] };
const fields = [
  ['name', 'Organization name', 'Required'], ['website', 'Website', 'https://example.org'], ['type', 'Organization classification', 'e.g. nonprofit'], ['state', 'State or service area', 'e.g. VA'], ['ownerId', 'Assigned owner', 'Staff ID'], ['outreachStatus', 'Outreach status', 'e.g. not_contacted'], ['reviewStatus', 'Review state', 'e.g. pending_review'], ['nextAction', 'Next action', 'e.g. Research decision maker'], ['nextActionDueAt', 'Next-action due date', 'YYYY-MM-DD'],
] as const;

export default function OrganizationFormPage() {
  const { id } = useParams();
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('organizations');
  const [input, setInput] = useState<Partial<OrganizationInput>>(initial);
  const [rolesText, setRolesText] = useState('');
  const [socialProfilesText, setSocialProfilesText] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editing = Boolean(id);

  const submit = () => {
    const submissionInput = prepareOrganizationSubmissionInput(input, rolesText, socialProfilesText, description);
    const result = validateOrganizationInput(submissionInput);
    setErrors(result.fieldErrors);
  };

  return <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold tracking-tight">{editing ? 'Edit organization' : 'New organization'}</h1><p className="mt-2 max-w-3xl text-muted-foreground">Organization data stays in the dedicated relationship domain and is never written to clinical client records.</p></div><Button asChild variant="outline"><Link to="/crm/business-development/organizations">Back to organizations</Link></Button></div><RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} /><Card><CardHeader><CardTitle>Organization details</CardTitle><CardDescription>Required fields and write controls remain capability-gated until the typed database adapter is installed.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">{fields.map(([key, label, placeholder]) => <div className="space-y-2" key={key}><Label htmlFor={key}>{label}</Label><Input id={key} value={String(input[key] ?? '')} onChange={(event) => setInput(current => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} aria-invalid={Boolean(errors[key])} />{errors[key] && <p className="text-sm text-destructive">{errors[key]}</p>}</div>)}<div className="space-y-2"><Label htmlFor="stage">Relationship stage</Label><Input id="stage" value={input.stage ?? ''} onChange={(event) => setInput(current => ({ ...current, stage: event.target.value as OrganizationInput['stage'] }))} /></div><div className="space-y-2"><Label htmlFor="roles">Organization roles</Label><Input id="roles" value={rolesText} onChange={(event) => setRolesText(event.target.value)} placeholder="Role codes, comma-separated" /></div><div className="space-y-2"><Label htmlFor="socialProfiles">Social profiles</Label><Input id="socialProfiles" value={socialProfilesText} onChange={(event) => setSocialProfilesText(event.target.value)} placeholder="Profile URLs, comma-separated" /></div><div className="space-y-2 md:col-span-2"><Label htmlFor="description">Description, mission, relationship reason, initiatives, and value lanes</Label><Textarea id="description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Internal relationship context" /></div><Button type="button" disabled={!capability?.available} title={!capability?.available ? 'Database support pending for this action.' : undefined} onClick={submit}>{editing ? 'Save organization' : 'Create organization'}</Button></CardContent></Card></div>;
}
