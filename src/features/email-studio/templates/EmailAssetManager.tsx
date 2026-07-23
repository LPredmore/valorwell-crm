import { useCallback, useEffect, useState } from 'react';
import { Clipboard, ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteEmailAsset, listEmailAssets, uploadEmailAsset } from './api';
import type { EmailAssetRecord, EmailStudioAccessContext } from './types';

export function EmailAssetManager({
  context,
  onInsert,
  compact = false,
}: {
  context: EmailStudioAccessContext;
  onInsert?: (asset: EmailAssetRecord) => void;
  compact?: boolean;
}) {
  const [assets, setAssets] = useState<EmailAssetRecord[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAssets(await listEmailAssets(context));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email assets could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    if (!file) {
      setError('Choose an image to upload.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const asset = await uploadEmailAsset(context, file, altText);
      setAssets((current) => [asset, ...current]);
      setFile(null);
      setAltText('');
      setMessage('Image uploaded to the tenant email asset library.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email image upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (asset: EmailAssetRecord) => {
    if (!window.confirm(`Delete ${asset.name} from the email asset library? Existing emails that use this URL may lose the image.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await deleteEmailAsset(context, asset.path);
      setAssets((current) => current.filter((entry) => entry.path !== asset.path));
      setMessage('Image deleted.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email image deletion failed.');
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async (asset: EmailAssetRecord) => {
    try {
      await navigator.clipboard.writeText(asset.publicUrl);
      setMessage('Public image URL copied.');
      setError(null);
    } catch {
      setError('The browser could not copy the image URL.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><ImagePlus className="h-5 w-5" />Email assets</CardTitle>
            <CardDescription>
              Public, tenant-scoped images for external email clients. Alt text, MIME type, file size, and dimensions are validated before upload.
            </CardDescription>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading || busy}>
            <RefreshCw className="mr-2 h-4 w-4" />Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {context.canManage ? (
          <div className="grid gap-3 rounded-md border p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="email-asset-file">Image</Label>
              <Input
                id="email-asset-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={busy}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-asset-alt">Alt text</Label>
              <Input
                id="email-asset-alt"
                value={altText}
                maxLength={240}
                disabled={busy}
                onChange={(event) => setAltText(event.target.value)}
                placeholder="Describe the image for recipients who cannot see it"
              />
            </div>
            <Button type="button" onClick={() => void upload()} disabled={busy || !file}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
              Upload
            </Button>
          </div>
        ) : (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">Your CRM role can inspect assets but cannot upload or delete them.</p>
        )}

        {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        {message ? <p className="rounded-md bg-muted p-3 text-sm">{message}</p> : null}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading email assets…</div>
        ) : assets.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No email images have been uploaded for this tenant.</p>
        ) : (
          <div className={compact ? 'space-y-3' : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'}>
            {assets.map((asset) => (
              <div key={asset.path} className="overflow-hidden rounded-md border bg-card">
                <div className="flex h-40 items-center justify-center bg-muted/40 p-2">
                  <img src={asset.publicUrl} alt={asset.altText} className="max-h-full max-w-full rounded object-contain" />
                </div>
                <div className="space-y-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={asset.name}>{asset.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{asset.altText || 'Alt text unavailable in object metadata'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{asset.mimeType.replace('image/', '')}</Badge>
                    <Badge variant="outline">{formatBytes(asset.sizeBytes)}</Badge>
                    {asset.width && asset.height ? <Badge variant="outline">{asset.width}×{asset.height}</Badge> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {onInsert ? (
                      <Button type="button" size="sm" onClick={() => onInsert(asset)} disabled={busy}>Insert</Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" onClick={() => void copyUrl(asset)}>
                      <Clipboard className="mr-2 h-3.5 w-3.5" />Copy URL
                    </Button>
                    {context.canManage ? (
                      <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(asset)} disabled={busy}>
                        <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatBytes(value: number): string {
  if (!value) return 'size unknown';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
