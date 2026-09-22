import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { SocialMediaLibrary } from '@/components/crm/social-media/SocialMediaLibrary';
import { SocialPublishingQueue } from '@/components/crm/social-media/SocialPublishingQueue';
import { SocialPublishingCalendar } from '@/components/crm/social-media/SocialPublishingCalendar';
import { SocialMediaSettings } from '@/components/crm/social-media/SocialMediaSettings';
import { SocialMediaErrorState } from '@/components/crm/social-media/SocialMediaErrorState';
import { fetchSocialMediaBootstrap } from '@/lib/crm/social-media';

export default function SocialMediaManagerPage() {
  const [tab, setTab] = useState('library');

  // A lightweight preflight so a shared root cause (unreachable function, expired session,
  // no resolvable tenant) shows one clear diagnostic instead of four tabs each independently
  // stuck or erroring the same way: reachable -> authenticated -> tenant resolved -> allowed.
  const bootstrap = useQuery({
    queryKey: ['social-media', 'bootstrap'],
    queryFn: fetchSocialMediaBootstrap,
    retry: 1,
  });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Social Media Manager</h1>
        <p className="text-sm text-muted-foreground">
          Review, approve, and publish Beyond The Yellow video content to YouTube.
        </p>
      </div>

      {bootstrap.error && (
        <div className="space-y-2">
          <SocialMediaErrorState error={bootstrap.error} />
          <Button size="sm" variant="outline" onClick={() => bootstrap.refetch()}>Retry connection check</Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="queue">Publishing Queue</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="library">
          <SocialMediaLibrary />
        </TabsContent>
        <TabsContent value="queue">
          <SocialPublishingQueue />
        </TabsContent>
        <TabsContent value="calendar">
          <SocialPublishingCalendar />
        </TabsContent>
        <TabsContent value="settings">
          <SocialMediaSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
