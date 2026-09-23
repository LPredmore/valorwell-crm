import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { replaceSocialLibraryPhoto, type SocialMediaLibraryItem } from '@/lib/crm/social-media';
import { prepareCoverFile, type PreparedCover } from '@/lib/crm/thumbnail-file';
import { SocialMediaThumbnail } from './SocialMediaThumbnail';

export function SocialMediaPhotoEditor({
  item,
  onClose,
}: {
  item: SocialMediaLibraryItem;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [prepared, setPrepared] = useState<PreparedCover | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processingFile, setProcessingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [applyToYoutube, setApplyToYoutube] = useState(Boolean(item.publishedPublication?.externalVideoId));

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const mutation = useMutation({
    mutationFn: () => replaceSocialLibraryPhoto({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      file: prepared!.file,
      updateYouTube: applyToYoutube,
    }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['social-media', 'library'] });
      queryClient.invalidateQueries({ queryKey: ['social-media', 'thumbnail', item.sourceType, item.sourceId] });
      queryClient.invalidateQueries({ queryKey: ['social-media', 'publications'] });
      queryClient.invalidateQueries({ queryKey: ['social-media', 'publication'] });
      toast({
        title: 'Video photo updated',
        description: result.warnings?.length ? result.warnings.join(' ') : result.message,
      });
      onClose();
    },
  });

  async function selectFile(file: File | undefined) {
    if (!file) return;
    setProcessingFile(true);
    setFileError(null);
    setPrepared(null);
    setPreviewUrl(null);
    try {
      const next = await prepareCoverFile(file);
      setPrepared(next);
      setPreviewUrl(URL.createObjectURL(next.file));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Unable to prepare this image.');
    } finally {
      setProcessingFile(false);
    }
  }

  const published = Boolean(item.publishedPublication?.externalVideoId);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.thumbnailFileId ? 'Replace video photo' : 'Add video photo'}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {item.title ?? [item.guestName, item.organizationName].filter(Boolean).join(' — ') || 'Full episode'}
        </p>
        <div className="space-y-2">
          <p className="text-sm font-medium">Current library photo</p>
          <div className="max-w-sm mx-auto w-full rounded border overflow-hidden">
            <SocialMediaThumbnail item={item} />
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">New photo — preview of the exact image to upload</p>
          <div className="rounded border bg-muted flex justify-center items-center min-h-44 overflow-hidden">
            {previewUrl ? (
              <img src={previewUrl} alt="The new image that will be saved for this video" className="max-h-80 w-auto max-w-full object-contain" />
            ) : (
              <p className="text-sm text-muted-foreground text-center p-5">
                Select a PNG, JPG or WebP image from your computer.
              </p>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Choose a new video photo"
            onChange={(event) => {
              void selectFile(event.target.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
          <Button variant="outline" disabled={processingFile || mutation.isPending}
            onClick={() => inputRef.current?.click()}>
            {processingFile ? 'Preparing image…' : 'Choose photo'}
          </Button>
          {prepared && (
            <p className="text-xs text-muted-foreground">
              {prepared.width} × {prepared.height} pixels · {(prepared.file.size / 1024 / 1024).toFixed(2)} MB
            </p>
          )}
          {prepared && item.contentFormat === 'short' && Math.abs(prepared.width / prepared.height - 9 / 16) > 0.04 && (
            <p className="text-xs text-amber-700">
              This image is not 9:16. We will preserve the selected image without cropping it.
              For a Shorts cover, a 9:16 image is recommended.
            </p>
          )}
          {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error instanceof Error ? mutation.error.message : 'Could not update this video photo.'}
            </p>
          )}
        </div>
        {published && (
          <label className="flex items-start gap-2 text-sm rounded border p-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={applyToYoutube}
              disabled={mutation.isPending}
              onChange={(event) => setApplyToYoutube(event.target.checked)}
            />
            <span>
              <strong>Also update the published YouTube thumbnail</strong>
              <span className="block text-xs text-muted-foreground mt-1">
                Queues a thumbnail-only update for this published video. It will not re-upload
                or duplicate the video. YouTube may display a different frame in the Shorts feed.
              </span>
            </span>
          </label>
        )}
        <p className="text-xs text-muted-foreground">
          The previous cover is retained in Drive. Future publications use your newly selected photo.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!prepared || processingFile || mutation.isPending}>
            {mutation.isPending ? 'Saving photo…' : 'Save photo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
