import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { dataProvider } from '@/services/dataProvider';
import type { RelationshipContactRecord } from '@/domain/relationships/records';

export function ContactProfileEditor({ contact }: { contact: RelationshipContactRecord }) {
  const { capabilities } = useCrmAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(() => fromContact(contact));

  useEffect(() => { setFields(fromContact(contact)); setOpen(false); }, [contact]);
  const save = useMutation({
    mutationFn: () => dataProvider.relationships.updateContact(contact.id, {
      firstName: fields.firstName, lastName: fields.lastName, preferredName: fields.preferredName,
      email: fields.email, phone: fields.phone, state: fields.state, doNotContact: fields.doNotContact,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['relationship-contact', contact.id] });
      await queryClient.invalidateQueries({ queryKey: ['relationship-contacts'] });
      setOpen(false);
    },
  });
  if (!capabilities.mutate) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact profile</CardTitle>
        <CardDescription>Edit existing non-clinical fields. Source links, organization affiliations and outreach history stay intact.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!open && <Button variant="outline" onClick={() => setOpen(true)}>Edit contact</Button>}
        {open && <>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['firstName', 'First name'], ['lastName', 'Last name'],
              ['preferredName', 'Preferred name'], ['email', 'Email'],
              ['phone', 'Phone'], ['state', 'State'],
            ] as const).map(([key, label]) => (
              <div className="space-y-1" key={key}>
                <Label htmlFor={`contact-edit-${key}`}>{label}</Label>
                <Input id={`contact-edit-${key}`} value={fields[key]}
                  onChange={(event) => setFields((old) => ({ ...old, [key]: event.target.value }))}
                  disabled={save.isPending} />
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={fields.doNotContact} onCheckedChange={(value) =>
              setFields((old) => ({ ...old, doNotContact: value === true }))} />
            Do not contact
          </label>
          {save.isError && <p role="alert" className="text-sm text-destructive">
            {save.error instanceof Error ? save.error.message : 'Could not save contact'}</p>}
          <div className="flex gap-2">
            <Button disabled={save.isPending || !fields.email.trim()} onClick={() => save.mutate()}>Save changes</Button>
            <Button variant="outline" disabled={save.isPending} onClick={() => { setFields(fromContact(contact)); setOpen(false); }}>Cancel</Button>
          </div>
        </>}
      </CardContent>
    </Card>
  );
}
function fromContact(contact: RelationshipContactRecord) {
  return {
    firstName: contact.firstName ?? '', lastName: contact.lastName ?? '',
    preferredName: contact.preferredName ?? '', email: contact.email ?? '',
    phone: contact.phone ?? '', state: contact.state ?? '', doNotContact: contact.doNotContact,
  };
}
