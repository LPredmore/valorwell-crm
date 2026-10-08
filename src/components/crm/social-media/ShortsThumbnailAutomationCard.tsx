import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CrmMutationGate } from '@/components/crm/auth/CrmMutationGate';
import {
  confirmShortsThumbnailVisual, disableShortsThumbnailApi, fetchShortsThumbnailFeature, runShortsThumbnailTest,
  SHORTS_TEST_CONFIRMATION_PREFIX, SHORTS_VISUAL_CONFIRMATION_PHRASE, type SourceType,
} from '@/lib/crm/social-media';
import { SocialMediaErrorState } from './SocialMediaErrorState';

const STATE_LABEL = { disabled: 'Off (manual Studio)', testing: 'Testing', api_verified: 'On (verified)' } as const;

/**
 * Nothing here runs on render except a read. The only YouTube write is the explicit test
 * button, which the server re-validates (owned, private, unscheduled test Short).
 */
export function ShortsThumbnailAutomationCard() {
  const queryClient = useQueryClient();
  const { data: feature, error } = useQuery({ queryKey: ['social-media', 'shorts-thumbnail-feature'], queryFn: fetchShortsThumbnailFeature, retry: 1 });
  const [videoId, setVideoId] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('clip');
  const [sourceId, setSourceId] = useState('');
  const [testConfirm, setTestConfirm] = useState('');
  const [visualConfirm, setVisualConfirm] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['social-media', 'shorts-thumbnail-feature'] });

  const test = useMutation({
    mutationFn: () => runShortsThumbnailTest({ videoId: videoId.trim(), sourceType, sourceId: sourceId.trim(), confirmation: testConfirm }),
    onSuccess: refresh,
  });
  const review = useMutation({
    mutationFn: (p: { testRunId: string; result: 'confirmed' | 'not_visible' }) =>
      confirmShortsThumbnailVisual({ ...p, confirmation: p.result === 'confirmed' ? visualConfirm : undefined }),
    onSuccess: refresh,
  });
  const disable = useMutation({ mutationFn: disableShortsThumbnailApi, onSuccess: refresh });

  if (error) return <SocialMediaErrorState error={error} />;
  if (!feature) return null;
  const pending = feature.testRuns.find((run) => run.visualResult === 'pending');
  const latest = feature.testRuns[0];
  const mutationError = (test.error ?? review.error ?? disable.error) as Error | null;

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Automatic Shorts thumbnails</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={feature.automaticUploadsEnabled ? 'default' : 'secondary'}>{STATE_LABEL[feature.state]}</Badge>
          {feature.enabledAt && <span className="text-xs text-muted-foreground">Enabled {new Date(feature.enabledAt).toLocaleString()}</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          YouTube's help still says custom Shorts thumbnails can only be set in desktop Studio. Until you test on a disposable
          private Short and confirm with your own eyes that the thumbnail shows on Shorts, scheduled Shorts stay on the manual
          Studio step. An accepted API request alone never turns this on.
        </p>

        {feature.automaticUploadsEnabled ? (
          <CrmMutationGate>
            <Button size="sm" variant="outline" onClick={() => disable.mutate()} disabled={disable.isPending}>Turn off (back to manual)</Button>
          </CrmMutationGate>
        ) : (
          <CrmMutationGate>
            <div className="space-y-2 rounded border p-3">
              <p className="font-medium">1. Run a compatibility test (admins only)</p>
              <p className="text-xs text-destructive">Warning: this changes the real thumbnail on the test video you name. Use a private, unscheduled Short you own and can discard.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div><Label htmlFor="sst-video">Test Short video id</Label><Input id="sst-video" value={videoId} onChange={(e) => setVideoId(e.target.value)} placeholder="11-character id" /></div>
                <div>
                  <Label htmlFor="sst-type">Cover from</Label>
                  <select id="sst-type" className="h-9 w-full rounded-md border bg-background px-2" value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceType)}>
                    <option value="clip">Library clip</option><option value="project">Library episode</option>
                  </select>
                </div>
                <div className="sm:col-span-2"><Label htmlFor="sst-source">Library item id (its saved cover is used)</Label><Input id="sst-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)} /></div>
                <div className="sm:col-span-2">
                  <Label htmlFor="sst-confirm">Type <code>{SHORTS_TEST_CONFIRMATION_PREFIX}{videoId.trim() || '<video id>'}</code></Label>
                  <Input id="sst-confirm" value={testConfirm} onChange={(e) => setTestConfirm(e.target.value)} />
                </div>
              </div>
              <Button size="sm" onClick={() => test.mutate()} disabled={test.isPending || testConfirm !== SHORTS_TEST_CONFIRMATION_PREFIX + videoId.trim() || !sourceId.trim()}>
                {test.isPending ? 'Testing…' : 'Run test on this video'}
              </Button>
            </div>
          </CrmMutationGate>
        )}

        {latest && (
          <div className="rounded border p-3 text-xs space-y-1">
            <p className="font-medium text-sm">Latest test</p>
            <p>Video {latest.videoId} · HTTP {latest.httpStatus ?? '—'} · API {latest.apiAccepted ? 'accepted' : 'refused'} · custom-thumbnail flag {String(latest.hasCustomThumbnail)}</p>
            {latest.error && <p className="text-destructive">{latest.error}</p>}
            <p>Visual review: {latest.visualResult}</p>
            <div className="flex gap-2">
              <a className="underline" href={`https://www.youtube.com/shorts/${encodeURIComponent(latest.videoId)}`} target="_blank" rel="noopener noreferrer">Open as Short</a>
              <a className="underline" href={`https://studio.youtube.com/video/${encodeURIComponent(latest.videoId)}/edit`} target="_blank" rel="noopener noreferrer">Open in Studio</a>
            </div>
          </div>
        )}

        {pending && (
          <CrmMutationGate>
            <div className="space-y-2 rounded border p-3">
              <p className="font-medium">2. Look at the Short yourself</p>
              <p className="text-xs text-muted-foreground">Check the Shorts feed/shelf and channel Shorts tab (signed in as the owner) and compare with the cover. Only confirm if the new image is what YouTube shows.</p>
              <Label htmlFor="sst-visual">Type <code>{SHORTS_VISUAL_CONFIRMATION_PHRASE}</code></Label>
              <Input id="sst-visual" value={visualConfirm} onChange={(e) => setVisualConfirm(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!pending.apiAccepted || visualConfirm !== SHORTS_VISUAL_CONFIRMATION_PHRASE || review.isPending}
                  onClick={() => review.mutate({ testRunId: pending.id, result: 'confirmed' })}>I saw it — turn on</Button>
                <Button size="sm" variant="outline" disabled={review.isPending}
                  onClick={() => review.mutate({ testRunId: pending.id, result: 'not_visible' })}>Not visible — keep manual</Button>
              </div>
            </div>
          </CrmMutationGate>
        )}
        {mutationError && <p className="text-xs text-destructive">{mutationError.message}</p>}
      </CardContent>
    </Card>
  );
}
