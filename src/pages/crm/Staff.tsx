import { useState, useCallback } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useStaff } from '@/hooks/crm/useStaff';
import { StaffTable } from '@/components/crm/staff/StaffTable';
import { StaffFilters } from '@/components/crm/staff/StaffFilters';
import { BulkActionBar } from '@/components/crm/clients/BulkActionBar';
import { BulkComposeDialog } from '@/components/crm/bulk/BulkComposeDialog';
import { BulkProgressModal } from '@/components/crm/bulk/BulkProgressModal';
import { SmsComposeDialog } from '@/components/crm/bulk/SmsComposeDialog';
import { SmsProgressModal } from '@/components/crm/bulk/SmsProgressModal';
import { useBulkSend } from '@/hooks/crm/useBulkSend';
import { useBulkSendStatus } from '@/hooks/crm/useBulkSendStatus';
import { useBulkSms } from '@/hooks/crm/useBulkSms';
import { useBulkSmsStatus } from '@/hooks/crm/useBulkSmsStatus';
import type { StaffFilters as StaffFiltersType } from '@/lib/crm/staff-types';

export default function CrmStaff() {
  const [filters, setFilters] = useState<StaffFiltersType>({
    statuses: [],
    states: [],
    search: '',
  });

  // Selection state
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());
  
  // Email bulk dialog state
  const [composeDialogOpen, setComposeDialogOpen] = useState(false);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [activeBulkSendId, setActiveBulkSendId] = useState<string | null>(null);

  // SMS bulk dialog state
  const [smsComposeDialogOpen, setSmsComposeDialogOpen] = useState(false);
  const [smsProgressModalOpen, setSmsProgressModalOpen] = useState(false);
  const [activeBulkSmsId, setActiveBulkSmsId] = useState<string | null>(null);

  const { data: staff, isLoading } = useStaff({ filters });
  const { createBulkSend } = useBulkSend();
  const { data: bulkSendStatus } = useBulkSendStatus(activeBulkSendId);
  const { createBulkSms } = useBulkSms();
  const { data: bulkSmsStatus } = useBulkSmsStatus(activeBulkSmsId);

  const handleSearchChange = (value: string) => {
    setFilters(prev => ({ ...prev, search: value }));
  };

  const handleFiltersChange = (newFilters: Partial<StaffFiltersType>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  };

  // Selection handlers
  const handleSelectionChange = useCallback((staffId: string, selected: boolean) => {
    setSelectedStaffIds(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(staffId);
      } else {
        next.delete(staffId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((selected: boolean) => {
    if (selected && staff) {
      setSelectedStaffIds(new Set(staff.map(s => s.id)));
    } else {
      setSelectedStaffIds(new Set());
    }
  }, [staff]);

  const handleClearSelection = useCallback(() => {
    setSelectedStaffIds(new Set());
  }, []);

  // Email bulk handlers
  const handleOpenCompose = () => {
    setComposeDialogOpen(true);
  };

  const handleSendBulkEmail = async (subject: string, bodyHtml: string) => {
    try {
      const result = await createBulkSend.mutateAsync({
        staffIds: Array.from(selectedStaffIds),
        subject,
        bodyHtml,
      });
      
      setComposeDialogOpen(false);
      setActiveBulkSendId(result.bulkSendId);
      setProgressModalOpen(true);
      setSelectedStaffIds(new Set());
    } catch (error) {
      console.error('Failed to start bulk send:', error);
    }
  };

  const handleProgressModalClose = (open: boolean) => {
    if (!open) {
      setProgressModalOpen(false);
      setActiveBulkSendId(null);
    }
  };

  // SMS bulk handlers
  const handleOpenSmsCompose = () => {
    setSmsComposeDialogOpen(true);
  };

  const handleSendBulkSms = async (bodyText: string) => {
    try {
      const result = await createBulkSms.mutateAsync({
        staffIds: Array.from(selectedStaffIds),
        bodyText,
      });
      
      setSmsComposeDialogOpen(false);
      setActiveBulkSmsId(result.bulkSmsId);
      setSmsProgressModalOpen(true);
      setSelectedStaffIds(new Set());
    } catch (error) {
      console.error('Failed to start bulk SMS:', error);
    }
  };

  const handleSmsProgressModalClose = (open: boolean) => {
    if (!open) {
      setSmsProgressModalOpen(false);
      setActiveBulkSmsId(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 border-b bg-card px-6 py-3">
        <div className="flex items-center gap-4 flex-1">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search staff..."
              value={filters.search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>
          <StaffFilters filters={filters} onChange={handleFiltersChange} />
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <StaffTable
          staff={staff || []}
          isLoading={isLoading}
          selectedStaffIds={selectedStaffIds}
          onSelectionChange={handleSelectionChange}
          onSelectAll={handleSelectAll}
        />
      </div>

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedCount={selectedStaffIds.size}
        onSendEmail={handleOpenCompose}
        onSendSms={handleOpenSmsCompose}
        onClear={handleClearSelection}
        entityLabel="staff"
      />

      {/* Email Compose Dialog */}
      <BulkComposeDialog
        open={composeDialogOpen}
        onOpenChange={setComposeDialogOpen}
        recipientCount={selectedStaffIds.size}
        onSend={handleSendBulkEmail}
        isSending={createBulkSend.isPending}
        recipientLabel="staff member"
      />

      {/* Email Progress Modal */}
      <BulkProgressModal
        open={progressModalOpen}
        onOpenChange={handleProgressModalClose}
        status={bulkSendStatus?.status ?? 'pending'}
        recipientCount={bulkSendStatus?.recipientCount ?? selectedStaffIds.size}
        sentCount={bulkSendStatus?.sentCount ?? 0}
        failedCount={bulkSendStatus?.failedCount ?? 0}
      />

      {/* SMS Compose Dialog */}
      <SmsComposeDialog
        open={smsComposeDialogOpen}
        onOpenChange={setSmsComposeDialogOpen}
        recipientCount={selectedStaffIds.size}
        onSend={handleSendBulkSms}
        isSending={createBulkSms.isPending}
        recipientLabel="staff member"
      />

      {/* SMS Progress Modal */}
      <SmsProgressModal
        open={smsProgressModalOpen}
        onOpenChange={handleSmsProgressModalClose}
        status={bulkSmsStatus?.status ?? 'pending'}
        recipientCount={bulkSmsStatus?.recipientCount ?? selectedStaffIds.size}
        sentCount={bulkSmsStatus?.sentCount ?? 0}
        failedCount={bulkSmsStatus?.failedCount ?? 0}
      />
    </div>
  );
}
