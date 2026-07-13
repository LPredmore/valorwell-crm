import { useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCanonicalClients } from '@/hooks/canonical/useCanonicalClients';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LIFECYCLE_STAGES, ENGAGEMENT_STATES, ELIGIBILITY_STATES, displayName, type LifecycleStage, type EngagementState } from '@/domain/canonical';
import { LifecycleBadge, EngagementBadge, EligibilityBadge, ContactPolicyBadge, AtRiskBadge } from '@/components/crm/canonical/StateBadges';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Filter, LayoutGrid, List, Search } from 'lucide-react';

export default function CanonicalClients() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [search, setSearch] = useState('');
  const lifecycle = params.getAll('lifecycle') as LifecycleStage[];
  const engagement = params.getAll('engagement') as EngagementState[];
  const atRisk = params.get('atRisk') === '1' ? true : undefined;

  const query = useMemo(() => ({
    search: search || undefined,
    lifecycle: lifecycle.length ? lifecycle : undefined,
    engagement: engagement.length ? engagement : undefined,
    atRisk,
    pageSize: 200,
  }), [search, lifecycle.join(','), engagement.join(','), atRisk]);

  const { data, isLoading } = useCanonicalClients(query);

  const toggleParam = (key: string, value: string) => {
    const cur = params.getAll(key);
    const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
    params.delete(key);
    next.forEach(v => params.append(key, v));
    setParams(params);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} canonical records</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border">
            <Button variant={view === 'table' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('table')}><List className="h-4 w-4" /></Button>
            <Button variant={view === 'kanban' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('kanban')}><LayoutGrid className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, phone…" className="pl-8" />
        </div>
        <FilterMenu label="Lifecycle" options={LIFECYCLE_STAGES} selected={lifecycle} onToggle={v => toggleParam('lifecycle', v)} />
        <FilterMenu label="Engagement" options={ENGAGEMENT_STATES} selected={engagement} onToggle={v => toggleParam('engagement', v)} />
        <FilterMenu label="Eligibility" options={ELIGIBILITY_STATES} selected={params.getAll('eligibility')} onToggle={v => toggleParam('eligibility', v)} />
        <Button
          variant={atRisk ? 'default' : 'outline'} size="sm"
          onClick={() => { if (atRisk) params.delete('atRisk'); else params.set('atRisk', '1'); setParams(params); }}
        >
          At Risk only
        </Button>
      </div>

      {view === 'table' ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Engagement</TableHead>
                <TableHead>Eligibility</TableHead>
                <TableHead>Policies</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Last contact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
              {data?.rows.map(c => (
                <TableRow key={c.id} className="cursor-pointer">
                  <TableCell>
                    <Link to={`/crm/canonical/clients/${c.id}`} className="font-medium hover:underline">{displayName(c)}</Link>
                    <div className="text-xs text-muted-foreground">{c.email ?? c.phone ?? '—'}</div>
                  </TableCell>
                  <TableCell><LifecycleBadge v={c.lifecycle} /></TableCell>
                  <TableCell><EngagementBadge v={c.engagement} /></TableCell>
                  <TableCell><EligibilityBadge v={c.eligibility} /></TableCell>
                  <TableCell className="space-x-1"><ContactPolicyBadge v={c.contactPolicy} /></TableCell>
                  <TableCell><AtRiskBadge r={c.risk} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.lastContactAt ? new Date(c.lastContactAt).toLocaleDateString() : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <div className="grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${LIFECYCLE_STAGES.length}, minmax(240px, 1fr))` }}>
          {LIFECYCLE_STAGES.map(stage => {
            const col = data?.rows.filter(c => c.lifecycle === stage) ?? [];
            return (
              <div key={stage} className="rounded-md border bg-muted/30 p-2">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{stage}</span>
                  <span className="text-xs text-muted-foreground">{col.length}</span>
                </div>
                <div className="space-y-2">
                  {col.map(c => (
                    <Link key={c.id} to={`/crm/canonical/clients/${c.id}`}>
                      <Card className="p-3 text-sm hover:shadow-sm">
                        <div className="font-medium">{displayName(c)}</div>
                        <div className="mt-1 flex flex-wrap gap-1"><EngagementBadge v={c.engagement} />{c.risk.atRisk && <AtRiskBadge r={c.risk} />}</div>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterMenu<T extends string>({ label, options, selected, onToggle }: { label: string; options: readonly T[]; selected: string[]; onToggle: (v: T) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="h-3.5 w-3.5" />
          {label}{selected.length ? ` · ${selected.length}` : ''}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {options.map(o => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
              <Checkbox checked={selected.includes(o)} onCheckedChange={() => onToggle(o)} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
