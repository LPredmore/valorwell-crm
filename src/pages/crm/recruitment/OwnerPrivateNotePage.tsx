import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import NotFound from '@/pages/NotFound';
import {
  ownerPrivateNotesEnabled, getOwnerPrivateNote, hasOwnerPrivateNoteAccess, saveOwnerPrivateNote, deleteOwnerPrivateNote, ownerNoteQueryKey,
} from '@/repositories/supabase/ownerPrivateNotes';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Owner-only note on a website clinician interest submission. Renders the
 * standard Not Found page whenever the flag is off or the server returns
 * nothing, so non-owners learn nothing about existence. */
export default function OwnerPrivateNotePage() {
  const { submissionId = '' } = useParams();
  const { currentTenantId, userId, isAuthenticated } = useCrmAuth();
  const enabled = ownerPrivateNotesEnabled() && isAuthenticated && !!currentTenantId && UUID.test(submissionId);
  const qc = useQueryClient();
  const key = ownerNoteQueryKey(userId, currentTenantId ?? '', submissionId);
  const query = useQuery({
    queryKey: key, enabled, gcTime: 0, staleTime: 0, retry: false,
    queryFn: async () => {
      if (!(await hasOwnerPrivateNoteAccess(currentTenantId!, submissionId))) return { access: false as const, note: null };
      return { access: true as const, note: await getOwnerPrivateNote(currentTenantId!, submissionId) };
    },
  });
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: string) => saveOwnerPrivateNote(currentTenantId!, submissionId, body, query.data?.note?.version ?? null),
    onSuccess: () => { setDraft(null); qc.invalidateQueries({ queryKey: key }); },
  });
  const remove = useMutation({
    mutationFn: () => deleteOwnerPrivateNote(currentTenantId!, submissionId, query.data!.note!.version),
    onSuccess: () => qc.removeQueries({ queryKey: key }),
  });

  if (!enabled) return <NotFound />;
  if (query.isLoading) return null;
  if (!query.data?.access) return <NotFound />;
  const note = query.data.note;
  const value = draft ?? note?.body ?? '';
  return (
    <Card className="m-6 max-w-3xl">
      <CardHeader><CardTitle>Owner private note</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Textarea value={value} onChange={e => setDraft(e.target.value)} rows={10} maxLength={20000} />
        {(save.isError || remove.isError) && <p className="text-sm text-destructive">The change could not be saved. Refresh and try again.</p>}
        <div className="flex gap-2">
          <Button disabled={!value.trim() || save.isPending} onClick={() => save.mutate(value)}>Save</Button>
          {note && <Button variant="outline" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
