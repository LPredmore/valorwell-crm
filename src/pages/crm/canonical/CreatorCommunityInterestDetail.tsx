import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, ImageOff, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useCreatorCommunityInterestDetail, useInterestMutations } from '@/hooks/crm/useCreatorCommunityInterest';
import {
  COMFORT_LEVELS,
  INTEREST_ROLE_OPTIONS,
  OUTREACH_STATUSES,
  REVIEW_STATES,
  STATE_CODES,
  VETERAN_AFFILIATIONS,
  contactDisplayName,
  formatLabel,
  isInterestRoleCode,
  safeExternalHttpUrl,
} from '@/lib/crm/creator-community-interest';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value || '—'}</dd></div>;
}

function asNullable(value: FormDataEntryValue | null): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function toLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function JsonPanel({ value }: { value: unknown }) {
  return <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

export default function CreatorCommunityInterestDetail() {
  const { id } = useParams();
  const { data, isPending, error } = useCreatorCommunityInterestDetail(id);
  const mutations = useInterestMutations(id ?? '');
  const [note, setNote] = useState('');
  const [roleToAdd, setRoleToAdd] = useState('creator');
  const [willingToShare, setWillingToShare] = useState<boolean | null>(null);
  useEffect(() => setWillingToShare(data?.record?.profile?.willingToShare ?? null), [data?.record?.profile?.willingToShare]);
  const availableRoleOptions = INTEREST_ROLE_OPTIONS.filter((option) => (
    !data?.record?.roles.some(({ roleCode }) => roleCode === option.code)
  ));
  const selectedRoleToAdd = availableRoleOptions.some(({ code }) => code === roleToAdd)
    ? roleToAdd
    : availableRoleOptions[0]?.code ?? '';

  if (isPending) return <div className="p-6 text-sm text-muted-foreground">Loading interest record…</div>;
  if (error) return <div className="p-6"><Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertTitle>Record unavailable</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert></div>;
  if (!data?.record) return <div className="space-y-4 p-6"><h1 className="text-2xl font-semibold">Interest record not found</h1><Button asChild variant="outline"><Link to="/crm/creator-community-interest">Return to queue</Link></Button></div>;

  const { contact, profile, roles, socials, submissions, notes } = data.record;
  const name = contactDisplayName(contact);
  const pending = mutations.updateRecord.isPending;

  async function saveCorrections(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mutations.canMutate) return;
    const form = new FormData(event.currentTarget);
    try {
      await mutations.updateRecord.mutateAsync({
        contactChanges: {
          first_name: asNullable(form.get('first_name')),
          last_name: asNullable(form.get('last_name')),
          preferred_name: asNullable(form.get('preferred_name')),
          email: asNullable(form.get('email')),
          phone: asNullable(form.get('phone')),
          state: asNullable(form.get('state')),
          veteran_affiliation: String(form.get('veteran_affiliation') || 'none'),
        },
        profileChanges: profile ? {
          motivation: asNullable(form.get('motivation')),
          veteran_connection: asNullable(form.get('veteran_connection')),
          comfort_level: asNullable(form.get('comfort_level')),
          fundraising_goal: asNullable(form.get('fundraising_goal')),
          personal_mission: asNullable(form.get('personal_mission')),
          additional_info: asNullable(form.get('additional_info')),
          willing_to_share: willingToShare,
        } : {},
      });
      toast.success('Canonical interest record updated');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Unable to update record');
    }
  }

  async function saveWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const due = asNullable(form.get('next_action_due_at'));
    const outreachStatus = String(form.get('outreach_status'));
    try {
      await mutations.updateRecord.mutateAsync({
        contactChanges: {
          owner_profile_id: asNullable(form.get('owner_profile_id')),
          outreach_status: outreachStatus,
          do_not_contact: outreachStatus === 'do_not_contact',
          review_state: String(form.get('review_state')),
          next_action: asNullable(form.get('next_action')),
          next_action_due_at: due ? new Date(due).toISOString() : null,
        },
      });
      toast.success('Outreach workflow updated');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Unable to update workflow');
    }
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      <Button variant="ghost" size="sm" asChild><Link to="/crm/creator-community-interest"><ArrowLeft className="mr-2 h-4 w-4" />Back to queue</Link></Button>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar className="h-20 w-20"><AvatarImage src={profile?.avatarUrl ?? undefined} alt="" /><AvatarFallback className="text-xl">{name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1"><h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1><p className="break-all text-sm text-muted-foreground">{contact.email ?? 'No email address'} · {contact.phone ?? 'No phone'}</p><div className="mt-2 flex flex-wrap gap-2"><Badge>{formatLabel(contact.reviewState)}</Badge><Badge variant="outline">{formatLabel(contact.outreachStatus)}</Badge>{contact.doNotContact && <Badge variant="destructive">Do not contact</Badge>}</div></div>
      </header>

      {!mutations.canMutate && <Alert><ShieldAlert className="h-4 w-4" /><AlertTitle>Read-only access</AlertTitle><AlertDescription>You can review this record, but your CRM capability does not permit corrections or workflow changes.</AlertDescription></Alert>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="space-y-5">
          <Card><CardHeader><CardTitle>Canonical contact and interest profile</CardTitle></CardHeader><CardContent>
            <form key={`corrections-${contact.updatedAt}`} className="space-y-5" onSubmit={saveCorrections}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1"><Label htmlFor="first_name">First name</Label><Input id="first_name" name="first_name" defaultValue={contact.firstName ?? ''} maxLength={100} required disabled={!mutations.canMutate} /></div>
                <div className="space-y-1"><Label htmlFor="last_name">Last name</Label><Input id="last_name" name="last_name" defaultValue={contact.lastName ?? ''} maxLength={100} required disabled={!mutations.canMutate} /></div>
                <div className="space-y-1"><Label htmlFor="preferred_name">Preferred name</Label><Input id="preferred_name" name="preferred_name" defaultValue={contact.preferredName ?? ''} maxLength={100} disabled={!mutations.canMutate} /></div>
                <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" defaultValue={contact.email ?? ''} maxLength={254} required disabled={!mutations.canMutate} /></div>
                <div className="space-y-1"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" type="tel" defaultValue={contact.phone ?? ''} maxLength={40} disabled={!mutations.canMutate} /></div>
                <div className="space-y-1"><Label htmlFor="state">State or territory</Label><select id="state" name="state" defaultValue={contact.state ?? ''} required disabled={!mutations.canMutate} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="" disabled>Select a state or territory</option>{STATE_CODES.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
                <div className="space-y-1"><Label htmlFor="veteran_affiliation">Veteran affiliation</Label><select id="veteran_affiliation" name="veteran_affiliation" defaultValue={contact.veteranAffiliation} disabled={!mutations.canMutate} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{VETERAN_AFFILIATIONS.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}</select></div>
              </div>
              {profile ? <>
                <Separator />
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1"><Label htmlFor="personal_mission">Personal mission</Label><Textarea id="personal_mission" name="personal_mission" defaultValue={profile.personalMission ?? ''} maxLength={4000} disabled={!mutations.canMutate} /></div>
                  <div className="space-y-1"><Label htmlFor="motivation">Motivation</Label><Textarea id="motivation" name="motivation" defaultValue={profile.motivation ?? ''} maxLength={4000} disabled={!mutations.canMutate} /></div>
                  <div className="space-y-1"><Label htmlFor="veteran_connection">Veteran connection</Label><Textarea id="veteran_connection" name="veteran_connection" defaultValue={profile.veteranConnection ?? ''} maxLength={1000} disabled={!mutations.canMutate} /></div>
                  <div className="space-y-1"><Label htmlFor="comfort_level">Comfort level</Label><select id="comfort_level" name="comfort_level" defaultValue={profile.comfortLevel ?? ''} disabled={!mutations.canMutate} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Not recorded</option>{COMFORT_LEVELS.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}</select></div>
                  <div className="space-y-1"><Label htmlFor="fundraising_goal">Fundraising goal</Label><Textarea id="fundraising_goal" name="fundraising_goal" defaultValue={profile.fundraisingGoal ?? ''} maxLength={1000} disabled={!mutations.canMutate} /></div>
                  <div className="space-y-1"><Label htmlFor="additional_info">Additional information</Label><Textarea id="additional_info" name="additional_info" defaultValue={profile.additionalInfo ?? ''} maxLength={8000} disabled={!mutations.canMutate} /></div>
                </div>
                <div className="flex items-center gap-2"><Checkbox id="willing_to_share" checked={willingToShare === true} onCheckedChange={(checked) => setWillingToShare(checked === true)} disabled={!mutations.canMutate} /><Label htmlFor="willing_to_share">Willing to share publicly</Label></div>
              </> : <Alert><ImageOff className="h-4 w-4" /><AlertTitle>No structured interest profile</AlertTitle><AlertDescription>The canonical contact is preserved, but no influencer profile is linked.</AlertDescription></Alert>}
              {mutations.canMutate && <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save corrections'}</Button>}
            </form>
          </CardContent></Card>

          <Card><CardHeader><CardTitle>Social profiles</CardTitle></CardHeader><CardContent className="space-y-3">{socials.length ? socials.map((social) => { const safeUrl = safeExternalHttpUrl(social.profileUrl); return <div key={social.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-medium">{social.platformName} {social.handle && <span className="text-muted-foreground">· {social.handle}</span>}</div><div className="text-sm text-muted-foreground">{social.followerCount?.toLocaleString() ?? 'Unknown'} followers · {social.approved == null ? 'Approval not recorded' : social.approved ? 'Approved' : 'Not approved'}</div><div className="text-xs text-muted-foreground">Source: {formatLabel(social.source)}</div></div>{safeUrl && <Button variant="outline" size="sm" asChild><a href={safeUrl} target="_blank" rel="noreferrer">Open profile <ExternalLink className="ml-2 h-3 w-3" /></a></Button>}</div>; }) : <p className="text-sm text-muted-foreground">No social profiles were supplied.</p>}</CardContent></Card>

          <Card><CardHeader><CardTitle>Submissions and source history</CardTitle></CardHeader><CardContent className="space-y-4">{submissions.length ? submissions.map((submission) => <section key={submission.id} className="space-y-2 rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-medium">{formatLabel(submission.submissionType)}</span><span className="ml-2 text-xs text-muted-foreground">{submission.sourceSystem} · {new Date(submission.submittedAt).toLocaleString()}</span><span className="block text-xs text-muted-foreground">{formatLabel(submission.originalLane)} → {formatLabel(submission.normalizedLane)}{submission.sourcePage ? ` · ${submission.sourcePage}` : ''}</span></div><Badge variant="outline">{formatLabel(submission.status)}</Badge></div><JsonPanel value={submission.payload} /></section>) : <p className="text-sm text-muted-foreground">No raw website submission is linked to this contact.</p>}</CardContent></Card>

          <Card><CardHeader><CardTitle>Interaction notes</CardTitle></CardHeader><CardContent className="space-y-4">
            {mutations.canMutate && <form className="space-y-2" onSubmit={async (event) => { event.preventDefault(); try { await mutations.addNote.mutateAsync(note); setNote(''); toast.success('Note added'); } catch (caught) { toast.error(caught instanceof Error ? caught.message : 'Unable to add note'); } }}><Label htmlFor="interest-note">Add internal note</Label><Textarea id="interest-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record an interaction or staff context" /><Button type="submit" disabled={!note.trim() || mutations.addNote.isPending}>{mutations.addNote.isPending ? 'Adding…' : 'Add note'}</Button></form>}
            <Separator />
            {notes.length ? notes.map((item) => <article key={item.id} className="rounded-md border p-3"><p className="whitespace-pre-wrap text-sm">{item.noteContent}</p><p className="mt-2 text-xs text-muted-foreground">{formatLabel(item.noteType)} · {new Date(item.createdAt).toLocaleString()}</p></article>) : <p className="text-sm text-muted-foreground">No interaction notes yet.</p>}
          </CardContent></Card>
        </div>

        <aside className="space-y-5">
          <Card><CardHeader><CardTitle>Outreach management</CardTitle></CardHeader><CardContent><form key={`workflow-${contact.updatedAt}`} className="space-y-4" onSubmit={saveWorkflow}>
            <div className="space-y-1"><Label htmlFor="review_state">Review state</Label><select id="review_state" name="review_state" defaultValue={contact.reviewState} disabled={!mutations.canMutate} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{REVIEW_STATES.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}</select></div>
            <div className="space-y-1"><Label htmlFor="outreach_status">Outreach status</Label><select id="outreach_status" name="outreach_status" defaultValue={contact.outreachStatus} disabled={!mutations.canMutate} aria-describedby="outreach-status-help" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{OUTREACH_STATUSES.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}</select><p id="outreach-status-help" className="text-xs text-muted-foreground">Selecting Do not contact also enforces the canonical contact restriction. Changing to another status clears that restriction.</p></div>
            <div className="space-y-1"><Label htmlFor="owner_profile_id">Owner</Label><select id="owner_profile_id" name="owner_profile_id" defaultValue={contact.ownerProfileId ?? ''} disabled={!mutations.canMutate} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Unassigned</option>{data.owners.map((owner) => <option key={owner.profileId} value={owner.profileId}>{owner.label}</option>)}</select></div>
            <div className="space-y-1"><Label htmlFor="next_action">Next action</Label><Textarea id="next_action" name="next_action" defaultValue={contact.nextAction ?? ''} maxLength={1000} disabled={!mutations.canMutate} /></div>
            <div className="space-y-1"><Label htmlFor="next_action_due_at">Due date and time</Label><Input id="next_action_due_at" name="next_action_due_at" type="datetime-local" defaultValue={toLocalDateTime(contact.nextActionDueAt)} disabled={!mutations.canMutate} /></div>
            {mutations.canMutate && <Button className="w-full" type="submit" disabled={mutations.updateRecord.isPending}>Save workflow</Button>}
          </form></CardContent></Card>

          <Card><CardHeader><CardTitle>Roles</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2">{roles.map(({ roleCode }) => <Badge key={roleCode} variant="secondary" className="gap-1">{formatLabel(roleCode)}{mutations.canMutate && isInterestRoleCode(roleCode) && <button type="button" aria-label={`Remove ${formatLabel(roleCode)} role`} onClick={async () => { try { await mutations.removeRole.mutateAsync(roleCode); toast.success('Role removed'); } catch (caught) { toast.error(caught instanceof Error ? caught.message : 'Unable to remove role'); } }}><Trash2 className="h-3 w-3" /></button>}</Badge>)}</div>{mutations.canMutate && <div className="flex gap-2"><select aria-label="Role to add" value={selectedRoleToAdd} disabled={availableRoleOptions.length === 0} onChange={(event) => setRoleToAdd(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm">{availableRoleOptions.length === 0 && <option value="">All interest roles assigned</option>}{availableRoleOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select><Button size="sm" type="button" disabled={!selectedRoleToAdd || mutations.addRole.isPending} onClick={async () => { try { await mutations.addRole.mutateAsync(selectedRoleToAdd); toast.success('Role added'); } catch (caught) { toast.error(caught instanceof Error ? caught.message : 'Unable to add role'); } }}>Add</Button></div>}</CardContent></Card>

          <Card><CardHeader><CardTitle>Record facts</CardTitle></CardHeader><CardContent><dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1"><Field label="Source" value={formatLabel(contact.source)} /><Field label="Source record key" value={contact.sourceRecordKey} /><Field label="Profile status" value={formatLabel(profile?.status)} /><Field label="Profile source" value={profile?.source} /><Field label="Profile source record key" value={profile?.sourceRecordKey} /><Field label="Avatar" value={safeExternalHttpUrl(profile?.avatarUrl) ? <a className="break-all text-primary underline" href={safeExternalHttpUrl(profile?.avatarUrl) as string} target="_blank" rel="noreferrer">View original</a> : profile?.avatarUrl ? 'Stored URL is not safe to open' : 'Missing'} /><Field label="Highest audience" value={profile?.highestFollowerCount == null ? null : `${profile.highestFollowerCount.toLocaleString()} on ${profile.highestFollowerPlatform ?? 'unknown platform'}`} /><Field label="Currently competing" value={profile?.isCompeting ? 'Yes' : 'No'} /><Field label="Profile complete" value={profile?.profileComplete == null ? 'Not recorded' : profile.profileComplete ? 'Yes' : 'No'} /><Field label="Accepted rules" value={profile?.acceptedRules == null ? 'Not recorded' : profile.acceptedRules ? 'Yes' : 'No'} /></dl>{profile?.pastCompetitions != null && <div className="mt-4"><Label>Competition history</Label><JsonPanel value={profile.pastCompetitions} /></div>}<div className="mt-4"><Label>Profile metadata</Label><JsonPanel value={profile?.metadata ?? {}} /></div><div className="mt-4"><Label>Canonical contact metadata</Label><JsonPanel value={contact.metadata} /></div></CardContent></Card>
        </aside>
      </div>
    </div>
  );
}
