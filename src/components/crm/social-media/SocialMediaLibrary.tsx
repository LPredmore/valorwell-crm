import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSocialMediaLibrary, primaryPublication, type LibraryFilters, type SocialMediaLibraryItem } from '@/lib/crm/social-media';
import { SocialMediaFilters } from './SocialMediaFilters';
import { SocialMediaLibraryCard } from './SocialMediaLibraryCard';
import { SocialMediaPhotoEditor } from './SocialMediaPhotoEditor';
import { SocialPublicationEditor } from './SocialPublicationEditor';
import { SocialMediaErrorState } from './SocialMediaErrorState';
import { Skeleton } from '@/components/ui/skeleton';

export function SocialMediaLibrary() {
  const [filters, setFilters] = useState<LibraryFilters>({});
  const [selected, setSelected] = useState<SocialMediaLibraryItem | null>(null);
  const [photoItem, setPhotoItem] = useState<SocialMediaLibraryItem | null>(null);

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

  return (
    <div className="space-y-4 pt-4">
      <SocialMediaFilters filters={filters} onChange={setFilters} guests={options.guests} organizations={options.organizations} />

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
        {data?.map((item) => (
          <SocialMediaLibraryCard key={`${item.sourceType}-${item.sourceId}`} item={item} onSelect={() => setSelected(item)} onChangePhoto={() => setPhotoItem(item)} />
        ))}
      </div>

      {photoItem && (
        <SocialMediaPhotoEditor key={`${photoItem.sourceType}-${photoItem.sourceId}`} item={photoItem} onClose={() => setPhotoItem(null)} />
      )}

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
