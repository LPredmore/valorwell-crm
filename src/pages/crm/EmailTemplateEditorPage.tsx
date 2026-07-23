import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmailEditor, type EmailEditorRef } from '@react-email/editor';
import { StarterKit } from '@react-email/editor/extensions';
import { EmailTheming } from '@react-email/editor/plugins';
import {
  Archive,
  ArrowLeft,
  Copy,
  Loader2,
  RotateCcw,
  Save,
  Send,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createEmailContentDraftFromEditorExport,
  createEmailValidationResult,
  finalizeEmailContentDocument,
  getEmailVariablesForScope,
  importLegacyHtmlEmail,
  type EmailContentDocument,
  type EmailContentMode,
  type EmailContentScope,
  type EmailEditorDocument,
  type EmailEditorNode,
  type EmailValidationResult,
} from '@/features/email-studio/contracts';
import {
  BlockLibrary,
  EmailStudioInspector,
  EmailStudioToolbar,
  PreviewDialog,
  TemplatePicker,
  ValidationPanel,
  VariablePicker,
  type EmailStudioStatus,
} from '@/features/email-studio/studio/EmailStudio';
import {
  EMAIL_STUDIO_THEMES,
  getEmailStudioBlocksForMode,
  type EmailStudioBlockDefinition,
  type EmailStudioThemeKey,
} from '@/features/email-studio/studio/config';
import {
  cloneEmailStudioDocument,
  createEmailStudioBlockNode,
  createEmailStudioBlockNodeByKind,
  createEmailStudioDocument,
  createEmailStudioPresetDocument,
} from '@/features/email-studio/studio/documents';
import { EmailStudioBlock, EmailStudioVariable } from '@/features/email-studio/studio/extensions';
import {
  validateEmailStudioDraft,
  validateEmailStudioEditorDocument,
} from '@/features/email-studio/studio/validation';
import { EmailAssetManager } from '@/features/email-studio/templates/EmailAssetManager';
import {
  archiveEmailTemplate,
  copyEmailTemplate,
  getEmailStudioAccessContext,
  getEmailTemplate,
  listEmailTemplateVersions,
  publishEmailTemplate,
  reopenEmailTemplateDraft,
  saveEmailTemplateDraft,
} from '@/features/email-studio/templates/api';
import type {
  EmailAssetRecord,
  EmailStudioAccessContext,
  EmailTemplateMetadata,
  EmailTemplateRecord,
  EmailTemplateVersionRecord,
} from '@/features/email-studio/templates/types';
import { validateEmailTemplateMetadata } from '@/features/email-studio/templates/validation';

const TEMPLATE_EXTENSIONS = [
  StarterKit,
  EmailTheming.configure({ theme: 'basic' }),
  EmailStudioBlock,
  EmailStudioVariable,
];

const EMPTY_METADATA: EmailTemplateMetadata = {
  name: '',
  description: '',
  subject: '',
  scope: 'client',
};

export default function EmailTemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const editorRef = useRef<EmailEditorRef>(null);

  const [context, setContext] = useState<EmailStudioAccessContext | null>(null);
  const [template, setTemplate] = useState<EmailTemplateRecord | null>(null);
  const [versions, setVersions] = useState<EmailTemplateVersionRecord[]>([]);
  const [metadata, setMetadata] = useState<EmailTemplateMetadata>(EMPTY_METADATA);
  const [mode, setMode] = useState<EmailContentMode>('direct');
  const [themeKey, setThemeKey] = useState<EmailStudioThemeKey>('valorwell');
  const [content, setContent] = useState<EmailEditorDocument>(() => createEmailStudioDocument({ mode: 'direct', scope: 'client' }));
  const [preheader, setPreheader] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState<EmailStudioStatus>('loading');
  const [validation, setValidation] = useState<EmailValidationResult>(() => createEmailValidationResult([]));
  const [snapshot, setSnapshot] = useState<EmailContentDocument | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [changeSummary, setChangeSummary] = useState('');
  const [legacyReview, setLegacyReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readOnly = !context?.canManage || template?.status === 'published' || template?.status === 'archived';
  const availableBlocks = useMemo(() => getEmailStudioBlocksForMode(mode), [mode]);
  const variables = useMemo(() => getEmailVariablesForScope(metadata.scope), [metadata.scope]);

  const initializeTemplate = useCallback((record: EmailTemplateRecord | null) => {
    if (!record) {
      const nextDocument = createEmailStudioDocument({ mode: 'direct', scope: 'client', themeKey: 'valorwell' });
      setTemplate(null);
      setMetadata(EMPTY_METADATA);
      setMode('direct');
      setThemeKey('valorwell');
      setContent(nextDocument);
      setPreheader('');
      setLegacyReview(false);
      setValidation(validateEmailStudioEditorDocument(nextDocument, 'direct', 'client'));
      setEditorKey((value) => value + 1);
      return;
    }

    const imported = record.editorDocument
      ? null
      : importLegacyHtmlEmail({
          mode: record.mode,
          html: record.renderedHtml,
          text: record.renderedText,
          preheader: record.preheader,
          themeKey: record.themeKey,
        });
    const nextDocument = record.editorDocument || imported?.draft.editorDocument
      || createEmailStudioDocument({ mode: record.mode, scope: record.scope, themeKey: record.themeKey });

    setTemplate(record);
    setMetadata({
      name: record.name,
      description: record.description || '',
      subject: record.subject,
      scope: record.scope,
    });
    setMode(record.mode);
    setThemeKey(record.themeKey);
    setContent(cloneEmailStudioDocument(nextDocument));
    setPreheader(record.preheader || '');
    setLegacyReview(Boolean(imported));
    setValidation(validateEmailStudioEditorDocument(nextDocument, record.mode, record.scope));
    setSnapshot(null);
    setStatus('loading');
    setEditorKey((value) => value + 1);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const access = await getEmailStudioAccessContext();
      setContext(access);
      if (isNew) {
        initializeTemplate(null);
        setVersions([]);
      } else if (id) {
        const [record, history] = await Promise.all([
          getEmailTemplate(id),
          listEmailTemplateVersions(id),
        ]);
        initializeTemplate(record);
        setVersions(history);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email template could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [id, initializeTemplate, isNew]);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceDocument = (
    nextDocument: EmailEditorDocument,
    nextMode = mode,
    nextThemeKey = themeKey,
    nextScope = metadata.scope,
  ) => {
    setMode(nextMode);
    setThemeKey(nextThemeKey);
    setContent(cloneEmailStudioDocument(nextDocument));
    setSnapshot(null);
    setValidation(validateEmailStudioEditorDocument(nextDocument, nextMode, nextScope));
    setError(null);
    setStatus('loading');
    setEditorKey((value) => value + 1);
  };

  const exportCurrent = async (openPreview = false): Promise<EmailContentDocument | null> => {
    const ref = editorRef.current;
    if (!ref) {
      setError('The Email Studio editor is not ready.');
      return null;
    }

    setStatus('exporting');
    setError(null);
    try {
      const { html, text } = await ref.getEmail();
      const editorDocument = ref.getJSON() as unknown as EmailEditorDocument;
      const draft = createEmailContentDraftFromEditorExport({
        mode,
        editorDocument,
        html,
        text,
        preheader,
        themeKey,
      });
      const result = validateEmailStudioDraft(draft, metadata.scope);
      setValidation(result);
      if (!result.valid) {
        setSnapshot(null);
        setStatus('invalid');
        return null;
      }
      const finalized = await finalizeEmailContentDocument(draft, metadata.scope);
      if (!finalized.document) {
        setValidation(finalized.validation);
        setSnapshot(null);
        setStatus('invalid');
        return null;
      }
      setContent(cloneEmailStudioDocument(editorDocument));
      setSnapshot(finalized.document);
      setStatus('exported');
      if (openPreview) setPreviewOpen(true);
      return finalized.document;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Canonical email export failed.');
      setStatus('dirty');
      return null;
    }
  };

  const saveDraft = async (quiet = false): Promise<EmailTemplateRecord | null> => {
    const metadataIssues = validateEmailTemplateMetadata(metadata);
    if (metadataIssues.length) {
      setError(metadataIssues.join(' '));
      return null;
    }
    const canonical = await exportCurrent(false);
    if (!canonical) return null;

    setBusy(true);
    setError(null);
    try {
      const saved = await saveEmailTemplateDraft({
        templateId: template?.id || null,
        ...metadata,
        content: canonical,
      });
      setTemplate(saved);
      setLegacyReview(false);
      if (!quiet) setMessage('Draft saved with canonical JSON, HTML, plain text, and render hash.');
      if (isNew || !id) navigate(`/crm/email-studio/templates/${saved.id}`, { replace: true });
      return saved;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email template draft could not be saved.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    const saved = await saveDraft(true);
    if (!saved) return;
    setBusy(true);
    setError(null);
    try {
      const published = await publishEmailTemplate(saved.id, changeSummary);
      const [record, history] = await Promise.all([
        getEmailTemplate(saved.id),
        listEmailTemplateVersions(saved.id),
      ]);
      setTemplate(record);
      setVersions(history);
      setChangeSummary('');
      setMessage(`Published immutable version ${published.versionNumber}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email template could not be published.');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      const reopened = await reopenEmailTemplateDraft(template.id);
      setTemplate(reopened);
      setMessage('Published content reopened as an editable draft. The published version remains immutable.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email template could not be reopened.');
    } finally {
      setBusy(false);
    }
  };

  const copyTemplate = async () => {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      const copied = await copyEmailTemplate(template.id, `${template.name} Copy`);
      navigate(`/crm/email-studio/templates/${copied.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email template could not be copied.');
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!template || !window.confirm(`Archive ${template.name}? Published versions remain available for audit and historical sends.`)) return;
    setBusy(true);
    setError(null);
    try {
      const archived = await archiveEmailTemplate(template.id);
      setTemplate(archived);
      setMessage('Template archived. Copy it to create a new editable draft.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email template could not be archived.');
    } finally {
      setBusy(false);
    }
  };

  const insertBlock = (definition: EmailStudioBlockDefinition) => {
    if (readOnly) return;
    editorRef.current?.editor?.chain().focus().insertContent(createEmailStudioBlockNode(definition, themeKey)).run();
  };

  const insertVariable = (key: string) => {
    if (readOnly) return;
    const definition = variables.find((entry) => entry.key === key);
    if (!definition) return;
    editorRef.current?.editor?.chain().focus().insertContent({
      type: 'emailVariable',
      attrs: { key: definition.key, label: definition.label },
    }).run();
  };

  const insertAsset = (asset: EmailAssetRecord) => {
    if (readOnly) return;
    const kind = mode === 'direct' ? 'text' : 'hero';
    const node = createEmailStudioBlockNodeByKind(kind, themeKey);
    node.attrs = {
      ...node.attrs,
      title: mode === 'direct' ? '' : asset.altText,
      body: mode === 'direct' ? asset.altText : '',
      imageUrl: asset.publicUrl,
      altText: asset.altText,
    };
    editorRef.current?.editor?.chain().focus().insertContent(node).run();
    setMessage('Image inserted into the current email document.');
  };

  if (loading) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading Email Studio template…</div>;
  }

  if (!context) {
    return <div className="p-6"><p className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">{error || 'Email Studio access could not be resolved.'}</p></div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3"><Link to="/crm/email-studio"><ArrowLeft className="mr-2 h-4 w-4" />Template library</Link></Button>
          <h1 className="text-2xl font-bold">{template ? template.name : 'New email template'}</h1>
          <p className="text-sm text-muted-foreground">Draft canonical email content, publish immutable versions, and preserve every delivery reference.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {template ? <Badge variant={template.status === 'published' ? 'default' : 'outline'}>{template.status}</Badge> : <Badge variant="outline">unsaved</Badge>}
          {legacyReview ? <Badge variant="destructive">legacy conversion review</Badge> : null}
          {!context.canManage ? <Badge variant="secondary">read only</Badge> : null}
        </div>
      </div>

      {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {message ? <p className="rounded-md bg-muted p-3 text-sm">{message}</p> : null}
      {legacyReview ? (
        <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
          <CardHeader><CardTitle>Legacy HTML conversion requires review</CardTitle><CardDescription>The original HTML remains preserved, but editable JSON was reconstructed from plain text. Review every block before saving canonical content.</CardDescription></CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Template identity</CardTitle><CardDescription>Name, subject, audience boundary, and lifecycle controls.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="email-template-name">Name</Label><Input id="email-template-name" value={metadata.name} disabled={readOnly} onChange={(event) => setMetadata((current) => ({ ...current, name: event.target.value }))} /></div>
            <div className="space-y-2"><Label htmlFor="email-template-subject">Subject</Label><Input id="email-template-subject" value={metadata.subject} disabled={readOnly} onChange={(event) => setMetadata((current) => ({ ...current, subject: event.target.value }))} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="email-template-description">Description</Label><Textarea id="email-template-description" value={metadata.description} disabled={readOnly} onChange={(event) => setMetadata((current) => ({ ...current, description: event.target.value }))} /></div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Content scope</Label>
              <Select value={metadata.scope} disabled={readOnly || versions.length > 0} onValueChange={(value) => {
                const nextScope = value as EmailContentScope;
                setMetadata((current) => ({ ...current, scope: nextScope }));
                replaceDocument(createEmailStudioDocument({ mode, scope: nextScope, themeKey }), mode, themeKey, nextScope);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="client">Client communication</SelectItem><SelectItem value="relationship">Relationship outreach</SelectItem></SelectContent>
              </Select>
              {versions.length > 0 ? <p className="text-xs text-muted-foreground">Versioned templates cannot change audience scope.</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-template-change-summary">Publish summary</Label>
              <Input id="email-template-change-summary" value={changeSummary} disabled={readOnly && template?.status !== 'published'} onChange={(event) => setChangeSummary(event.target.value)} placeholder="What changed in this version?" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!readOnly ? <Button type="button" onClick={() => void saveDraft()} disabled={busy}><Save className="mr-2 h-4 w-4" />Save draft</Button> : null}
            {!readOnly ? <Button type="button" variant="secondary" onClick={() => void publish()} disabled={busy}><Send className="mr-2 h-4 w-4" />Save and publish</Button> : null}
            {template?.status === 'published' && context.canManage ? <Button type="button" variant="outline" onClick={() => void reopen()} disabled={busy}><RotateCcw className="mr-2 h-4 w-4" />Reopen draft</Button> : null}
            {template && context.canManage ? <Button type="button" variant="outline" onClick={() => void copyTemplate()} disabled={busy}><Copy className="mr-2 h-4 w-4" />Copy</Button> : null}
            {template && template.status !== 'archived' && context.canManage ? <Button type="button" variant="ghost" className="text-destructive" onClick={() => void archive()} disabled={busy}><Archive className="mr-2 h-4 w-4" />Archive</Button> : null}
          </div>
        </CardContent>
      </Card>

      <EmailStudioToolbar
        mode={mode}
        allowedModes={['direct', 'campaign', 'newsletter']}
        themeKey={themeKey}
        status={status}
        readOnly={readOnly}
        onModeChange={(nextMode) => replaceDocument(createEmailStudioDocument({ mode: nextMode, scope: metadata.scope, themeKey }), nextMode, themeKey)}
        onThemeChange={(nextTheme) => {
          const current = currentEditorDocument(editorRef.current, content);
          replaceDocument(applyTheme(current, nextTheme), mode, nextTheme);
        }}
        onPreview={() => void exportCurrent(true)}
        onExport={() => void exportCurrent(false)}
        onReset={() => replaceDocument(createEmailStudioDocument({ mode, scope: metadata.scope, themeKey }))}
      />

      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <TemplatePicker onSelect={(presetKey) => {
            const preset = createEmailStudioPresetDocument(presetKey, metadata.scope);
            replaceDocument(preset.document, preset.mode, preset.themeKey);
          }} disabled={readOnly} />
          <BlockLibrary blocks={availableBlocks} onInsert={insertBlock} disabled={readOnly} />
        </div>

        <Card className="min-w-0">
          <CardHeader><CardTitle>Composer</CardTitle><CardDescription>{readOnly ? 'Published and archived content is review-only.' : 'Current editor state is exported fresh before every save or publish.'}</CardDescription></CardHeader>
          <CardContent><div className="rounded-lg border bg-background p-3">
            <EmailEditor
              key={`${template?.id || 'new'}-${mode}-${editorKey}`}
              ref={editorRef}
              content={content}
              extensions={TEMPLATE_EXTENSIONS}
              placeholder="Write the email or press / for editor commands"
              className="min-h-[620px]"
              onReady={() => { editorRef.current?.editor?.setEditable(!readOnly); setStatus('ready'); }}
              onUpdate={() => {
                const document = currentEditorDocument(editorRef.current, content);
                setValidation(validateEmailStudioEditorDocument(document, mode, metadata.scope));
                setSnapshot(null);
                setStatus('dirty');
              }}
            />
          </div></CardContent>
        </Card>

        <div className="space-y-5">
          <EmailStudioInspector scope={metadata.scope} mode={mode} themeKey={themeKey} preheader={preheader} readOnly={readOnly} onPreheaderChange={(value) => { setPreheader(value); setSnapshot(null); setStatus('dirty'); }} />
          <VariablePicker variables={variables} onInsert={insertVariable} disabled={readOnly} />
          <ValidationPanel validation={validation} error={null} />
        </div>
      </div>

      <EmailAssetManager context={context} onInsert={readOnly ? undefined : insertAsset} />

      <Card>
        <CardHeader><CardTitle>Published version history</CardTitle><CardDescription>Immutable snapshots remain available even when the template identity is reopened or archived.</CardDescription></CardHeader>
        <CardContent>
          {versions.length === 0 ? <p className="text-sm text-muted-foreground">No immutable versions have been published.</p> : (
            <div className="divide-y rounded-md border">
              {versions.map((version) => <div key={version.id} className="flex flex-wrap items-start justify-between gap-3 p-4"><div><p className="font-medium">Version {version.versionNumber}</p><p className="text-sm text-muted-foreground">{version.changeSummary || 'No change summary'} · {new Date(version.publishedAt).toLocaleString()}</p></div><div className="flex flex-wrap gap-2"><Badge variant="outline">{version.mode}</Badge><Badge variant="outline">{version.themeKey}</Badge><Badge variant="outline">{version.renderHash}</Badge></div></div>)}
            </div>
          )}
        </CardContent>
      </Card>

      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} snapshot={snapshot} />
    </div>
  );
}

function currentEditorDocument(ref: EmailEditorRef | null, fallback: EmailEditorDocument): EmailEditorDocument {
  const value = ref?.getJSON();
  return value ? cloneEmailStudioDocument(value as unknown as EmailEditorDocument) : cloneEmailStudioDocument(fallback);
}

function applyTheme(document: EmailEditorDocument, themeKey: EmailStudioThemeKey): EmailEditorDocument {
  const visit = (node: EmailEditorNode): EmailEditorNode => ({
    ...node,
    attrs: node.type === 'emailStudioBlock' ? { ...node.attrs, themeKey } : node.attrs,
    content: node.content?.map(visit),
  });
  return visit(document) as EmailEditorDocument;
}

void EMAIL_STUDIO_THEMES;
