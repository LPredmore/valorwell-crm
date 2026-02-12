import { useState } from 'react';
import { Mail, Phone, MapPin, User, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTherapistDisplayName, STATUS_CONFIG, ALL_STATUSES, getStatusConfig } from '@/lib/crm/status-config';
import { useUpdateClientStatus } from '@/hooks/crm/useUpdateClientStatus';
import { useBulkSend } from '@/hooks/crm/useBulkSend';
import { useBulkSms } from '@/hooks/crm/useBulkSms';
import { useBulkSendStatus } from '@/hooks/crm/useBulkSendStatus';
import { useBulkSmsStatus } from '@/hooks/crm/useBulkSmsStatus';
import { BulkComposeDialog } from '@/components/crm/bulk/BulkComposeDialog';
import { SmsComposeDialog } from '@/components/crm/bulk/SmsComposeDialog';
import { BulkProgressModal } from '@/components/crm/bulk/BulkProgressModal';
import { SmsProgressModal } from '@/components/crm/bulk/SmsProgressModal';
import type { CrmClient, PatStatus } from '@/lib/crm/types';
import { format } from 'date-fns';

interface ClientInfoCardProps {
  client: CrmClient;
}

export function ClientInfoCard({ client }: ClientInfoCardProps) {
  const updateStatus = useUpdateClientStatus();
  const { createBulkSend } = useBulkSend();
  const { createBulkSms } = useBulkSms();

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
          <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-sm font-medium">Client Since</p>
            <p className="text-sm text-muted-foreground">
              {format(new Date(client.created_at), 'MMMM d, yyyy')}
            </p>
          </div>
        </div>
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
