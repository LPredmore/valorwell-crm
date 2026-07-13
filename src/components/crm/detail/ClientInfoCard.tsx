import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Mail, Phone, MapPin, User, Calendar, Tag, X, Check, ChevronsUpDown, Clock } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { getTherapistDisplayName, STATUS_CONFIG, ALL_STATUSES, getStatusConfig } from '@/lib/crm/status-config';
import { useUpdateClientStatus } from '@/hooks/crm/useUpdateClientStatus';
import { useUpdateClientTag } from '@/hooks/crm/useUpdateClientTag';
import { useTagOptions } from '@/hooks/crm/useTagOptions';
import { useBulkSend } from '@/hooks/crm/useBulkSend';
import { useBulkSms } from '@/hooks/crm/useBulkSms';
import { useBulkSendStatus } from '@/hooks/crm/useBulkSendStatus';
import { useBulkSmsStatus } from '@/hooks/crm/useBulkSmsStatus';
import { BulkComposeDialog } from '@/components/crm/bulk/BulkComposeDialog';
import { SmsComposeDialog } from '@/components/crm/bulk/SmsComposeDialog';
import { BulkProgressModal } from '@/components/crm/bulk/BulkProgressModal';
import { SmsProgressModal } from '@/components/crm/bulk/SmsProgressModal';
import { cn } from '@/lib/utils';
import type { CrmClient, PatStatus } from '@/lib/crm/types';
import { format, formatDistanceToNow } from 'date-fns';

function ClickUpSyncRow({ clientId, syncedAt }: { clientId: string; syncedAt: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const handleSync = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke('clickup-sync', {
        body: { client_id: clientId, action: 'upsert' },
      });
      if (error) throw error;
      toast({ title: 'Synced to ClickUp' });
      qc.invalidateQueries({ queryKey: ['crm-client', clientId] });
    } catch (e) {
      toast({ title: 'Sync failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-start gap-3">
      <RefreshCw className="h-4 w-4 text-muted-foreground mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-medium">ClickUp</p>
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {syncedAt ? `Synced ${formatDistanceToNow(new Date(syncedAt), { addSuffix: true })}` : 'Not yet synced'}
          </p>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleSync} disabled={busy}>
            {busy ? 'Syncing…' : 'Re-sync'}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ClientInfoCardProps {
  client: CrmClient;
}

export function ClientInfoCard({ client }: ClientInfoCardProps) {
  const updateStatus = useUpdateClientStatus();
  const updateTag = useUpdateClientTag();
  const { data: tagOptions = [] } = useTagOptions();
  const { createBulkSend } = useBulkSend();
  const { createBulkSms } = useBulkSms();
  const [tagOpen, setTagOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState('');

  const [emailOpen, setEmailOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [bulkSendId, setBulkSendId] = useState<string | null>(null);
  const [bulkSmsId, setBulkSmsId] = useState<string | null>(null);

  const emailStatus = useBulkSendStatus(bulkSendId);
  const smsStatus = useBulkSmsStatus(bulkSmsId);

  const handleSendEmail = async (subject: string, bodyHtml: string) => {
    const result = await createBulkSend.mutateAsync({ clientIds: [client.id], subject, bodyHtml });
    setEmailOpen(false);
    setBulkSendId(result.bulkSendId);
  };

  const handleSendSms = async (bodyText: string) => {
    const result = await createBulkSms.mutateAsync({ clientIds: [client.id], bodyText });
    setSmsOpen(false);
    setBulkSmsId(result.bulkSmsId);
  };

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === client.pat_status) return;
    updateStatus.mutate({
      clientId: client.id,
      newStatus: newStatus as PatStatus,
      oldStatus: client.pat_status,
    });
  };

  // Group statuses by category for the dropdown
  const categories = [
    { key: 'lead', label: 'Leads' },
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'active', label: 'Active' },
    { key: 'inactive', label: 'Inactive' },
    { key: 'closed', label: 'Closed' },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Client Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Selector */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Status</p>
          <Select
            value={client.pat_status || 'New'}
            onValueChange={handleStatusChange}
            disabled={updateStatus.isPending}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map(({ key, label }) => {
                const statuses = ALL_STATUSES.filter(s => STATUS_CONFIG[s].category === key);
                if (statuses.length === 0) return null;
                return (
                  <div key={key}>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {label}
                    </div>
                    {statuses.map(status => {
                      const config = getStatusConfig(status);
                      return (
                        <SelectItem key={status} value={status}>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: config.color }}
                            />
                            {config.label}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </div>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Tag Selector */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Tag</p>
          <div className="flex items-center gap-2">
            {client.tags ? (
              <Badge variant="secondary" className="gap-1">
                {client.tags}
                <button
                  type="button"
                  onClick={() => updateTag.mutate({ clientId: client.id, tag: null })}
                  className="ml-1 rounded-full hover:bg-muted-foreground/20"
                  disabled={updateTag.isPending}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ) : null}
            <Popover open={tagOpen} onOpenChange={setTagOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                  <Tag className="h-3 w-3" />
                  {client.tags ? 'Change' : 'Add Tag'}
                  <ChevronsUpDown className="h-3 w-3 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-0" align="start">
                <Command>
                  <CommandInput
                    placeholder="Search or create..."
                    value={tagSearch}
                    onValueChange={setTagSearch}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {tagSearch.trim() ? (
                        <button
                          type="button"
                          className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded"
                          onClick={() => {
                            updateTag.mutate({ clientId: client.id, tag: tagSearch.trim() });
                            setTagOpen(false);
                            setTagSearch('');
                          }}
                        >
                          Create "<span className="font-medium">{tagSearch.trim()}</span>"
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-xs">No tags found</span>
                      )}
                    </CommandEmpty>
                    <CommandGroup>
                      {tagOptions.map((tag) => (
                        <CommandItem
                          key={tag}
                          value={tag}
                          onSelect={() => {
                            updateTag.mutate({ clientId: client.id, tag });
                            setTagOpen(false);
                            setTagSearch('');
                          }}
                        >
                          <Check className={cn('h-4 w-4 mr-2', client.tags === tag ? 'opacity-100' : 'opacity-0')} />
                          {tag}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {client.email && (
          <div className="flex items-start gap-3">
            <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">Email</p>
              <button
                type="button"
                onClick={() => setEmailOpen(true)}
                className="text-sm text-muted-foreground hover:text-primary hover:underline text-left"
              >
                {client.email}
              </button>
            </div>
          </div>
        )}

        {client.phone && (
          <div className="flex items-start gap-3">
            <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">Phone</p>
              <button
                type="button"
                onClick={() => setSmsOpen(true)}
                className="text-sm text-muted-foreground hover:text-primary hover:underline text-left"
              >
                {client.phone}
              </button>
            </div>
          </div>
        )}

        {client.pat_state && (
          <div className="flex items-start gap-3">
            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">State</p>
              <p className="text-sm text-muted-foreground">{client.pat_state}</p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-3">
          <User className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-sm font-medium">Primary Therapist</p>
            <p className="text-sm text-muted-foreground">
              {getTherapistDisplayName(client.primary_staff)}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-sm font-medium">Last Contact</p>
            {client.last_contact_at ? (
              <p className="text-sm text-muted-foreground">
                {formatDistanceToNow(new Date(client.last_contact_at), { addSuffix: true })}
                {client.last_contact_direction && client.last_contact_channel && (
                  <span className="ml-1">
                    · {client.last_contact_channel === 'email' ? 'Email' : 'SMS'}{' '}
                    {client.last_contact_direction}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No contact yet</p>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-sm font-medium">Client Since</p>
            <p className="text-sm text-muted-foreground">
              {format(new Date(client.created_at), 'MMMM d, yyyy')}
            </p>
          </div>
        </div>

        <ClickUpSyncRow clientId={client.id} syncedAt={client.clickup_synced_at ?? null} />
      </CardContent>

      {/* Compose Dialogs */}
      <BulkComposeDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        recipientCount={1}
        onSend={handleSendEmail}
        isSending={createBulkSend.isPending}
      />
      <SmsComposeDialog
        open={smsOpen}
        onOpenChange={setSmsOpen}
        recipientCount={1}
        onSend={handleSendSms}
        isSending={createBulkSms.isPending}
      />

      {/* Progress Modals */}
      <BulkProgressModal
        open={!!bulkSendId}
        onOpenChange={(open) => { if (!open) setBulkSendId(null); }}
        status={emailStatus.data?.status ?? 'pending'}
        recipientCount={emailStatus.data?.recipientCount ?? 1}
        sentCount={emailStatus.data?.sentCount ?? 0}
        failedCount={emailStatus.data?.failedCount ?? 0}
      />
      <SmsProgressModal
        open={!!bulkSmsId}
        onOpenChange={(open) => { if (!open) setBulkSmsId(null); }}
        status={smsStatus.data?.status ?? 'pending'}
        recipientCount={smsStatus.data?.recipientCount ?? 1}
        sentCount={smsStatus.data?.sentCount ?? 0}
        failedCount={smsStatus.data?.failedCount ?? 0}
      />
    </Card>
  );
}
