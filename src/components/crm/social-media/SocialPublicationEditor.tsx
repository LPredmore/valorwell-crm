import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { CrmMutationGate } from '@/components/crm/auth/CrmMutationGate';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import {
  approveSocialPublication, cancelSocialPublication, createSocialPublication, fetchSocialPublication,
  markThumbnailManualDone, publicationPollInterval, queueSocialPublication, rescheduleSocialPublication,
  retrySocialPublication, setPublicationPlaylists, updateSocialPublication,
  validateSocialPublication, STATUS_LABELS, type DeliveryMode, type PrivacyStatus, type SourceType,
} from '@/lib/crm/social-media';
import { SocialPublicationSourceSummary } from './SocialPublicationSourceSummary';
import { SocialPublicationReschedule } from './SocialPublicationReschedule';
import { SocialPublicationYouTubeState } from './SocialPublicationYouTubeState';
import { SocialPublicationMetadataForm } from './SocialPublicationMetadataForm';
import { SocialPublicationPlaylistPicker } from './SocialPublicationPlaylistPicker';
import { SocialPublicationScheduleForm } from './SocialPublicationScheduleForm';
import { SocialPublicationPreflight } from './SocialPublicationPreflight';
import { SocialPublicationHistory } from './SocialPublicationHistory';
import { SocialMediaErrorState } from './SocialMediaErrorState';

const LOCKED_STATUSES = new Set(['upload_queued', 'uploading', 'uploaded', 'scheduled', 'published', 'cancelled']);
/** Nothing exists on YouTube yet, so cancelling in the CRM is truthful. */
const CANCELLABLE_STATUSES = new Set(['draft', 'ready', 'approved', 'upload_queued']);

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
  const { capabilities } = useCrmAuth();
  const canMutate = Boolean(capabilities?.mutate);
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
    // Opening the editor for an unpublished source creates a draft -- only for operators.
    if (canMutate && open && !id && createFrom && !createMutation.isPending && !createMutation.isError) createMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, createFrom, canMutate]);

  const { data: publication, isLoading, error: publicationError } = useQuery({
    queryKey: ['social-media', 'publication', id],
    queryFn: () => fetchSocialPublication(id as string),
    enabled: Boolean(id),
    retry: 1,
    refetchInterval: (query) => (query.state.error ? false : publicationPollInterval(query.state.data ? [query.state.data] : [])),
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
  const rescheduleMutation = useMutation({
    mutationFn: (scheduledFor: string) => rescheduleSocialPublication(id as string, scheduledFor),
    onSuccess: () => { invalidate(); toast({ title: 'Rescheduled on YouTube' }); },
    onError: (error: Error) => toast({ title: 'Could not reschedule', description: error.message, variant: 'destructive' }),
  });
  const thumbnailDoneMutation = useMutation({
    mutationFn: () => markThumbnailManualDone(id as string),
    onSuccess: () => { invalidate(); toast({ title: 'Thumbnail marked done' }); },
    onError: (error: Error) => toast({ title: 'Could not mark thumbnail done', description: error.message, variant: 'destructive' }),
  });

  const merged = publication ? { ...publication, ...pendingChanges } as typeof publication : publication;
  const onYouTube = Boolean(publication?.externalVideoId);
  // A failed publication stays editable until it has reached YouTube; saving sends it back to Ready.
  const locked = publication ? LOCKED_STATUSES.has(publication.status) || (publication.status === 'failed' && onYouTube) : false;
  const readOnly = locked || !canMutate;

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
        {!id && createFrom && !canMutate && (
          <p className="text-sm text-muted-foreground">This video has not been prepared for publishing yet.</p>
        )}
        {createMutation.error && <SocialMediaErrorState error={createMutation.error} />}
        {publicationError && <SocialMediaErrorState error={publicationError} />}

        {merged && (
          <div className="space-y-4">
            <SocialPublicationSourceSummary publication={merged} />
            {locked && (
              <p className="text-xs text-amber-600">
                Metadata is locked while status is "{STATUS_LABELS[publication!.status]}"
                {onYouTube ? ' — it has been sent to YouTube.' : ' — the worker is using this snapshot.'}
              </p>
            )}
            {!canMutate && <p className="text-xs text-muted-foreground">Read-only access: you can review this publication but not change it.</p>}
            <SocialPublicationYouTubeState publication={merged} />
            <SocialPublicationMetadataForm
              publication={merged}
              disabled={readOnly}
              onChange={(changes) => setPendingChanges((prev) => ({ ...prev, ...changes }))}
            />
            <SocialPublicationScheduleForm
              deliveryMode={merged.deliveryMode}
              privacyStatus={merged.desiredPrivacyStatus}
              scheduledFor={merged.scheduledFor}
              disabled={readOnly}
              onChange={(next) => setPendingChanges((prev) => ({
                ...prev,
                deliveryMode: next.deliveryMode as DeliveryMode,
                desiredPrivacyStatus: next.desiredPrivacyStatus as PrivacyStatus,
                scheduledFor: next.scheduledFor,
              }))}
            />
            {publication!.status === 'scheduled' && onYouTube && (
              <CrmMutationGate>
                <SocialPublicationReschedule
                  key={publication!.scheduledFor ?? 'none'}
                  publication={publication!}
                  pending={rescheduleMutation.isPending}
                  onReschedule={(scheduledFor) => rescheduleMutation.mutate(scheduledFor)}
                />
              </CrmMutationGate>
            )}
            <SocialPublicationPlaylistPicker
              publication={publication!}
              disabled={readOnly}
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

            {merged.contentFormat === 'short' && merged.thumbnailUrl && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm dark:border-amber-800 dark:bg-amber-950/30">
                <h4 className="font-semibold">Short thumbnail</h4>
                {merged.thumbnailDelivery?.apiStatus === 'manual_required' ? (
                  <p className="text-muted-foreground">
                    <strong>Thumbnail needed.</strong> This Short is already uploaded to YouTube as Private and its public publish time is scheduled there. Open the saved cover and the YouTube Studio link below, upload the thumbnail manually, save it in Studio, then mark the step done here.
                  </p>
                ) : merged.thumbnailDelivery?.apiStatus === 'manual_confirmed' ? (
                  <p className="text-muted-foreground">
                    The manual thumbnail step is marked complete. YouTube will publish this Short automatically at the scheduled time.
                  </p>
                ) : merged.thumbnailDelivery?.apiStatus === 'failed' ? (
                  <p className="text-muted-foreground">
                    YouTube did not accept the automated thumbnail upload: {merged.thumbnailDelivery.error ?? 'Unknown error'}.
                    If your channel supports custom Shorts thumbnails, open the saved cover image
                    and add it manually in desktop YouTube Studio.
                  </p>
                ) : merged.thumbnailDelivery?.apiStatus === 'already_present_not_overwritten' ? (
                  <p className="text-muted-foreground">
                    YouTube already reported a custom thumbnail before the CRM's delayed
                    submission. Your existing thumbnail was preserved, so an image selected
                    manually in Studio will not be overwritten.
                  </p>
                ) : merged.thumbnailDelivery?.apiStatus === 'waiting_processing' ? (
                  <p className="text-muted-foreground">
                    YouTube is still processing this Short. The CRM is waiting to submit the
                    thumbnail until processing finishes. A successful API submission may
                    still require confirmation in YouTube Studio for Shorts.
                  </p>
                ) : merged.thumbnailDelivery?.apiStatus === 'not_applied' ? (
                  <p className="text-muted-foreground">
                    YouTube accepted the uploaded image, but its owner-only video status still reports
                    no custom thumbnail. Your Short is already published correctly; uploading the
                    same image again through the API is unlikely to solve channel eligibility.
                    Check YouTube Studio for custom Shorts thumbnail access. If that option is unavailable,
                    you can choose a frame from the Short using the YouTube mobile app.
                  </p>
                ) : merged.thumbnailDelivery?.apiStatus === 'confirmed_by_youtube' ? (
                  <p className="text-muted-foreground">
                    YouTube reports a custom-thumbnail flag for this video, but that flag
                    does not prove the cover you selected appears in Shorts. Compare the
                    published thumbnail with your Library photo in YouTube Studio.
                  </p>
                ) : merged.thumbnailDelivery?.apiStatus === 'accepted_unverified' ? (
                  <p className="text-muted-foreground">
                    The CRM automatically submitted your saved cover to the YouTube thumbnail API.
                    YouTube accepted the request, but its appearance on your Short has not been verified.
                    Check the Short in Studio; if YouTube does not display it, use desktop Studio
                    to upload the saved cover when your channel is eligible.
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    The CRM will automatically attempt to submit this cover after uploading the Short.
                    YouTube may restrict or ignore API-submitted Shorts thumbnails depending on channel
                    eligibility. If it remains missing, use desktop Studio to upload the saved cover.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={merged.thumbnailUrl} target="_blank" rel="noopener noreferrer">
                      Open cover image in Drive
                    </a>
                  </Button>
                  {merged.externalVideoId && (
                    <Button size="sm" variant="outline" asChild>
                      <a
                        href={`https://studio.youtube.com/video/${encodeURIComponent(merged.externalVideoId)}/edit`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Edit Short in YouTube Studio
                      </a>
                    </Button>
                  )}
                  {merged.thumbnailDelivery?.apiStatus === 'manual_required' && (
                    <CrmMutationGate>
                      <Button
                        size="sm"
                        onClick={() => thumbnailDoneMutation.mutate()}
                        disabled={thumbnailDoneMutation.isPending}
                      >
                        {thumbnailDoneMutation.isPending ? 'Saving…' : 'Mark thumbnail done'}
                      </Button>
                    </CrmMutationGate>
                  )}
                </div>
              </div>
            )}

            <div>
              <h4 className="text-sm font-medium mb-2">History</h4>
              <SocialPublicationHistory publicationId={publication!.id} />
            </div>
          </div>
        )}

        {publication && onYouTube && ['uploading', 'uploaded', 'scheduled', 'failed'].includes(publication.status) && canMutate && (
          <p className="text-xs text-muted-foreground">
            This video already exists on YouTube, so it cannot be cancelled from the CRM. To stop it, change its
            visibility or delete it in YouTube Studio.
          </p>
        )}
        <DialogFooter className="flex-wrap gap-2">
          <CrmMutationGate>
            {publication?.status === 'failed' && (
              <Button variant="outline" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>Retry</Button>
            )}
            {publication && CANCELLABLE_STATUSES.has(publication.status) && !onYouTube && (
              <Button variant="outline" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>Cancel</Button>
            )}
            {publication && ['draft', 'ready'].includes(publication.status) && (
              <Button variant="outline" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending || Boolean(validation && !validation.ok)}>
                Approve
              </Button>
            )}
            {publication?.status === 'approved' && (
              <Button onClick={() => queueMutation.mutate()} disabled={queueMutation.isPending}>
                {publication.deliveryMode === 'scheduled' ? 'Upload & Schedule on YouTube' : 'Publish'}
              </Button>
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
