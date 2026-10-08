import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { SocialMediaLibrary } from '@/components/crm/social-media/SocialMediaLibrary';
import { SocialPublishingQueue } from '@/components/crm/social-media/SocialPublishingQueue';
import { SocialPublishingCalendar } from '@/components/crm/social-media/SocialPublishingCalendar';
import { SocialMediaSettings } from '@/components/crm/social-media/SocialMediaSettings';
import { SocialMediaErrorState } from '@/components/crm/social-media/SocialMediaErrorState';
import { fetchSocialMediaBootstrap } from '@/lib/crm/social-media';
import { ScheduleSeriesDialog } from '@/components/crm/social-media/ScheduleSeriesDialog';
import { CalendarRange } from 'lucide-react';

export default function SocialMediaManagerPage() {
  // Existing /crm/social-media remains canonical. Query state enables navigation
  // from the dedicated sidebar without remounting or rewriting any publishing tools.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab = requestedTab && ['library', 'queue', 'calendar', 'settings'].includes(requestedTab)
    ? requestedTab
    : 'library';
  const seriesOpen = searchParams.get('action') === 'schedule-series';
  const setTab = (nextTab: string) => {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set('tab', nextTab);
      params.delete('action');
      return params;
    }, { replace: true });
  };
  const setSeriesOpen = (open: boolean) => {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      if (open) params.set('action', 'schedule-series');
      else params.delete('action');
      return params;
    }, { replace: true });
  };

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold">Social Media Manager</h1>
        <p className="text-sm text-muted-foreground">
          Review, approve, and publish Beyond The Yellow video content to YouTube.
        </p>
      </div>
        <Button variant="outline" onClick={() => setSeriesOpen(true)}>
          <CalendarRange className="h-4 w-4" /> Schedule Series
        </Button>
      </div>
      <ScheduleSeriesDialog open={seriesOpen} onOpenChange={setSeriesOpen} />

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
