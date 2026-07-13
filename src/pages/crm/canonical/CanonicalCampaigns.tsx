import { useCampaigns } from '@/hooks/canonical/useCrmData';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default function CanonicalCampaigns() {
  const { data, isLoading } = useCampaigns();
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-sm text-muted-foreground">Multi-step outreach programs</p>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Suppressable Class</TableHead>
              <TableHead>Audience</TableHead>
              <TableHead className="text-right">Enrolled</TableHead>
              <TableHead className="text-right">Response rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {data?.map(c => (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">{c.description}</div>
                </TableCell>
                <TableCell><Badge variant={c.status === 'Active' ? 'default' : 'outline'}>{c.status}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.suppressableClass.replace(/_/g, ' ')}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{c.audienceSummary}</TableCell>
                <TableCell className="text-right tabular-nums">{c.metrics.enrolled}</TableCell>
                <TableCell className="text-right tabular-nums">{Math.round(c.metrics.responseRate * 100)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
