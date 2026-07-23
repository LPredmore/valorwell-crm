import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useCampaigns } from '@/hooks/canonical/useCrmData';
import { useCanMutate } from '@/hooks/crm/useCanMutate';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function CanonicalCampaigns() {
  const { data, isLoading, isError, error, refetch } = useCampaigns();
  const canManageCampaigns = useCanMutate(undefined, 'manage_campaigns');

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Multi-step outreach programs</p>
        </div>
        {canManageCampaigns ? (
          <Button asChild>
            <Link to="/crm/campaigns/new/edit">
              <Plus className="mr-2 h-4 w-4" />
              New campaign
            </Link>
          </Button>
        ) : (
          <Button disabled title="Your CRM role cannot manage campaigns.">
            <Plus className="mr-2 h-4 w-4" />
            New campaign
          </Button>
        )}
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
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Loading…</TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center">
                  <div className="space-y-3">
                    <p className="text-sm text-destructive">
                      {error instanceof Error ? error.message : 'Campaigns could not be loaded.'}
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={() => { void refetch(); }}>
                      Try again
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No campaigns have been created yet.
                </TableCell>
              </TableRow>
            )}
            {data?.map((campaign) => (
              <TableRow key={campaign.id}>
                <TableCell>
                  <Link className="font-medium text-primary hover:underline" to={`/crm/campaigns/${campaign.id}`}>
                    {campaign.name}
                  </Link>
                  <div className="text-xs text-muted-foreground line-clamp-1">{campaign.description}</div>
                </TableCell>
                <TableCell><Badge variant={campaign.status === 'Active' ? 'default' : 'outline'}>{campaign.status}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{campaign.suppressableClass.replace(/_/g, ' ')}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{campaign.audienceSummary}</TableCell>
                <TableCell className="text-right tabular-nums">{campaign.metrics.enrolled}</TableCell>
                <TableCell className="text-right tabular-nums">{Math.round(campaign.metrics.responseRate * 100)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
