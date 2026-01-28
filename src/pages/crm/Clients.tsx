import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, List, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useClientsByStatus } from '@/hooks/crm/useClients';
import { ClientKanban } from '@/components/crm/clients/ClientKanban';
import { ClientTable } from '@/components/crm/clients/ClientTable';
import { ClientFilters } from '@/components/crm/clients/ClientFilters';
import { BulkActionBar } from '@/components/crm/clients/BulkActionBar';
import { BulkComposeDialog } from '@/components/crm/bulk/BulkComposeDialog';
import { BulkProgressModal } from '@/components/crm/bulk/BulkProgressModal';
import { useBulkSend } from '@/hooks/crm/useBulkSend';
import { useBulkSendStatus } from '@/hooks/crm/useBulkSendStatus';
import type { ClientFilters as ClientFiltersType, CrmClient, PatStatus } from '@/lib/crm/types';

export default function CrmClients() {
  const navigate = useNavigate();
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  const [filters, setFilters] = useState<ClientFiltersType>({
    statuses: [],
    states: [],
    search: '',
    tags: [],
  });

  // Selection state
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  
  // Bulk email dialog state
  const [composeDialogOpen, setComposeDialogOpen] = useState(false);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [activeBulkSendId, setActiveBulkSendId] = useState<string | null>(null);

  const { data: clients, isLoading, clientsByStatus } = useClientsByStatus({ filters });
  const { createBulkSend } = useBulkSend();
  const { data: bulkSendStatus } = useBulkSendStatus(activeBulkSendId);

  const handleClientClick = (clientId: string) => {
    navigate(`/crm/clients/${clientId}`);
  };

  const handleSearchChange = (value: string) => {
    setFilters(prev => ({ ...prev, search: value }));
  };

  const handleFiltersChange = (newFilters: Partial<ClientFiltersType>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  };

  // Selection handlers
  const handleSelectionChange = useCallback((clientId: string, selected: boolean) => {
    setSelectedClientIds(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(clientId);
      } else {
        next.delete(clientId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((selected: boolean) => {
    if (selected && clients) {
      setSelectedClientIds(new Set(clients.map(c => c.id)));
    } else {
      setSelectedClientIds(new Set());
    }
  }, [clients]);

  const handleClearSelection = useCallback(() => {
    setSelectedClientIds(new Set());
  }, []);

  // Bulk email handlers
  const handleOpenCompose = () => {
    setComposeDialogOpen(true);
  };

  const handleSendBulkEmail = async (subject: string, bodyHtml: string) => {
    try {
      const result = await createBulkSend.mutateAsync({
        clientIds: Array.from(selectedClientIds),
        subject,
        bodyHtml,
      });
      
      setComposeDialogOpen(false);
      setActiveBulkSendId(result.bulkSendId);
      setProgressModalOpen(true);
      setSelectedClientIds(new Set());
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

  // Clear selection when switching views
  const handleViewChange = (v: string) => {
    setView(v as 'kanban' | 'table');
    setSelectedClientIds(new Set());
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 border-b bg-card px-6 py-3">
        <div className="flex items-center gap-4 flex-1">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search clients..."
              value={filters.search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>
          <ClientFilters filters={filters} onChange={handleFiltersChange} />
        </div>

        <Tabs value={view} onValueChange={handleViewChange}>
          <TabsList>
            <TabsTrigger value="kanban" className="gap-2">
              <LayoutGrid className="h-4 w-4" />
              Kanban
            </TabsTrigger>
            <TabsTrigger value="table" className="gap-2">
              <List className="h-4 w-4" />
              Table
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-hidden">
        {view === 'kanban' ? (
          <ClientKanban
            clientsByStatus={clientsByStatus as Record<PatStatus, CrmClient[]>}
            isLoading={isLoading}
            onClientClick={handleClientClick}
          />
        ) : (
          <ClientTable
            clients={clients || []}
            isLoading={isLoading}
            onClientClick={handleClientClick}
            selectedClientIds={selectedClientIds}
            onSelectionChange={handleSelectionChange}
            onSelectAll={handleSelectAll}
          />
        )}
      </div>

      {/* Bulk Action Bar - only in table view */}
      {view === 'table' && (
        <BulkActionBar
          selectedCount={selectedClientIds.size}
          onSendEmail={handleOpenCompose}
          onClear={handleClearSelection}
        />
      )}

      {/* Compose Dialog */}
      <BulkComposeDialog
        open={composeDialogOpen}
        onOpenChange={setComposeDialogOpen}
        recipientCount={selectedClientIds.size}
        onSend={handleSendBulkEmail}
        isSending={createBulkSend.isPending}
      />

      {/* Progress Modal */}
      <BulkProgressModal
        open={progressModalOpen}
        onOpenChange={handleProgressModalClose}
        status={bulkSendStatus?.status ?? 'pending'}
        recipientCount={bulkSendStatus?.recipientCount ?? selectedClientIds.size}
        sentCount={bulkSendStatus?.sentCount ?? 0}
        failedCount={bulkSendStatus?.failedCount ?? 0}
      />
    </div>
  );
}
