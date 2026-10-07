import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SearchCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  mergeBtyDuplicates,
  previewBtyDuplicates,
  type BtyDuplicateGroup,
} from '@/lib/crm/bty-automation';
import { useCanMutate } from '@/hooks/crm/useCanMutate';

export default function BtyAutomationPage() {
  const canMutate = useCanMutate();
  const queryClient = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const duplicates = useQuery({
    queryKey: ['bty-duplicate-preview'],
    queryFn: previewBtyDuplicates,
    retry: false,
  });
  const merge = useMutation({
    mutationFn: ({ group, reason }: { group: BtyDuplicateGroup; reason: string }) => mergeBtyDuplicates(group, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bty-duplicate-preview'] });
    },
  });

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">BTY Duplicate Cleanup</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Review deterministic organization duplicates and merge confirmed duplicate records into the oldest canonical organization.
        </p>
      </div>
      <Button asChild variant="outline"><Link to="/crm/business-development/organizations">Organizations</Link></Button>
    </div>

    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><SearchCheck className="h-5 w-5" />Duplicate cleanup</CardTitle>
        <CardDescription>Only deterministic matches (website domain, YouTube channel, exact name) can be merged. Fuzzy similarity remains review-only.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {duplicates.isLoading && <p className="text-sm text-muted-foreground">Scanning organizations…</p>}
        {duplicates.isError && <p className="text-sm text-destructive">{duplicates.error instanceof Error ? duplicates.error.message : 'Duplicate preview failed.'}</p>}
        {duplicates.data?.deterministic.length === 0 && <p className="text-sm text-muted-foreground">No deterministic duplicates were found.</p>}
        {duplicates.data?.deterministic.map((group) => <div className="space-y-2 rounded border p-3" key={`${group.matchType}:${group.matchKey}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{group.matchType.replace(/_/g, ' ')}</Badge>
            <span className="text-sm text-muted-foreground">{group.memberCount} records · keeping the oldest</span>
          </div>
          <ul className="space-y-1 text-sm">
            {group.members.map((member, index) => <li key={member.organizationId}>
              <Link className="text-primary hover:underline" to={`/crm/business-development/organizations/${member.organizationId}`}>{member.name}</Link>
              <span className="ml-2 text-muted-foreground">{index === 0 ? 'survivor' : 'merge into survivor'}{member.roles.length ? ` · ${member.roles.join(', ')}` : ''}</span>
            </li>)}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor={`merge-reason-${group.matchKey}`}>Merge reason</Label>
              <Input
                id={`merge-reason-${group.matchKey}`}
                value={reasons[group.matchKey] ?? ''}
                onChange={(event) => setReasons((current) => ({ ...current, [group.matchKey]: event.target.value }))}
                placeholder="Why these records are the same organization"
              />
            </div>
            <Button
              disabled={!canMutate || merge.isPending || !(reasons[group.matchKey] ?? '').trim()}
              onClick={() => merge.mutate({ group, reason: (reasons[group.matchKey] ?? '').trim() })}
            >
              {merge.isPending ? 'Merging…' : 'Merge duplicates'}
            </Button>
          </div>
        </div>)}
        {merge.isError && <p className="text-sm text-destructive">{merge.error instanceof Error ? merge.error.message : 'The merge failed.'}</p>}

        {duplicates.data?.ambiguous.length ? <div className="rounded border border-dashed p-3">
          <p className="text-sm font-medium">Manual review only</p>
          <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
            {duplicates.data.ambiguous.map((item) => <li key={`${item.organizationId}:${item.similarTo.organizationId}`}>{item.name} ↔ {item.similarTo.name}</li>)}
          </ul>
        </div> : null}
      </CardContent>
    </Card>
  </div>;
}
