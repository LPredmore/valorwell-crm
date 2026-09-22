import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { CrmMutationGate } from '@/components/crm/auth/CrmMutationGate';
import {
  approveSocialPublication, cancelSocialPublication, createSocialPublication, fetchSocialPublication,
  queueSocialPublication, retrySocialPublication, setPublicationPlaylists, updateSocialPublication,
  validateSocialPublication, STATUS_LABELS, type DeliveryMode, type PrivacyStatus, type SourceType,
} from '@/lib/crm/social-media';
import { SocialPublicationMetadataForm } from './SocialPublicationMetadataForm';
import { SocialPublicationPlaylistPicker } from './SocialPublicationPlaylistPicker';
import { SocialPublicationScheduleForm } from './SocialPublicationScheduleForm';
import { SocialPublicationPreflight } from './SocialPublicationPreflight';
import { SocialPublicationHistory } from './SocialPublicationHistory';
import { SocialMediaErrorState } from './SocialMediaErrorState';

const POLLING_STATUSES = new Set(['upload_queued', 'uploading', 'uploaded', 'scheduled']);
const LOCKED_STATUSES = new Set(['upload_queued', 'uploading', 'uploaded', 'scheduled', 'published']);

export function SocialPublicationEditor({
  open,
  onOpenChange,
  publicationId,
  createFrom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicationId: string | null;
  createFrom?: { sourceType: SourceType; clipId?: string; projectId?: string };
}) {
  const queryClient = useQueryClient();
  const [id, setId] = useState(publicationId);
  const [pendingChanges, setPendingChanges] = useState<Record<string, unknown>>({});

  useEffect(() => setId(publicationId), [publicationId]);

  const createMutation = useMutation({
    mutationFn: () => createSocialPublication({ sourceType: createFrom!.sourceType, clipId: createFrom!.clipId, projectId: createFrom!.projectId }),
    onSuccess: (publication) => {
      setId(publication.id);
      queryClient.invalidateQueries({ queryKey: ['social-media', 'library'] });
    },
    onError: (error: Error) => toast({ title: 'Could not create publication', description: error.message, variant: 'destructive' }),
  });

  useEffect(() => {
    if (open && !id && createFrom && !createMutation.isPending) createMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, createFrom]);

  const { data: publication, isLoading, error: publicationError } = useQuery({
    queryKey: ['social-media', 'publication', id],
    queryFn: () => fetchSocialPublication(id as string),
    enabled: Boolean(id),
    retry: 1,
    refetchInterval: (query) => (query.state.data && POLLING_STATUSES.has(query.state.data.status) ? 15000 : false),
  });

  const { data: validation, refetch: refetchValidation } = useQuery({
    queryKey: ['social-media', 'validation', id],
    queryFn: () => validateSocialPublication(id as string),
    enabled: Boolean(id),
    retry: 1,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['social-media', 'publication', id] });
    queryClient.invalidateQueries({ queryKey: ['social-media', 'publications'] });
    queryClient.invalidateQueries({ queryKey: ['social-media', 'library'] });
    refetchValidation();
  };

  const saveMutation = useMutation({
    mutationFn: () => updateSocialPublication(id as string, pendingChanges),
    onSuccess: () => { setPendingChanges({}); invalidate(); toast({ title: 'Saved' }); },
    onError: (error: Error) => toast({ title: 'Could not save', description: error.message, variant: 'destructive' }),
  });
  const playlistMutation = useMutation({
    mutationFn: (playlistIds: string[]) => setPublicationPlaylists(id as string, playlistIds),
    onSuccess: invalidate,
    onError: (error: Error) => toast({ title: 'Could not update playlists', description: error.message, variant: 'destructive' }),
  });
  const approveMutation = useMutation({
    mutationFn: () => approveSocialPublication(id as string),
    onSuccess: () => { invalidate(); toast({ title: 'Approved' }); },
    onError: (error: Error) => toast({ title: 'Could not approve', description: error.message, variant: 'destructive' }),
  });
  const queueMutation = useMutation({
    mutationFn: () => queueSocialPublication(id as string),
    onSuccess: () => { invalidate(); toast({ title: 'Queued for publishing' }); },
    onError: (error: Error) => toast({ title: 'Could not queue', description: error.message, variant: 'destructive' }),
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelSocialPublication(id as string),
    onSuccess: () => { invalidate(); toast({ title: 'Cancelled' }); },
    onError: (error: Error) => toast({ title: 'Could not cancel', description: error.message, variant: 'destructive' }),
  });
  const retryMutation = useMutation({
    mutationFn: () => retrySocialPublication(id as string),
    onSuccess: () => { invalidate(); toast({ title: 'Retrying' }); },
    onError: (error: Error) => toast({ title: 'Could not retry', description: error.message, variant: 'destructive' }),
  });

  const merged = publication ? { ...publication, ...pendingChanges } as typeof publication : publication;
  const locked = publication ? LOCKED_STATUSES.has(publication.status) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Publication
            {publication && <Badge variant="outline">{STATUS_LABELS[publication.status]}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {(createMutation.isPending || isLoading) && <p className="text-sm text-muted-foreground">Loading…</p>}
        {createMutation.error && <SocialMediaErrorState error={createMutation.error} />}
        {publicationError && <SocialMediaErrorState error={publicationError} />}

        {merged && (
          <div className="space-y-4">
            {locked && (
              <p className="text-xs text-amber-600">
                Metadata is locked while status is "{STATUS_LABELS[publication!.status]}" — the worker is using this snapshot.
              </p>
            )}
            <SocialPublicationMetadataForm
              publication={merged}
              disabled={locked}
              onChange={(changes) => setPendingChanges((prev) => ({ ...prev, ...changes }))}
            />
            <SocialPublicationScheduleForm
              deliveryMode={merged.deliveryMode}
              privacyStatus={merged.desiredPrivacyStatus}
              scheduledFor={merged.scheduledFor}
              disabled={locked}
              onChange={(next) => setPendingChanges((prev) => ({
                ...prev,
                deliveryMode: next.deliveryMode as DeliveryMode,
                desiredPrivacyStatus: next.desiredPrivacyStatus as PrivacyStatus,
                scheduledFor: next.scheduledFor,
              }))}
            />
            <SocialPublicationPlaylistPicker
              publication={publication!}
              disabled={locked}
              onChange={(ids) => playlistMutation.mutate(ids)}
            />
            <CrmMutationGate>
              {Object.keys(pendingChanges).length > 0 && (
                <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  Save changes
                </Button>
              )}
            </CrmMutationGate>

            <SocialPublicationPreflight validation={validation} />

            <div>
              <h4 className="text-sm font-medium mb-2">History</h4>
              <SocialPublicationHistory publicationId={publication!.id} />
            </div>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <CrmMutationGate>
            {publication?.status === 'failed' && (
              <Button variant="outline" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>Retry</Button>
            )}
            {publication && !['published', 'cancelled', 'failed'].includes(publication.status) && !locked && (
              <Button variant="outline" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>Cancel</Button>
            )}
            {publication && ['draft', 'ready'].includes(publication.status) && (
              <Button variant="outline" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending || Boolean(validation && !validation.ok)}>
                Approve
              </Button>
            )}
            {publication?.status === 'approved' && (
              <Button onClick={() => queueMutation.mutate()} disabled={queueMutation.isPending}>Publish</Button>
            )}
          </CrmMutationGate>
          {publication?.externalUrl && (
            <Button variant="secondary" asChild>
              <a href={publication.externalUrl} target="_blank" rel="noreferrer">Open on YouTube</a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
