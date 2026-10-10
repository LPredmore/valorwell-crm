import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CrmMutationGate } from '@/components/crm/auth/CrmMutationGate';
import {
  confirmShortsThumbnailVisual, coverSourceOptions, disableShortsThumbnailApi, fetchShortsThumbnailEvidence, fetchShortsThumbnailFeature, fetchSocialMediaLibrary, fetchSocialThumbnailUrl, runShortsThumbnailTest,
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
  const [coverSearch, setCoverSearch] = useState('');
  const [coverKey, setCoverKey] = useState('');
  const [testConfirm, setTestConfirm] = useState('');
  const [visualConfirm, setVisualConfirm] = useState('');
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);
  const library = useQuery({
    queryKey: ['social-media', 'shorts-thumbnail-cover-sources'],
    queryFn: () => fetchSocialMediaLibrary({}),
    enabled: !!feature,
    staleTime: 60_000,
  });
  const options = useMemo(() => coverSourceOptions(library.data ?? []), [library.data]);
  const filtered = useMemo(() => {
    const q = coverSearch.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.detail}`.toLowerCase().includes(q)) : options;
  }, [options, coverSearch]);
  // The October 7 confirmed test is our golden control. Reuse its exact YouTube ID
  // and exact saved Library source to distinguish backend regressions from video-specific rendering.
  const confirmedControl = feature?.testRuns.find((run) => run.videoId === 'SpzT1xyRGAc' && run.visualResult === 'confirmed') ?? null;
  const controlCover = confirmedControl
    ? options.find((o) => o.sourceType === confirmedControl.sourceType && o.sourceId === confirmedControl.sourceId) ?? null
    : null;
  const selected = options.find((o) => o.key === coverKey) ?? null;
  const evidenceRun = feature?.testRuns.find((r) => r.id === evidenceRunId) ?? null;
  const evidence = useQuery({
    queryKey: ['social-media', 'shorts-thumbnail-evidence', evidenceRunId],
    queryFn: () => fetchShortsThumbnailEvidence(evidenceRunId as string),
    enabled: !!evidenceRunId,
    retry: 1, staleTime: 0,
  });
  const expectedCover = useQuery({
    queryKey: ['social-media', 'shorts-thumbnail-evidence-cover', evidenceRun?.sourceType, evidenceRun?.sourceId],
    queryFn: () => fetchSocialThumbnailUrl(evidenceRun!.sourceType as SourceType, evidenceRun!.sourceId),
    enabled: !!evidenceRun,
    retry: 1, staleTime: 60_000,
  });
  const sourceType: SourceType | null = selected?.sourceType ?? null;
  const sourceId = selected?.sourceId ?? '';
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['social-media', 'shorts-thumbnail-feature'] });

  const test = useMutation({
    mutationFn: () => runShortsThumbnailTest({ videoId: videoId.trim(), sourceType: sourceType as SourceType, sourceId, confirmation: testConfirm }),
    onSuccess: (data) => { refresh(); setEvidenceRunId(data.run.id); },
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
          You can run this original compatibility test again whenever you need to, including while automatic uploads are enabled.
          It uploads a saved Library image to an existing, private, unscheduled test Short. An API success alone does not prove that the artwork appears in YouTube Studio.
        </p>

        {feature.automaticUploadsEnabled && (
          <CrmMutationGate>
            <Button size="sm" variant="outline" onClick={() => disable.mutate()} disabled={disable.isPending}>Turn off (back to manual)</Button>
          </CrmMutationGate>
        )}
        <CrmMutationGate>
            <div className="space-y-2 rounded border p-3">
              <p className="font-medium">1. Re-run the exact original Shorts thumbnail test (admins only)</p>
              <p className="text-xs text-destructive">This replaces the real thumbnail of your chosen test video. Choose a disposable Short that you own and that is Private, unscheduled, and fully processed. All CRM-linked videos are protected, even if they are currently Private and unscheduled.</p>
              {confirmedControl && (
                <div className="rounded border p-2 space-y-1">
                  <p className="font-medium">Original confirmed control: {confirmedControl.videoId}</p>
                  <p className="text-xs text-muted-foreground">Run the exact October 7 test again on the same video with the same saved image, then compare its display in the same YouTube Studio app.</p>
                  <Button type="button" variant="outline" size="sm" disabled={!controlCover} onClick={() => {
                    if (!controlCover) return;
                    setVideoId(confirmedControl.videoId);
                    setCoverSearch('');
                    setCoverKey(controlCover.key);
                    setTestConfirm('');
                  }}>Load original successful test (same video + image)</Button>
                  {!controlCover && <p className="text-xs text-destructive">The original source image is not in the current Library results.</p>}
                </div>
              )}
              {feature.automaticUploadsEnabled && <p className="text-xs text-muted-foreground">This diagnostic retest does not change automatic publishing. Record the visual outcome below; use the separate “Turn off” button if you want to disable automation.</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <div><Label htmlFor="sst-video">Test Short video id</Label><Input id="sst-video" value={videoId} onChange={(e) => setVideoId(e.target.value)} placeholder="11-character id" /></div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="sst-cover-search">Library cover to use</Label>
                  {library.isLoading ? (
                    <p className="text-xs text-muted-foreground">Loading Library covers…</p>
                  ) : library.error ? (
                    <p className="text-xs text-destructive">Couldn't load the Library. Refresh to try again.</p>
                  ) : options.length === 0 ? (
                    <p className="rounded border border-dashed p-2 text-xs text-muted-foreground">No clips or episodes have a saved cover yet. Add one with Change Photo in the Library, then come back.</p>
                  ) : (
                    <>
                      <Input id="sst-cover-search" value={coverSearch} onChange={(e) => setCoverSearch(e.target.value)} placeholder="Search by title or organization" />
                      <select
                        id="sst-cover" aria-label="Library cover" className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        value={coverKey} onChange={(e) => setCoverKey(e.target.value)}
                      >
                        <option value="">{filtered.length ? `Choose a cover (${filtered.length})` : 'No matches'}</option>
                        {filtered.map((o) => <option key={o.key} value={o.key}>{o.label}{o.detail ? ` — ${o.detail}` : ''}</option>)}
                      </select>
                      {selected && <p className="text-xs text-muted-foreground">Using the saved cover of “{selected.label}”{selected.detail ? ` (${selected.detail})` : ''}.</p>}
                    </>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="sst-confirm">Type <code>{SHORTS_TEST_CONFIRMATION_PREFIX}{videoId.trim() || '<video id>'}</code></Label>
                  <Input id="sst-confirm" value={testConfirm} onChange={(e) => setTestConfirm(e.target.value)} />
                </div>
              </div>
              <Button size="sm" onClick={() => test.mutate()} disabled={test.isPending || testConfirm !== SHORTS_TEST_CONFIRMATION_PREFIX + videoId.trim() || !selected}>
                {test.isPending ? 'Testing…' : 'Run test on this video'}
              </Button>
            </div>
        </CrmMutationGate>

        {feature.testRuns.length > 0 && (
          <div className="rounded border p-3 text-xs space-y-2">
            <p className="font-medium text-sm">Test history — compare with the original successful test</p>
            {feature.testRuns.slice(0, 5).map((run) => (
              <div key={run.id} className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0">
                <p><strong>Video {run.videoId}</strong> · {new Date(run.requestedAt).toLocaleString()} · HTTP {run.httpStatus ?? '—'} · API {run.apiAccepted ? 'accepted' : 'refused'}</p>
                <p>Custom-thumbnail flag: {String(run.hasCustomThumbnail)} · Visual review: <strong>{run.visualResult}</strong></p>
                {run.error && <p className="text-destructive">{run.error}</p>}
                <div className="flex flex-wrap gap-3">
                  <a className="underline" href={`https://www.youtube.com/shorts/${encodeURIComponent(run.videoId)}`} target="_blank" rel="noopener noreferrer">Open Short</a>
                  <a className="underline" href={`https://studio.youtube.com/video/${encodeURIComponent(run.videoId)}/edit`} target="_blank" rel="noopener noreferrer">Open in Studio</a>
                  <button type="button" className="underline" onClick={() => {
                    setEvidenceRunId(run.id);
                    void queryClient.invalidateQueries({ queryKey: ['social-media', 'shorts-thumbnail-evidence', run.id] });
                  }}>Compare actual images</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {evidenceRunId && (
          <div className="rounded border p-3 text-xs space-y-3">
            <p className="font-medium text-sm">Actual image comparison — {evidenceRun?.videoId ?? 'test'}</p>
            <p className="text-muted-foreground">
              The left image is the JPEG selected in the CRM. The right image is downloaded from YouTube's authenticated thumbnail URL.
              Neither an HTTP 200 response nor a matching CDN preview proves that the Shorts thumbnail appears in YouTube Studio.
            </p>
            {evidence.isLoading && <p>Checking YouTube's currently served image…</p>}
            {evidence.error && <p className="text-destructive">YouTube evidence check failed: {(evidence.error as Error).message}</p>}
            {expectedCover.error && <p className="text-destructive">Source image preview failed: {(expectedCover.error as Error).message}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="font-medium">CRM-selected JPEG</p>
                {expectedCover.data?.signedUrl ? (
                  <img src={expectedCover.data.signedUrl} alt="Exact source image selected for this test" className="h-48 w-full rounded border object-contain bg-muted" />
                ) : <p className="text-muted-foreground">Source preview unavailable</p>}
                <p className="break-all text-muted-foreground">Drive file: {evidenceRun?.thumbnailFileId}</p>
              </div>
              <div className="space-y-1">
                <p className="font-medium">YouTube's served thumbnail</p>
                {evidence.data?.youtubePreviewUrl ? (
                  <img src={evidence.data.youtubePreviewUrl} alt="Image actually served by YouTube's authenticated thumbnail CDN" className="h-48 w-full rounded border object-contain bg-muted" />
                ) : <p className="text-muted-foreground">YouTube preview unavailable</p>}
                <p className="text-muted-foreground">
                  CDN: {evidence.data?.served?.httpStatus ?? '—'} · {evidence.data?.served?.byteCount ?? '—'} bytes · custom flag: {String(evidence.data?.hasCustomThumbnail ?? 'unknown')}
                </p>
              </div>
            </div>
            {evidence.data?.served?.sha256 && <p className="break-all text-muted-foreground">YouTube served image SHA-256: {evidence.data.served.sha256}</p>}
            <Button size="sm" variant="outline" onClick={() => void evidence.refetch()} disabled={evidence.isFetching}>Refresh YouTube evidence</Button>
            <p className="font-medium">Visual verdict: {evidenceRun?.visualResult ?? 'awaiting operator review'}</p>
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
                  onClick={() => review.mutate({ testRunId: pending.id, result: 'not_visible' })}>Not visible — record failed test</Button>
              </div>
            </div>
          </CrmMutationGate>
        )}
        {mutationError && <p className="text-xs text-destructive">{mutationError.message}</p>}
      </CardContent>
    </Card>
  );
}
