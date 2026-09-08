import { useEffect, type ReactNode } from 'react';
import { ArrowLeft, Eye, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type NewsletterWorkspaceAutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export type NewsletterEditorWorkspaceProps = {
  title: string;
  name: string;
  subject: string;
  reason: string;
  autosaveStatus: NewsletterWorkspaceAutosaveStatus;
  autosaveError?: string | null;
  savePending: boolean;
  saveDisabled: boolean;
  onNameChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onPreview: () => void;
  onSave: () => void;
  audienceControls: ReactNode;
  children: ReactNode;
};

export function NewsletterEditorWorkspace({
  title,
  name,
  subject,
  reason,
  autosaveStatus,
  autosaveError,
  savePending,
  saveDisabled,
  onNameChange,
  onSubjectChange,
  onReasonChange,
  onClose,
  onPreview,
  onSave,
  audienceControls,
  children,
}: NewsletterEditorWorkspaceProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex min-h-0 flex-col bg-background"
      data-testid="newsletter-editor-workspace"
    >
      <header className="shrink-0 border-b bg-background shadow-sm">
        <div className="flex min-h-16 items-center gap-3 px-4 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close newsletter editor">
            <ArrowLeft className="mr-2 h-4 w-4" />Back
          </Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">ValorWell newsletter workspace</p>
          </div>
          <AutosaveBadge status={autosaveStatus} error={autosaveError} />
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onPreview}>
              <Eye className="mr-2 h-4 w-4" />Preview
            </Button>
            <Button type="button" disabled={saveDisabled || savePending} onClick={onSave}>
              <Save className="mr-2 h-4 w-4" />{savePending ? 'Saving…' : 'Save draft'}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 border-t px-4 py-3 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.4fr)_minmax(220px,1fr)]">
          <div className="space-y-1">
            <Label htmlFor="newsletter-workspace-name">Internal name</Label>
            <Input
              id="newsletter-workspace-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="September weekly newsletter"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="newsletter-workspace-subject">Subject line</Label>
            <Input
              id="newsletter-workspace-subject"
              value={subject}
              onChange={(event) => onSubjectChange(event.target.value)}
              placeholder="What veterans and families should know this week"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="newsletter-workspace-reason">Change reason</Label>
            <Input
              id="newsletter-workspace-reason"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder="Weekly newsletter draft"
            />
          </div>
        </div>

        <div className="border-t bg-muted/20 px-4 py-2" data-testid="newsletter-audience-controls">
          {audienceControls}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden bg-muted/40">
        {children}
      </main>
    </div>
  );
}

function AutosaveBadge({
  status,
  error,
}: {
  status: NewsletterWorkspaceAutosaveStatus;
  error?: string | null;
}) {
  if (status === 'saving') return <Badge variant="secondary">Autosaving…</Badge>;
  if (status === 'saved') return <Badge>Saved</Badge>;
  if (status === 'pending') return <Badge variant="outline">Unsaved changes</Badge>;
  if (status === 'error') {
    return <Badge variant="destructive" title={error || 'Autosave failed'}>Autosave failed</Badge>;
  }
  return <Badge variant="outline">Ready</Badge>;
}
