import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchSocialPublications, publicationPollInterval } from '@/lib/crm/social-media';
import { SocialPublishingQueueItem } from './SocialPublishingQueueItem';
import { SocialPublicationEditor } from './SocialPublicationEditor';
import { SocialMediaErrorState } from './SocialMediaErrorState';
import { QUEUE_SECTIONS } from './publicationViews';

export function SocialPublishingQueue() {
  const [section, setSection] = useState('approved');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['social-media', 'publications', {}],
    queryFn: () => fetchSocialPublications(),
    retry: 1,
    // Poll only while something is actually changing (uploads, or scheduled videos about
    // to be reconciled), and never keep re-triggering a failing request.
    refetchInterval: (query) => (query.state.error ? false : publicationPollInterval(query.state.data)),
  });

  return (
    <div className="pt-4 space-y-4">
      {error && <SocialMediaErrorState error={error} />}
      <Tabs value={section} onValueChange={setSection}>
        <TabsList className="flex-wrap h-auto">
          {QUEUE_SECTIONS.map((sectionDef) => (
            <TabsTrigger key={sectionDef.value} value={sectionDef.value}>
              {sectionDef.label}
              {' '}
              ({(data ?? []).filter((pub) => sectionDef.statuses.includes(pub.status)).length})
            </TabsTrigger>
          ))}
        </TabsList>
        {QUEUE_SECTIONS.map((sectionDef) => {
          const items = (data ?? []).filter((pub) => sectionDef.statuses.includes(pub.status));
          return (
            <TabsContent key={sectionDef.value} value={sectionDef.value} className="space-y-2 pt-3">
              {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {!isLoading && items.length === 0 && <p className="text-sm text-muted-foreground">Nothing here.</p>}
              {items.map((pub) => <SocialPublishingQueueItem key={pub.id} publication={pub} onOpen={() => setOpenId(pub.id)} />)}
            </TabsContent>
          );
        })}
      </Tabs>

      {openId && (
        <SocialPublicationEditor open={Boolean(openId)} onOpenChange={(open) => { if (!open) setOpenId(null); }} publicationId={openId} />
      )}
    </div>
  );
}
