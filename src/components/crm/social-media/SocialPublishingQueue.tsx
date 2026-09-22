import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchSocialPublications, type PublicationStatus } from '@/lib/crm/social-media';
import { SocialPublishingQueueItem } from './SocialPublishingQueueItem';
import { SocialPublicationEditor } from './SocialPublicationEditor';

const SECTIONS: { value: string; label: string; statuses: PublicationStatus[] }[] = [
  { value: 'draft', label: 'Draft', statuses: ['draft'] },
  { value: 'ready', label: 'Ready', statuses: ['ready'] },
  { value: 'approved', label: 'Approved', statuses: ['approved'] },
  { value: 'in_progress', label: 'Queued / Uploading', statuses: ['upload_queued', 'uploading'] },
  { value: 'scheduled', label: 'Scheduled', statuses: ['scheduled'] },
  { value: 'published', label: 'Published', statuses: ['uploaded', 'published'] },
  { value: 'failed', label: 'Failed', statuses: ['failed'] },
];

export function SocialPublishingQueue() {
  const [section, setSection] = useState('approved');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['social-media', 'publications', {}],
    queryFn: () => fetchSocialPublications(),
    refetchInterval: 15000,
  });

  return (
    <div className="pt-4 space-y-4">
      <Tabs value={section} onValueChange={setSection}>
        <TabsList className="flex-wrap h-auto">
          {SECTIONS.map((sectionDef) => (
            <TabsTrigger key={sectionDef.value} value={sectionDef.value}>
              {sectionDef.label}
              {' '}
              ({(data ?? []).filter((pub) => sectionDef.statuses.includes(pub.status)).length})
            </TabsTrigger>
          ))}
        </TabsList>
        {SECTIONS.map((sectionDef) => (
          <TabsContent key={sectionDef.value} value={sectionDef.value} className="space-y-2 pt-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!isLoading && (data ?? []).filter((pub) => sectionDef.statuses.includes(pub.status)).length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing here.</p>
            )}
            {(data ?? [])
              .filter((pub) => sectionDef.statuses.includes(pub.status))
              .map((pub) => <SocialPublishingQueueItem key={pub.id} publication={pub} onOpen={() => setOpenId(pub.id)} />)}
          </TabsContent>
        ))}
      </Tabs>

      {openId && (
        <SocialPublicationEditor open={Boolean(openId)} onOpenChange={(open) => { if (!open) setOpenId(null); }} publicationId={openId} />
      )}
    </div>
  );
}
