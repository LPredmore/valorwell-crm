import { Label } from '@/components/ui/label';
import { useRelationshipTeamOwners } from '@/hooks/relationships/useRelationshipTeamOwners';

export function RelationshipOwnerFilter({ id, value, onChange, emptyLabel = 'All owners', disabled = false }: {
  id: string; value: string; onChange: (value: string) => void; emptyLabel?: string; disabled?: boolean;
}) {
  const owners = useRelationshipTeamOwners();
  return <div className="space-y-2">
    <Label htmlFor={id}>Assigned owner</Label>
    <select id={id} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      value={value} disabled={disabled} onChange={event => onChange(event.target.value)} aria-describedby={id + '-status'}>
      <option value="">{emptyLabel}</option>
      {value && !owners.data?.some(owner => owner.id === value) && <option value={value}>Selected owner</option>}
      {owners.data?.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
    </select>
    <p id={id + '-status'} className="text-xs text-muted-foreground" role="status">
      {owners.isError ? 'Owner names could not be loaded.' : owners.isLoading ? 'Loading owners…' : ''}
    </p>
  </div>;
}

export function RelationshipOwnerName({ ownerId }: { ownerId?: string | null }) {
  const owners = useRelationshipTeamOwners();
  return <span>{!ownerId ? 'Unassigned' : owners.data?.find(owner => owner.id === ownerId)?.name
    ?? (owners.isLoading ? 'Loading owner…' : 'Assigned team member')}</span>;
}
