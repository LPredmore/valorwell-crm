import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';
import { CrmMutationGate } from '@/components/crm/auth/CrmMutationGate';
import { backfillShortThumbnails, fetchShortsThumbnailFeature, type SocialPublication } from '@/lib/crm/social-media';

/** Eligible only for an older scheduled/published Short stuck on the manual Studio step,
 * with a saved cover and an existing YouTube video. The server re-checks everything. */
export function isBackfillEligible(p: Pick<SocialPublication, 'contentFormat' | 'status' | 'thumbnailStatus' | 'thumbnailFileId' | 'externalVideoId'>): boolean {
  return p.contentFormat === 'short'
    && (p.status === 'scheduled' || p.status === 'published')
    && p.thumbnailStatus === 'manual_required'
    && !!p.thumbnailFileId && !!p.externalVideoId;
}

export function ShortThumbnailBackfillButton({ publication }: { publication: SocialPublication }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const eligible = isBackfillEligible(publication);
  // Read-only; never triggers a write.
  const { data: feature } = useQuery({
    queryKey: ['social-media', 'shorts-thumbnail-feature'], queryFn: fetchShortsThumbnailFeature, enabled: eligible, retry: 1, staleTime: 60_000,
  });
  const backfill = useMutation({
    mutationFn: () => backfillShortThumbnails([publication.id]),
    onSuccess: (result) => {
      const skipped = result.skipped.find((s) => s.id === publication.id);
      if (result.queued.includes(publication.id)) toast({ title: 'Thumbnail queued', description: 'The saved cover will be sent to YouTube shortly.' });
      else toast({ title: 'Not queued', description: skipped?.reason ?? 'This Short is not eligible.', variant: 'destructive' });
      queryClient.invalidateQueries({ queryKey: ['social-media'] });
    },
    onError: (error: Error) => toast({ title: 'Could not queue thumbnail', description: error.message, variant: 'destructive' }),
  });

  if (!eligible || !feature?.automaticUploadsEnabled) return null;
  return (
    <CrmMutationGate>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={backfill.isPending}>
        {backfill.isPending ? 'Queuing…' : 'Try automatic thumbnail'}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply saved thumbnail via API?</AlertDialogTitle>
            <AlertDialogDescription>
              This changes the real YouTube thumbnail on “{publication.title ?? 'this Short'}” using its saved cover. The video is not re-uploaded.
              If YouTube refuses, it stays on the manual Studio step.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => backfill.mutate()}>Apply thumbnail</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmMutationGate>
  );
}
