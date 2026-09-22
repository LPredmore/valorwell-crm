import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSocialMediaLibrary, type LibraryFilters, type SocialMediaLibraryItem } from '@/lib/crm/social-media';
import { SocialMediaFilters } from './SocialMediaFilters';
import { SocialMediaLibraryCard } from './SocialMediaLibraryCard';
import { SocialPublicationEditor } from './SocialPublicationEditor';
import { SocialMediaErrorState } from './SocialMediaErrorState';
import { Skeleton } from '@/components/ui/skeleton';

export function SocialMediaLibrary() {
  const [filters, setFilters] = useState<LibraryFilters>({});
  const [selected, setSelected] = useState<SocialMediaLibraryItem | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['social-media', 'library', filters],
    queryFn: () => fetchSocialMediaLibrary(filters),
    retry: 1,
  });

  return (
    <div className="space-y-4 pt-4">
      <SocialMediaFilters filters={filters} onChange={setFilters} />

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
          <SocialMediaLibraryCard key={`${item.sourceType}-${item.sourceId}`} item={item} onSelect={() => setSelected(item)} />
        ))}
      </div>

      {selected && (
        <SocialPublicationEditor
          open={Boolean(selected)}
          onOpenChange={(open) => { if (!open) setSelected(null); }}
          publicationId={selected.activePublication?.id ?? selected.publishedPublication?.id ?? null}
          createFrom={
            selected.activePublication || selected.publishedPublication
              ? undefined
              : { sourceType: selected.sourceType, clipId: selected.clipId ?? undefined, projectId: selected.projectId }
          }
        />
      )}
    </div>
  );
}
