import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface NoteFormProps {
  clientId: string;
}

export function NoteForm({ clientId }: NoteFormProps) {
  const [content, setContent] = useState('');
  const { tenantId, userId } = useCrmAuth();
  const queryClient = useQueryClient();

  const createNote = useMutation({
    mutationFn: async (noteContent: string) => {
      // Create the note
      const { error: noteError } = await supabase
        .from('crm_notes')
        .insert({
          tenant_id: tenantId,
          client_id: clientId,
          created_by_profile_id: userId,
          note_content: noteContent,
          note_type: 'internal',
        });

      if (noteError) throw noteError;

      // Create activity event
      const { error: eventError } = await supabase
        .from('crm_activity_events')
        .insert({
          tenant_id: tenantId,
          client_id: clientId,
          event_type: 'note_added',
          new_value: noteContent.substring(0, 100),
          created_by_profile_id: userId,
          metadata: {},
        });

      if (eventError) throw eventError;
    },
    onSuccess: () => {
      setContent('');
      queryClient.invalidateQueries({ queryKey: ['crm-notes', clientId] });
      queryClient.invalidateQueries({ queryKey: ['crm-activity-events', clientId] });
      toast.success('Note added');
    },
    onError: (error) => {
      console.error('Error creating note:', error);
      toast.error('Failed to add note');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    createNote.mutate(content.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Textarea
        placeholder="Add an internal note..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!content.trim() || createNote.isPending}
        >
          {createNote.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Add Note
        </Button>
      </div>
    </form>
  );
}
