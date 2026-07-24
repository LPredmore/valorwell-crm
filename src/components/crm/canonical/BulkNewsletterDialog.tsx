import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { useResendSettings } from '@/hooks/crm/useResendSettings';
import { useToast } from '@/hooks/use-toast';
import { resendEmailApi } from '@/lib/crm/resend-api';
import type { CanonicalClient } from '@/domain/canonical';
import type { EmailContentDocument } from '@/features/email-studio/contracts';
import {
  ClientNewsletterEmailStudioComposer,
  type ClientNewsletterEmailStudioHandle,
} from '@/features/email-studio/newsletter';
import { listPublishedClientNewsletterTemplates } from '@/features/email-studio/templates';

type CreateBulkResult = {
  bulk_send_id: string;
  recipient_count: number;
};

type ProcessBulkResult = {
  bulkSendId: string;
  batchSent: number;
  batchFailed: number;
  sent: number;
  failed: number;
  remaining: number;
  complete: boolean;
  requestId?: string;
};

type UntypedSupabase = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export function BulkNewsletterDialog({
  open,
  onOpenChange,
  clients,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: CanonicalClient[];
  onComplete: () => void;
}) {
  const { tenantId } = useCrmAuth();
  const { settings, isConnected } = useResendSettings();
  const { toast } = useToast();
  const studioRef = useRef<ClientNewsletterEmailStudioHandle>(null);
  const [subject, setSubject] = useState('');
  const [initialContent, setInitialContent] = useState<EmailContentDocument | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateVersionId, setTemplateVersionId] = useState<string | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: ['email-studio', 'published-client-newsletter-templates'],
    queryFn: listPublishedClientNewsletterTemplates,
    staleTime: 30_000,
    enabled: open,
  });

  const validClients = useMemo(() => clients.filter((client) => Boolean(client.email)), [clients]);
  const postalReady = Boolean(settings?.postal_address?.trim());
  const ready = Boolean(tenantId && isConnected && postalReady && validClients.length > 0);

  const clearTemplateAttribution = () => {
    setTemplateId(null);
    setTemplateVersionId(null);
  };

  const applyTemplate = (versionId: string) => {
    if (versionId === 'blank') {
      setSubject('');
      setInitialContent(null);
      clearTemplateAttribution();
      setComposerKey((value) => value + 1);
      return;
    }
    const template = templates.data?.find((entry) => entry.versionId === versionId);
    if (!template) return;
    setSubject(template.subject);
    setInitialContent(template.content);
    setTemplateId(template.templateId);
    setTemplateVersionId(template.versionId);
    setComposerKey((value) => value + 1);
  };

  const createAndSend = async () => {
    if (!tenantId) return;
    if (!subject.trim()) {
      toast({ title: 'Subject required', variant: 'destructive' });
      return;
    }
    const content = await studioRef.current?.exportContent();
    if (!content || content.mode !== 'newsletter') {
      toast({
        title: 'Newsletter is not ready',
        description: 'Resolve the Email Studio validation errors before sending.',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);
    setProgress('Creating the controlled newsletter job…');
    try {
      const { data, error } = await (supabase as unknown as UntypedSupabase).rpc(
        'crm_create_bulk_newsletter',
        {
          p_tenant_id: tenantId,
          p_client_ids: validClients.map((client) => client.id),
          p_subject: subject.trim(),
          p_content: content,
          p_template_id: templateId,
          p_template_version_id: templateVersionId,
        },
      );
      if (error) throw new Error(error.message);
      const created = data as CreateBulkResult;
      if (!created?.bulk_send_id) throw new Error('The newsletter job was not created.');

      let result: ProcessBulkResult | null = null;
      for (let pass = 0; pass < 30; pass += 1) {
        setProgress(result
          ? `Sending: ${result.sent} sent, ${result.failed} blocked or failed, ${result.remaining} remaining…`
          : `Sending to ${created.recipient_count} selected clients…`);
        result = await resendEmailApi<ProcessBulkResult>('bulk-send', {
          method: 'POST',
          params: { tenantId, bulkSendId: created.bulk_send_id },
        });
        if (result.complete) break;
      }
      if (!result?.complete) throw new Error('The newsletter job did not finish within the controlled processing limit.');

      toast({
        title: result.failed ? 'Newsletter completed with exclusions' : 'Newsletter sent',
        description: `${result.sent} sent. ${result.failed} blocked or failed.`,
        variant: result.sent === 0 && result.failed > 0 ? 'destructive' : 'default',
      });
      onComplete();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Newsletter send failed',
        description: error instanceof Error ? error.message : 'Unable to complete the newsletter job.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isSending && onOpenChange(next)}>
      <DialogContent className="max-h-[95vh] max-w-[96vw] overflow-y-auto xl:max-w-7xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />Client newsletter
          </DialogTitle>
          <DialogDescription>
            {validClients.length} selected client{validClients.length === 1 ? '' : 's'}. Current communication policy is rechecked for every recipient immediately before delivery.
          </DialogDescription>
        </DialogHeader>

        {!isConnected || !postalReady ? (
          <Alert variant="destructive">
            <AlertTitle>Newsletter delivery is not configured</AlertTitle>
            <AlertDescription>
              {!isConnected
                ? 'Verify the Resend connection in CRM Settings before sending.'
                : 'Add the organization mailing address in CRM Settings before sending a newsletter.'}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-2">
            <Label htmlFor="bulk-newsletter-subject">Subject</Label>
            <Input
              id="bulk-newsletter-subject"
              value={subject}
              maxLength={250}
              disabled={isSending}
              onChange={(event) => {
                setSubject(event.target.value);
                clearTemplateAttribution();
              }}
              placeholder="Newsletter subject"
            />
          </div>
          <div className="space-y-2">
            <Label>Published newsletter template</Label>
            <Select onValueChange={applyTemplate} disabled={isSending || templates.isLoading}>
              <SelectTrigger><SelectValue placeholder={templates.isLoading ? 'Loading…' : 'Start blank or choose a template'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">Blank newsletter</SelectItem>
                {templates.data?.map((template) => (
                  <SelectItem key={template.versionId} value={template.versionId}>
                    {template.name} · v{template.versionNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ClientNewsletterEmailStudioComposer
          key={composerKey}
          ref={studioRef}
          initialContent={initialContent}
          readOnly={isSending}
          onDirty={clearTemplateAttribution}
        />

        {progress ? <p className="text-sm text-muted-foreground">{progress}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>Cancel</Button>
          <Button onClick={() => void createAndSend()} disabled={!ready || isSending || !subject.trim()}>
            {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            Send newsletter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
