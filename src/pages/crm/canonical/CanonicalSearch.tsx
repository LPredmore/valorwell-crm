import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCanonicalClients } from '@/hooks/canonical/useCanonicalClients';
import { useTasks, useCampaigns, useStaffList, useExceptions } from '@/hooks/canonical/useCrmData';

export default function CanonicalSearch() {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();

  const { data: clientsPage } = useCanonicalClients({ pageSize: 500 });
  const { data: tasks = [] } = useTasks({});
  const { data: campaigns = [] } = useCampaigns();
  const { data: staff = [] } = useStaffList();
  const { data: exceptions = [] } = useExceptions();

  const results = useMemo(() => {
    if (!term) return { clients: [], tasks: [], campaigns: [], staff: [], exceptions: [] };
    const inc = (s?: string) => (s ?? '').toLowerCase().includes(term);
    return {
      clients: (clientsPage?.rows ?? []).filter((c) => inc(c.legalFirstName) || inc(c.legalLastName) || inc(c.preferredName) || inc(c.email) || inc(c.phone) || inc(c.id)).slice(0, 25),
      tasks: tasks.filter((t) => inc(t.title) || inc(t.description)).slice(0, 25),
      campaigns: campaigns.filter((c) => inc(c.name) || inc(c.description)).slice(0, 25),
      staff: staff.filter((s) => inc(s.displayName) || inc(s.email)).slice(0, 25),
      exceptions: exceptions.filter((e) => inc(e.summary) || inc(e.type)).slice(0, 25),
    };
  }, [term, clientsPage, tasks, campaigns, staff, exceptions]);

  const total = results.clients.length + results.tasks.length + results.campaigns.length + results.staff.length + results.exceptions.length;

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">Search across clients, tasks, campaigns, staff, and exceptions.</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>

      {!term && <div className="text-sm text-muted-foreground">Start typing to search.</div>}
      {term && total === 0 && <div className="text-sm text-muted-foreground">No matches.</div>}

      {results.clients.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Clients ({results.clients.length})</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {results.clients.map((c) => (
              <Link key={c.id} to={`/crm/canonical/clients/${c.id}`} className="flex items-center justify-between py-2 text-sm hover:underline">
                <span className="font-medium">{c.preferredName || `${c.legalFirstName} ${c.legalLastName}`}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{c.lifecycle}</Badge>
                  {c.email ?? c.phone}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {results.tasks.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Tasks ({results.tasks.length})</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {results.tasks.map((t) => (
              <Link key={t.id} to="/crm/canonical/tasks" className="flex items-center justify-between py-2 text-sm hover:underline">
                <span className="font-medium">{t.title}</span>
                <Badge variant="outline">{t.status}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {results.campaigns.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Campaigns ({results.campaigns.length})</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {results.campaigns.map((c) => (
              <Link key={c.id} to={`/crm/canonical/campaigns/${c.id}`} className="flex items-center justify-between py-2 text-sm hover:underline">
                <span className="font-medium">{c.name}</span>
                <Badge variant="outline">{c.status}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {results.staff.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Staff ({results.staff.length})</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {results.staff.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium">{s.displayName}</span>
                <span className="text-xs text-muted-foreground">{s.role} · {s.email}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {results.exceptions.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Exceptions ({results.exceptions.length})</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {results.exceptions.map((e) => (
              <Link key={e.id} to="/crm/canonical/exceptions" className="flex items-center justify-between py-2 text-sm hover:underline">
                <span className="font-medium">{e.summary}</span>
                <Badge variant="outline">{e.severity}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
