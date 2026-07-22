import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import type { RelationshipSearchResult } from '@/domain/relationships/contracts';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

const kinds = ['organization', 'contact', 'opportunity', 'campaign'] as const satisfies readonly RelationshipSearchResult['kind'][];
const kindLabels: Record<RelationshipSearchResult['kind'], string> = {
  organization: 'Organizations', contact: 'Contacts', opportunity: 'BTY opportunities', campaign: 'Campaigns',
};

export default function RelationshipSearchPage() {
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('search');
  const available = capability?.available === true;
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [selectedKinds, setSelectedKinds] = useState<RelationshipSearchResult['kind'][]>([...kinds]);

  const results = useQuery({
    queryKey: ['relationship-search', query, selectedKinds],
    queryFn: () => dataProvider.relationships.search({ query, kinds: selectedKinds, page: 1, pageSize: 50 }),
    enabled: available && query.trim().length > 0,
    retry: false,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setQuery(draft.trim());
  };

  const toggleKind = (kind: RelationshipSearchResult['kind']) => {
    setSelectedKinds((current) => current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]);
  };

  return <div className="space-y-6">
    <div>
      <div className="mb-2 flex flex-wrap gap-2"><Badge variant="outline">Pass 13</Badge><Badge variant="secondary">Tenant-scoped search</Badge></div>
      <h1 className="text-3xl font-bold tracking-tight">Search relationships</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">Search organizations, contacts, Beyond The Yellow opportunities, and relationship campaigns without crossing into clinical CRM records.</p>
    </div>

    <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />

    <Card>
      <CardHeader><CardTitle>Unified search</CardTitle><CardDescription>Search uses Billing Hub full-text indexes and current CRM tenant permissions.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={submit}>
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Name, email, organization, cause area, or campaign" aria-label="Relationship search query" />
          <Button type="submit" disabled={!available || !draft.trim() || selectedKinds.length === 0}>Search</Button>
        </form>
        <fieldset className="flex flex-wrap gap-3">
          <legend className="sr-only">Search record types</legend>
          {kinds.map((kind) => <label className="flex items-center gap-2 text-sm" key={kind}>
            <input type="checkbox" checked={selectedKinds.includes(kind)} onChange={() => toggleKind(kind)} />{kindLabels[kind]}
          </label>)}
        </fieldset>
      </CardContent>
    </Card>

    {results.isLoading && <Card><CardHeader><CardTitle>Searching Billing Hub</CardTitle><CardDescription>Results are ranked by full-text relevance and current record activity.</CardDescription></CardHeader></Card>}
    {results.isError && <Card><CardHeader><CardTitle>Search unavailable</CardTitle><CardDescription>{message(results.error)}</CardDescription></CardHeader></Card>}

    {results.data && <Card>
      <CardHeader><CardTitle>Results</CardTitle><CardDescription>{results.data.total} matching records.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {results.data.items.map((result) => <Link key={`${result.kind}:${result.id}`} to={result.route} className="block rounded-lg border p-4 transition-colors hover:border-primary hover:bg-muted/30">
          <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-medium">{result.label}</p><Badge variant="outline">{kindLabels[result.kind]}</Badge></div>
          {result.detail && <p className="mt-1 text-sm text-muted-foreground">{result.detail}</p>}
        </Link>)}
        {results.data.items.length === 0 && <p className="text-sm text-muted-foreground">No relationship records match this search.</p>}
      </CardContent>
    </Card>}

    {!query && available && <Card><CardHeader><CardTitle>Enter a search term</CardTitle><CardDescription>An empty search intentionally returns no records rather than exposing a bulk directory.</CardDescription></CardHeader></Card>}
  </div>;
}

function message(error: unknown) { return error instanceof Error ? error.message : 'Relationship search could not be completed.'; }
