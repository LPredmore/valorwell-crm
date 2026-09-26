import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSocialMediaLibrary, primaryPublication, type LibraryFilters, type SocialMediaLibraryItem } from '@/lib/crm/social-media';
import { SocialMediaFilters } from './SocialMediaFilters';
import { SocialMediaLibraryCard } from './SocialMediaLibraryCard';
import { SocialMediaPhotoEditor } from './SocialMediaPhotoEditor';
import { SocialPublicationEditor } from './SocialPublicationEditor';
import { SocialMediaErrorState } from './SocialMediaErrorState';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { CrmMutationGate } from '@/components/crm/auth/CrmMutationGate';
import { BulkScheduleDialog } from './BulkScheduleDialog';

function bulkKey(item: SocialMediaLibraryItem): string {
  return `${item.sourceType}:${item.sourceId}`;
}

export function bulkScheduleEligibilityReason(item: SocialMediaLibraryItem): string | null {
  if (!item.readiness.ready) return item.readiness.reasons[0] ?? 'This video is not publish-ready.';
  if (item.activePublication) return 'This video already has an active publication.';
  if (item.failedPublication) return 'This video has a failed publication. Use Retry instead.';
  if (item.publishedPublication) return 'This video has already been published.';
  if (!item.title?.trim()) return 'Add a title before bulk scheduling this video.';
  if (item.contentFormat === 'short' && !item.thumbnailFileId) return 'Add a thumbnail before scheduling this Short.';
  return null;
}

export function SocialMediaLibrary() {
  const [filters, setFilters] = useState<LibraryFilters>({});
  const [selected, setSelected] = useState<SocialMediaLibraryItem | null>(null);
  const [photoItem, setPhotoItem] = useState<SocialMediaLibraryItem | null>(null);
  const [bulkKeys, setBulkKeys] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['social-media', 'library', filters],
    queryFn: () => fetchSocialMediaLibrary(filters),
    retry: 1,
  });
  // Guest/organization options come from the unfiltered library (shared cache entry with
  // the initial, unfiltered load) so choosing one never hides the others.
  const { data: allItems } = useQuery({
    queryKey: ['social-media', 'library', {}],
    queryFn: () => fetchSocialMediaLibrary({}),
    retry: 1,
  });
  const options = useMemo(() => {
    const unique = (values: Array<string | null>) =>
      [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
    return {
      guests: unique((allItems ?? []).map((item) => item.guestName)),
      organizations: unique((allItems ?? []).map((item) => item.organizationName)),
    };
  }, [allItems]);
  const selectedPublication = selected ? primaryPublication(selected) : null;
  const itemByKey = useMemo(() => new Map((allItems ?? data ?? []).map((item) => [bulkKey(item), item])), [allItems, data]);
  const bulkItems = useMemo(
    () => bulkKeys.map((key) => itemByKey.get(key)).filter((item): item is SocialMediaLibraryItem => Boolean(item)),
    [bulkKeys, itemByKey],
  );
  const toggleBulk = (item: SocialMediaLibraryItem, checked: boolean) => {
    const key = bulkKey(item);
    setBulkKeys((current) => checked ? (current.includes(key) ? current : [...current, key]) : current.filter((value) => value !== key));
  };

  return (
    <div className="space-y-4 pt-4">
      <SocialMediaFilters filters={filters} onChange={setFilters} guests={options.guests} organizations={options.organizations} />

      <CrmMutationGate>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Select publish-ready, unscheduled videos with the checkboxes to schedule them as a batch.
          </p>
          {bulkItems.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{bulkItems.length} selected</span>
              <Button size="sm" onClick={() => setBulkOpen(true)}>Bulk schedule</Button>
              <Button size="sm" variant="ghost" onClick={() => setBulkKeys([])}>Clear</Button>
            </div>
          )}
        </div>
      </CrmMutationGate>

      {isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-56" />)}
        </div>
      )}
      {error && <SocialMediaErrorState error={error} />}
      {!isLoading && !error && data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No content matches the current filters.</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {data?.map((item) => {
          const key = bulkKey(item);
          const reason = bulkScheduleEligibilityReason(item);
          const checked = bulkKeys.includes(key);
          return (
            <div key={key} className={`relative rounded-lg ${checked ? 'ring-2 ring-primary ring-offset-2' : ''}`}>
              <CrmMutationGate>
                <div className="absolute right-2 top-2 z-10 rounded bg-background/90 p-1 shadow-sm" title={reason ?? 'Select for bulk scheduling'}>
                  <Checkbox
                    checked={checked}
                    disabled={Boolean(reason)}
                    aria-label={reason ? `Cannot select ${item.title ?? 'video'}: ${reason}` : `Select ${item.title ?? 'video'} for bulk scheduling`}
                    onCheckedChange={(value) => toggleBulk(item, value === true)}
                  />
                </div>
              </CrmMutationGate>
              <SocialMediaLibraryCard item={item} onSelect={() => setSelected(item)} onChangePhoto={() => setPhotoItem(item)} />
            </div>
          );
        })}
      </div>

      {photoItem && (
        <SocialMediaPhotoEditor key={`${photoItem.sourceType}-${photoItem.sourceId}`} item={photoItem} onClose={() => setPhotoItem(null)} />
      )}

      <BulkScheduleDialog
        open={bulkOpen && bulkItems.length > 0}
        onOpenChange={setBulkOpen}
        items={bulkItems}
        onScheduled={() => setBulkKeys([])}
      />

      {selected && (
        <SocialPublicationEditor
          open={Boolean(selected)}
          onOpenChange={(open) => { if (!open) setSelected(null); }}
          publicationId={selectedPublication?.id ?? null}
          createFrom={
            selectedPublication
              ? undefined
              : { sourceType: selected.sourceType, clipId: selected.clipId ?? undefined, projectId: selected.projectId }
          }
        />
      )}
    </div>
  );
}
