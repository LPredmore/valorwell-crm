import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCanMutate } from '@/hooks/crm/useCanMutate';
import {
  getCampaignParticipation,
  listAudienceCampaigns,
  listCampaignRegistry,
  listCampaignTriggerRules,
  upsertAudienceCampaign,
  type AudienceCampaign,
  type CampaignRegistryEntry,
} from '@/lib/crm/communications-control-plane';

const DOMAIN_LABELS: Record<string, string> = {
  client: 'Client campaigns',
  relationship: 'Relationship campaigns',
  staff: 'Staff campaigns',
  donor: 'Donor campaigns',
  bty: 'Beyond The Yellow campaigns',
};

type AudienceForm = {
  campaignId: string | null;
  audienceDomain: 'staff' | 'donor';
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  reason: string;
};

const emptyAudienceForm: AudienceForm = {
  campaignId: null,
  audienceDomain: 'staff',
  name: '',
  description: '',
  status: 'draft',
  reason: '',
};

function editorLinkFor(entry: CampaignRegistryEntry): string | null {
  if (entry.campaign_domain === 'client') return `/crm/campaigns/${entry.source_campaign_id}`;
  if (entry.campaign_domain === 'relationship' || entry.campaign_domain === 'bty') {
    return `/crm/business-development/campaigns/${entry.source_campaign_id}`;
  }
  return null;
}

export default function CampaignManagementPage() {
  const canMutate = useCanMutate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AudienceForm | null>(null);

  const registry = useQuery({ queryKey: ['campaign-registry'], queryFn: listCampaignRegistry, retry: false });
  const audiences = useQuery({ queryKey: ['audience-campaigns'], queryFn: listAudienceCampaigns, retry: false });
  const rules = useQuery({ queryKey: ['campaign-trigger-rules'], queryFn: listCampaignTriggerRules, retry: false });
  const participation = useQuery({
    queryKey: ['campaign-participation-overview'],
    queryFn: () => getCampaignParticipation({ limit: 25 }),
    retry: false,
  });

  const save = useMutation({
    mutationFn: (state: AudienceForm) =>
      upsertAudienceCampaign({
        campaignId: state.campaignId,
        audienceDomain: state.audienceDomain,
        name: state.name.trim(),
        description: state.description.trim() || null,
        status: state.status,
        reason: state.reason.trim(),
      }),
    onSuccess: () => {
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ['audience-campaigns'] });
      void queryClient.invalidateQueries({ queryKey: ['campaign-registry'] });
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, CampaignRegistryEntry[]>();
    for (const entry of registry.data ?? []) {
      const list = map.get(entry.campaign_domain) ?? [];
      list.push(entry);
      map.set(entry.campaign_domain, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [registry.data]);

  const rulesByCampaign = useMemo(() => {
    const map = new Map<string, number>();
    for (const rule of rules.data ?? []) {
      if (!rule.active) continue;
      map.set(rule.campaignRegistryId, (map.get(rule.campaignRegistryId) ?? 0) + 1);
    }
    return map;
  }, [rules.data]);

  const openAudience = (campaign: AudienceCampaign) => setForm({
    campaignId: campaign.id,
    audienceDomain: campaign.audienceDomain,
    name: campaign.name,
    description: campaign.description ?? '',
    status: (['draft', 'active', 'paused', 'archived'].includes(campaign.status) ? campaign.status : 'draft') as AudienceForm['status'],
    reason: '',
  });

  const formValid = Boolean(form && form.name.trim() && form.reason.trim());

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Campaign management</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Every campaign in the practice — client, relationship, staff and donor — in one place, with the business events that start them and the latest enrolments.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link to="/crm/communications/newsletters">Newsletters</Link></Button>
        <Button asChild variant="outline"><Link to="/crm/communications-control-plane">Control plane</Link></Button>
        <Button disabled={!canMutate} onClick={() => setForm({ ...emptyAudienceForm })}>New staff or donor campaign</Button>
      </div>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>All campaigns</CardTitle>
        <CardDescription>{registry.data?.length ?? 0} campaigns across every engine, kept in step automatically.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {registry.isLoading && <p className="text-sm text-muted-foreground">Loading campaigns…</p>}
        {registry.isError && <p className="text-sm text-destructive">{registry.error instanceof Error ? registry.error.message : 'Campaigns unavailable.'}</p>}
        {grouped.length === 0 && !registry.isLoading && !registry.isError && <p className="text-sm text-muted-foreground">No campaigns registered yet.</p>}
        {grouped.map(([domain, entries]) => <div className="space-y-1" key={domain}>
          <p className="text-sm font-semibold">{DOMAIN_LABELS[domain] ?? domain} <span className="font-normal text-muted-foreground">({entries.length})</span></p>
          {entries.map((entry) => {
            const link = editorLinkFor(entry);
            const triggerCount = rulesByCampaign.get(entry.id) ?? 0;
            return <div className="flex flex-wrap items-center gap-2 border-b py-2 text-sm last:border-0" key={entry.id}>
              {link
                ? <Link className="font-medium text-primary hover:underline" to={link}>{entry.name}</Link>
                : <span className="font-medium">{entry.name}</span>}
              <Badge variant="outline">{entry.engine}</Badge>
              <span className="text-muted-foreground">{entry.status}</span>
              {entry.is_active && <Badge variant="secondary">Active</Badge>}
              {triggerCount > 0 && <Badge variant="outline">{triggerCount} trigger{triggerCount === 1 ? '' : 's'}</Badge>}
            </div>;
          })}
        </div>)}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Staff and donor campaigns</CardTitle>
        <CardDescription>These can only be activated once the matching staff or donor switch is on in the control plane.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {audiences.isError && <p className="text-sm text-destructive">{audiences.error instanceof Error ? audiences.error.message : 'Audience campaigns unavailable.'}</p>}
        {(audiences.data ?? []).length === 0 && !audiences.isLoading && !audiences.isError && <p className="text-sm text-muted-foreground">No staff or donor campaigns yet.</p>}
        {(audiences.data ?? []).map((campaign) => <div className="flex flex-wrap items-center gap-2 border-b py-2 text-sm last:border-0" key={campaign.id}>
          <Badge variant="outline">{campaign.audienceDomain}</Badge>
          <span className="font-medium">{campaign.name}</span>
          <span className="text-muted-foreground">{campaign.status}</span>
          <span className="text-muted-foreground">{campaign.stepCount} steps</span>
          <span className="text-muted-foreground">{campaign.activeEnrollments} enrolled</span>
          {canMutate && <Button onClick={() => openAudience(campaign)} size="sm" variant="ghost">Edit</Button>}
        </div>)}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Trigger rules</CardTitle>
        <CardDescription>Which business event starts which campaign. Rules stay in shadow mode until the matching cutover switch is on.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rules.isError && <p className="text-sm text-destructive">{rules.error instanceof Error ? rules.error.message : 'Trigger rules unavailable.'}</p>}
        {(rules.data ?? []).length === 0 && !rules.isLoading && !rules.isError && <p className="text-sm text-muted-foreground">No trigger rules configured yet.</p>}
        {(rules.data ?? []).map((rule) => <div className="flex flex-wrap items-center gap-2 border-b py-2 text-sm last:border-0" key={rule.id}>
          <Badge variant="outline">{rule.eventType}</Badge>
          <span className="font-medium">{rule.campaignName ?? 'Unnamed campaign'}</span>
          <span className="text-muted-foreground">{rule.delayAmount > 0 ? `after ${rule.delayAmount} ${rule.delayUnit}` : 'immediately'}</span>
          {rule.active ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Paused</Badge>}
        </div>)}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Recent enrolments</CardTitle>
        <CardDescription>Latest 25 enrolments from every campaign domain in one list.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {participation.isError && <p className="text-sm text-destructive">{participation.error instanceof Error ? participation.error.message : 'Enrolments unavailable.'}</p>}
        {(participation.data ?? []).map((row) => <div className="flex flex-wrap items-center gap-2 border-b py-2 text-sm last:border-0" key={row.enrollmentId}>
          <Badge variant="outline">{row.campaignDomain}</Badge>
          <span className="font-medium">{row.campaignName ?? 'Unnamed campaign'}</span>
          <span className="text-muted-foreground">{row.status ?? 'unknown'}</span>
          <span className="text-muted-foreground">{row.enrolledAt ? new Date(row.enrolledAt).toLocaleDateString() : '—'}</span>
        </div>)}
      </CardContent>
    </Card>

    <Dialog onOpenChange={(open) => { if (!open) { setForm(null); save.reset(); } }} open={Boolean(form)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{form?.campaignId ? 'Edit campaign' : 'New staff or donor campaign'}</DialogTitle>
          <DialogDescription>Client and relationship campaigns are edited in their own builders; this form covers the audience engine.</DialogDescription>
        </DialogHeader>
        {form && <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="audience-domain">Audience</Label>
            <Select
              disabled={Boolean(form.campaignId)}
              onValueChange={(value) => setForm({ ...form, audienceDomain: value as 'staff' | 'donor' })}
              value={form.audienceDomain}
            >
              <SelectTrigger id="audience-domain"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="donor">Donors</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audience-name">Name</Label>
            <Input id="audience-name" onChange={(event) => setForm({ ...form, name: event.target.value })} value={form.name} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audience-description">Description</Label>
            <Textarea id="audience-description" onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} value={form.description} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audience-status">Status</Label>
            <Select onValueChange={(value) => setForm({ ...form, status: value as AudienceForm['status'] })} value={form.status}>
              <SelectTrigger id="audience-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audience-reason">Reason for this change</Label>
            <Input id="audience-reason" onChange={(event) => setForm({ ...form, reason: event.target.value })} value={form.reason} />
          </div>
          {save.isError && <p className="text-sm text-destructive">{save.error instanceof Error ? save.error.message : 'Could not save this campaign.'}</p>}
        </div>}
        <DialogFooter>
          <Button onClick={() => setForm(null)} variant="outline">Cancel</Button>
          <Button disabled={!formValid || save.isPending} onClick={() => form && save.mutate(form)}>
            {save.isPending ? 'Saving…' : 'Save campaign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
