import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CalendarClock, Search, UsersRound } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  CREATOR_INTEREST_CONFLICT_FEED_LIMIT,
  useCreatorCommunityInterestQueue,
} from '@/hooks/crm/useCreatorCommunityInterest';
import {
  DEFAULT_INTEREST_FILTERS,
  INTEREST_ROLE_OPTIONS,
  OUTREACH_STATUSES,
  REVIEW_STATES,
  VETERAN_AFFILIATIONS,
  contactDisplayName,
  filterAndSortInterestRecords,
  formatLabel,
  isOverdue,
  latestInterestReceivedAt,
  latestInterestSubmission,
  safeExternalHttpUrl,
  type InterestFilters,
} from '@/lib/crm/creator-community-interest';

function NativeSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  const id = `interest-filter-${label.toLowerCase().replace(/ /g, '-')}`;
  return (
    <div className="space-y-1">
      <Label className="text-xs" htmlFor={id}>{label}</Label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
        {children}
      </select>
    </div>
  );
}

export default function CreatorCommunityInterestQueue() {
  const { data, isPending, error } = useCreatorCommunityInterestQueue();
  const [filters, setFilters] = useState<InterestFilters>(DEFAULT_INTEREST_FILTERS);
  const patchFilter = <Key extends keyof InterestFilters>(key: Key, value: InterestFilters[Key]) => setFilters((current) => ({ ...current, [key]: value }));

  const records = useMemo(() => filterAndSortInterestRecords(data?.records ?? [], filters), [data?.records, filters]);
  const sourceOptions = useMemo(() => Array.from(new Set((data?.records ?? []).flatMap((record) => [
    record.contact.source,
    ...record.submissions.map(({ sourceSystem }) => sourceSystem),
  ]))).sort(), [data?.records]);
  const stateOptions = useMemo(() => Array.from(new Set((data?.records ?? []).map(({ contact }) => contact.state).filter((state): state is string => Boolean(state)))).sort(), [data?.records]);
  const platformOptions = useMemo(() => Array.from(new Set((data?.records ?? []).map(({ profile }) => profile?.highestFollowerPlatform).filter((platform): platform is string => Boolean(platform)))).sort(), [data?.records]);

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Creator, Promoter &amp; Community Interest</h1>
          <p className="text-sm text-muted-foreground">Review public interest submissions and manage outreach in the canonical relationship record.</p>
        </div>
        <Badge variant="secondary" className="w-fit text-sm">{records.length} shown</Badge>
      </header>

      {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Queue unavailable</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>}
      {Boolean(data?.conflicts?.length) && <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Identity reconciliation needed</AlertTitle><AlertDescription>{data?.conflicts.length} creator-interest submission{data?.conflicts.length === 1 ? '' : 's'} could not be linked to exactly one contact and remain in the staff conflict feed for manual review.</AlertDescription></Alert>}
      {Boolean(data?.conflicts?.length) && <Card className="space-y-3 p-4"><div><h2 className="font-semibold">Recent identity conflicts</h2><p className="text-xs text-muted-foreground">Showing up to {CREATOR_INTEREST_CONFLICT_FEED_LIMIT} most recent submissions. Expand a row to inspect the preserved intake payload.</p></div><div className="space-y-2">{data?.conflicts.map((conflict) => <details key={conflict.id} className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">{conflict.source_record_key}</summary><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><div><dt className="font-medium text-muted-foreground">Status</dt><dd>{formatLabel(conflict.status)}</dd></div><div><dt className="font-medium text-muted-foreground">Source page</dt><dd className="break-all">{conflict.source_page ?? 'Not recorded'}</dd></div><div><dt className="font-medium text-muted-foreground">Submitted</dt><dd>{new Date(conflict.submitted_at).toLocaleString()}</dd></div></dl><pre aria-label={`Payload for ${conflict.source_record_key}`} className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{JSON.stringify(conflict.payload, null, 2)}</pre></details>)}</div></Card>}

      <Card className="space-y-4 p-4">
        <div className="relative">
          <Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Label htmlFor="interest-search" className="sr-only">Search by name, email, social handle, or mission</Label>
          <Input id="interest-search" value={filters.search} onChange={(event) => patchFilter('search', event.target.value)} placeholder="Search name, email, social handle, or mission" className="pl-9" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <NativeSelect label="Review" value={filters.reviewState} onChange={(value) => patchFilter('reviewState', value)}><option value="all">All</option>{REVIEW_STATES.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}</NativeSelect>
          <NativeSelect label="Outreach" value={filters.outreachStatus} onChange={(value) => patchFilter('outreachStatus', value)}><option value="all">All</option>{OUTREACH_STATUSES.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}</NativeSelect>
          <NativeSelect label="Role" value={filters.role} onChange={(value) => patchFilter('role', value)}><option value="all">All</option>{INTEREST_ROLE_OPTIONS.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}</NativeSelect>
          <NativeSelect label="State" value={filters.state} onChange={(value) => patchFilter('state', value)}><option value="all">All</option>{stateOptions.map((value) => <option key={value}>{value}</option>)}</NativeSelect>
          <NativeSelect label="Veteran affiliation" value={filters.veteran} onChange={(value) => patchFilter('veteran', value as InterestFilters['veteran'])}><option value="all">All</option>{VETERAN_AFFILIATIONS.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}</NativeSelect>
          <NativeSelect label="Social" value={filters.social} onChange={(value) => patchFilter('social', value as InterestFilters['social'])}><option value="all">All</option><option value="yes">Has social</option><option value="no">No social</option></NativeSelect>
          <NativeSelect label="Avatar" value={filters.avatar} onChange={(value) => patchFilter('avatar', value as InterestFilters['avatar'])}><option value="all">All</option><option value="yes">Has avatar</option><option value="no">Missing avatar</option></NativeSelect>
          <NativeSelect label="Platform" value={filters.platform} onChange={(value) => patchFilter('platform', value)}><option value="all">All</option>{platformOptions.map((value) => <option key={value}>{value}</option>)}</NativeSelect>
          <NativeSelect label="Owner" value={filters.owner} onChange={(value) => patchFilter('owner', value)}><option value="all">All</option><option value="unassigned">Unassigned</option>{data?.owners.map((owner) => <option key={owner.profileId} value={owner.profileId}>{owner.label}</option>)}</NativeSelect>
          <NativeSelect label="Due" value={filters.overdue} onChange={(value) => patchFilter('overdue', value as InterestFilters['overdue'])}><option value="all">All</option><option value="yes">Overdue</option><option value="no">Not overdue</option></NativeSelect>
          <NativeSelect label="Source" value={filters.source} onChange={(value) => patchFilter('source', value)}><option value="all">All</option>{sourceOptions.map((value) => <option key={value}>{formatLabel(value)}</option>)}</NativeSelect>
          <NativeSelect label="Sort" value={filters.sort} onChange={(value) => patchFilter('sort', value as InterestFilters['sort'])}><option value="newest">Newest submission</option><option value="oldest_unreviewed">Oldest unreviewed</option><option value="followers">Highest follower count</option><option value="due">Next action due</option><option value="name">Name</option></NativeSelect>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Contact</TableHead><TableHead>Roles</TableHead><TableHead>Reach</TableHead><TableHead>Review / outreach</TableHead><TableHead>Owner</TableHead><TableHead>Next action</TableHead><TableHead>Source</TableHead><TableHead>Received</TableHead></TableRow></TableHeader>
            <TableBody>
              {isPending && <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">Loading interest queue…</TableCell></TableRow>}
              {!isPending && records.length === 0 && <TableRow><TableCell colSpan={8} className="py-12 text-center"><UsersRound className="mx-auto mb-2 h-7 w-7 text-muted-foreground" /><p className="font-medium">No matching interest records</p><p className="text-sm text-muted-foreground">Adjust the filters or wait for a new submission.</p></TableCell></TableRow>}
              {records.map((record) => {
                const name = contactDisplayName(record.contact);
                const legalName = [record.contact.firstName, record.contact.lastName].filter(Boolean).join(' ').trim();
                const latestSubmission = latestInterestSubmission(record);
                return (
                  <TableRow key={record.contact.id} className="align-top">
                    <TableCell><Link className="flex min-w-64 gap-3 hover:underline" to={`/crm/creator-community-interest/${record.contact.id}`}><Avatar><AvatarImage src={record.profile?.avatarUrl ?? undefined} alt="" /><AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar><span><span className="block font-medium">{name}</span>{legalName && legalName !== name && <span className="block text-xs text-muted-foreground">{legalName}</span>}<span className="block text-xs text-muted-foreground">{record.contact.email ?? 'No email'} · {record.contact.phone ?? 'No phone'} · {record.contact.state ?? 'No state'}</span><span className="block text-xs text-muted-foreground">{formatLabel(record.contact.veteranAffiliation)}{record.profile?.veteranConnection ? ` · ${record.profile.veteranConnection}` : ''}</span></span></Link></TableCell>
                    <TableCell><div className="flex max-w-56 flex-wrap gap-1">{record.roles.length ? record.roles.map(({ roleCode }) => <Badge key={roleCode} variant="outline">{formatLabel(roleCode)}</Badge>) : <span className="text-sm text-muted-foreground">None</span>}</div></TableCell>
                    <TableCell><div className="text-sm font-medium">{record.profile?.highestFollowerCount?.toLocaleString() ?? '—'}</div><div className="text-xs text-muted-foreground">{record.profile?.highestFollowerPlatform ?? record.socials[0]?.platformName ?? 'No social'}</div><div className="mt-1 flex max-w-44 flex-wrap gap-2">{record.socials.map((social) => { const href = safeExternalHttpUrl(social.profileUrl); return href ? <a key={social.id} className="text-xs text-primary underline" href={href} target="_blank" rel="noreferrer">{social.platformName}</a> : null; })}</div></TableCell>
                    <TableCell><Badge>{formatLabel(record.contact.reviewState)}</Badge><div className="mt-1 text-xs text-muted-foreground">{formatLabel(record.contact.outreachStatus)}</div></TableCell>
                    <TableCell className="text-sm">{record.owner?.label ?? 'Unassigned'}</TableCell>
                    <TableCell className={isOverdue(record) ? 'text-destructive' : ''}><div className="max-w-52 text-sm">{record.contact.nextAction ?? '—'}</div>{record.contact.nextActionDueAt && <div className="mt-1 flex items-center gap-1 text-xs"><CalendarClock className="h-3 w-3" />{new Date(record.contact.nextActionDueAt).toLocaleDateString()}</div>}</TableCell>
                    <TableCell className="text-xs"><span className="block">{formatLabel(latestSubmission?.sourceSystem ?? record.contact.source)}</span><span className="text-muted-foreground">{record.submissions.length} submission{record.submissions.length === 1 ? '' : 's'}</span></TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{new Date(latestInterestReceivedAt(record)).toLocaleDateString()}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
