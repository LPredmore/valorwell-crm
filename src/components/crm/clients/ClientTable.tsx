import { Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge } from './StatusBadge';
import { getClientDisplayName, getTherapistDisplayName } from '@/lib/crm/status-config';
import type { CrmClient } from '@/lib/crm/types';
import { formatDistanceToNow } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ClientTableProps {
  clients: CrmClient[];
  isLoading: boolean;
  onClientClick: (clientId: string) => void;
  selectedClientIds?: Set<string>;
  onSelectionChange?: (clientId: string, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
}

export function ClientTable({
  clients,
  isLoading,
  onClientClick,
  selectedClientIds = new Set(),
  onSelectionChange,
  onSelectAll,
}: ClientTableProps) {
  const selectionEnabled = !!onSelectionChange && !!onSelectAll;
  const allSelected = clients.length > 0 && clients.every(c => selectedClientIds.has(c.id));
  const someSelected = clients.some(c => selectedClientIds.has(c.id)) && !allSelected;

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
    // Don't navigate if clicking on checkbox
    if ((e.target as HTMLElement).closest('[data-checkbox]')) {
      return;
    }
    onClientClick(clientId);
  };

  const handleCheckboxClick = (clientId: string, checked: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectionChange?.(clientId, checked);
  };

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
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Therapist</TableHead>
            <TableHead>Last Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => (
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
              <TableCell>
                <StatusBadge status={client.pat_status} size="sm" />
              </TableCell>
              <TableCell>{client.pat_state || '—'}</TableCell>
              <TableCell className="text-muted-foreground">
                {getTherapistDisplayName(client.primary_staff)}
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
