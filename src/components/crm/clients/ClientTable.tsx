import { Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from './StatusBadge';
import { getClientDisplayName, getTherapistDisplayName } from '@/lib/crm/status-config';
import type { CrmClient } from '@/lib/crm/types';
import { formatDistanceToNow } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ClientTableProps {
  clients: CrmClient[];
  isLoading: boolean;
  onClientClick: (clientId: string) => void;
}

export function ClientTable({ clients, isLoading, onClientClick }: ClientTableProps) {
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

  return (
    <ScrollArea className="h-full">
      <Table>
        <TableHeader>
          <TableRow>
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
              onClick={() => onClientClick(client.id)}
            >
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
