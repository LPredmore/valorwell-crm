import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SocialMediaLibrary } from '@/components/crm/social-media/SocialMediaLibrary';
import { SocialPublishingQueue } from '@/components/crm/social-media/SocialPublishingQueue';
import { SocialPublishingCalendar } from '@/components/crm/social-media/SocialPublishingCalendar';
import { SocialMediaSettings } from '@/components/crm/social-media/SocialMediaSettings';

export default function SocialMediaManagerPage() {
  const [tab, setTab] = useState('library');

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Social Media Manager</h1>
        <p className="text-sm text-muted-foreground">
          Review, approve, and publish Beyond The Yellow video content to YouTube.
        </p>
      </div>

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
