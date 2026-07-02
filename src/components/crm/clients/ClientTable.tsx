import { useMemo, useState } from 'react';
import { Loader2, Eye, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { StatusBadge } from './StatusBadge';
import { getClientDisplayName, getTherapistDisplayName, STATUS_CONFIG } from '@/lib/crm/status-config';
import type { CrmClient, PatStatus } from '@/lib/crm/types';
import { formatDistanceToNow } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type SortColumn = 'name' | 'email' | 'phone' | 'status' | 'state' | 'therapist' | 'updated_at' | 'last_contact_at';
type SortDirection = 'asc' | 'desc';

interface ClientTableProps {
  clients: CrmClient[];
  isLoading: boolean;
  onClientClick: (clientId: string) => void;
  onQuickView?: (client: CrmClient) => void;
  selectedClientIds?: Set<string>;
  onSelectionChange?: (clientId: string, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
}

function getSortValue(client: CrmClient, column: SortColumn): string | number {
  switch (column) {
    case 'name':
      return getClientDisplayName(client).toLowerCase();
    case 'email':
      return (client.email || '').toLowerCase();
    case 'phone':
      return (client.phone || '').toLowerCase();
    case 'status':
      return STATUS_CONFIG[client.pat_status as PatStatus]?.order ?? 999;
    case 'state':
      return (client.pat_state || '').toLowerCase();
    case 'therapist':
      return getTherapistDisplayName(client.primary_staff).toLowerCase();
    case 'updated_at':
      return new Date(client.updated_at).getTime();
    case 'last_contact_at':
      return client.last_contact_at ? new Date(client.last_contact_at).getTime() : 0;
    default:
      return '';
  }
}

export function ClientTable({
  clients,
  isLoading,
  onClientClick,
  onQuickView,
  selectedClientIds = new Set(),
  onSelectionChange,
  onSelectAll,
}: ClientTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const selectionEnabled = !!onSelectionChange && !!onSelectAll;
  const allSelected = clients.length > 0 && clients.every(c => selectedClientIds.has(c.id));
  const someSelected = clients.some(c => selectedClientIds.has(c.id)) && !allSelected;

  const sortedClients = useMemo(() => {
    if (!sortColumn) return clients;
    return [...clients].sort((a, b) => {
      const aVal = getSortValue(a, sortColumn);
      const bVal = getSortValue(b, sortColumn);
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [clients, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection(column === 'updated_at' || column === 'last_contact_at' ? 'desc' : 'asc');
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">No clients found</p>
      </div>
    );
  }

  const handleRowClick = (clientId: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-checkbox]')) return;
    onClientClick(clientId);
  };

  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return <ChevronsUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDirection === 'asc'
      ? <ChevronUp className="h-3 w-3 ml-1" />
      : <ChevronDown className="h-3 w-3 ml-1" />;
  };

  const SortableHead = ({ column, children, className }: { column: SortColumn; children: React.ReactNode; className?: string }) => (
    <TableHead
      className={cn('cursor-pointer select-none hover:bg-muted/50', className)}
      onClick={() => handleSort(column)}
    >
      <div className="flex items-center">
        {children}
        <SortIcon column={column} />
      </div>
    </TableHead>
  );

  return (
    <ScrollArea className="h-full">
      <Table>
        <TableHeader>
          <TableRow>
            {selectionEnabled && (
              <TableHead className="w-[50px]">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(checked) => onSelectAll?.(checked === true)}
                  aria-label="Select all clients"
                  data-checkbox
                />
              </TableHead>
            )}
            <SortableHead column="name">Name</SortableHead>
            <SortableHead column="email">Email</SortableHead>
            <SortableHead column="phone">Phone</SortableHead>
            <SortableHead column="status">Status</SortableHead>
            <SortableHead column="state">State</SortableHead>
            <SortableHead column="therapist">Therapist</SortableHead>
            <TableHead className="w-[50px]"></TableHead>
            <SortableHead column="last_contact_at">Last Contact</SortableHead>
            <SortableHead column="updated_at">Last Updated</SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedClients.map((client) => (
            <TableRow
              key={client.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={(e) => handleRowClick(client.id, e)}
            >
              {selectionEnabled && (
                <TableCell>
                  <Checkbox
                    checked={selectedClientIds.has(client.id)}
                    onCheckedChange={(checked) => {
                      onSelectionChange?.(client.id, checked === true);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${getClientDisplayName(client)}`}
                    data-checkbox
                  />
                </TableCell>
              )}
              <TableCell className="font-medium">
                {getClientDisplayName(client)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {client.email || '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {client.phone || '—'}
              </TableCell>
              <TableCell>
                <StatusBadge status={client.pat_status} size="sm" />
              </TableCell>
              <TableCell>{client.pat_state || '—'}</TableCell>
              <TableCell className="text-muted-foreground">
                {getTherapistDisplayName(client.primary_staff)}
              </TableCell>
              <TableCell>
                {onQuickView && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickView(client);
                    }}
                    title="Quick view"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {client.last_contact_at ? (
                  <span title={`${client.last_contact_channel ?? ''} ${client.last_contact_direction ?? ''}`.trim()}>
                    {formatDistanceToNow(new Date(client.last_contact_at), { addSuffix: true })}
                  </span>
                ) : '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDistanceToNow(new Date(client.updated_at), { addSuffix: true })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
