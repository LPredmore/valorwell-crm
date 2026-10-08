import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { dataProvider } from '@/services/dataProvider';

export function OrganizationAffiliationEditor({ organizationId }: { organizationId: string }) {
  const { capabilities, currentTenantId } = useCrmAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [primary, setPrimary] = useState(false);
  const candidates = useQuery({
    queryKey: ['affiliation-search', currentTenantId, search],
    queryFn: () => dataProvider.relationships.listContacts({ search, page: 1, pageSize: 25 }),
    enabled: capabilities.mutate && !!currentTenantId && search.trim().length >= 2,
    retry: false,
  });
  const queryKey = ['relationship-organization-contacts', organizationId];
  const create = useMutation({
    mutationFn: () => dataProvider.relationships.createAffiliation({
      contactId: selected, organizationId, roleTitle: roleTitle.trim() || undefined, isPrimary: primary,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ['relationship-contact', selected] }),
        queryClient.invalidateQueries({ queryKey: ['relationship-contacts'] }),
        queryClient.invalidateQueries({ queryKey: ['relationship-organization', organizationId] }),
      ]);
      setSelected(''); setSearch(''); setRoleTitle(''); setPrimary(false);
    },
  });

  if (!capabilities.mutate) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Link an existing contact</CardTitle>
        <CardDescription>
          Search this tenant's contact directory and record an organization affiliation with role.
          The contact and organization retain their original records and primary keys.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="affiliation-contact-search">Find contact</Label>
          <Input id="affiliation-contact-search" value={search} onChange={(e) => {
            setSearch(e.target.value); setSelected('');
          }} placeholder="Search name or email" />
          {candidates.isLoading && <p className="text-xs text-muted-foreground">Searching…</p>}
          {candidates.isError && <p role="alert" className="text-xs text-destructive">Contact search failed.</p>}
          {candidates.data && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded border p-2" aria-label="Matching contacts">
              {candidates.data.items.length === 0 && <p className="text-xs text-muted-foreground">No matching contact. <Link className="underline" to="/crm/business-development/contacts">View directory</Link></p>}
              {candidates.data.items.map((contact) => (
                <label key={contact.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                  <input type="radio" name="affiliation-contact" checked={selected === contact.id}
                    onChange={() => setSelected(contact.id)} />
                  <span>{contact.displayName} <span className="text-xs text-muted-foreground">{contact.email}</span></span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="affiliation-role-title">Role or title at organization</Label>
          <Input id="affiliation-role-title" value={roleTitle} maxLength={200}
            onChange={(e) => setRoleTitle(e.target.value)} placeholder="Founder, Program Director, Volunteer…" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={primary} onCheckedChange={(checked) => setPrimary(checked === true)} />
          Primary organization for this contact
        </label>
        {create.isError && <p role="alert" className="text-sm text-destructive">
          {create.error instanceof Error ? create.error.message : 'Could not link contact.'}
        </p>}
        {create.isSuccess && <p role="status" className="text-sm">Contact affiliation saved.</p>}
        <Button disabled={!selected || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Linking…' : 'Link contact to organization'}
        </Button>
      </CardContent>
    </Card>
  );
}
