import { useMemo, useRef, useState } from 'react';
import { EmailEditor, type EmailEditorRef } from '@react-email/editor';
import { StarterKit } from '@react-email/editor/extensions';
import { EmailTheming } from '@react-email/editor/plugins';
import {
  AlertTriangle,
  Blocks,
  Braces,
  CheckCircle2,
  Eye,
  FileOutput,
  LayoutTemplate,
  Lock,
  Palette,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  createEmailContentDraftFromEditorExport,
  createEmailValidationResult,
  finalizeEmailContentDocument,
  getEmailVariablesForScope,
  type EmailContentDocument,
  type EmailContentMode,
  type EmailContentScope,
  type EmailEditorDocument,
  type EmailEditorNode,
  type EmailValidationResult,
} from '../contracts';
import {
  EMAIL_STUDIO_MODE_LABELS,
  EMAIL_STUDIO_THEME_KEYS,
  EMAIL_STUDIO_THEMES,
  getEmailStudioBlocksForMode,
  type EmailStudioBlockDefinition,
  type EmailStudioThemeKey,
} from './config';
import {
  cloneEmailStudioDocument,
  createEmailStudioBlockNode,
  createEmailStudioDocument,
  createEmailStudioPresetDocument,
  EMAIL_STUDIO_PRESETS,
} from './documents';
import { EmailStudioBlock, EmailStudioVariable } from './extensions';
import { validateEmailStudioDraft, validateEmailStudioEditorDocument } from './validation';

const STUDIO_EXTENSIONS = [
  StarterKit,
  EmailTheming.configure({ theme: 'basic' }),
  EmailStudioBlock,
  EmailStudioVariable,
];

export type EmailStudioStatus = 'loading' | 'ready' | 'dirty' | 'exporting' | 'exported' | 'invalid';

export type EmailStudioProps = {
  scope: EmailContentScope;
  initialMode?: EmailContentMode;
  allowedModes?: readonly EmailContentMode[];
  initialDocument?: EmailEditorDocument;
  initialPreheader?: string;
  initialThemeKey?: EmailStudioThemeKey;
  readOnly?: boolean;
  onExport?: (document: EmailContentDocument) => void;
};

export function EmailStudio({
  scope,
  initialMode = 'direct',
  allowedModes = ['direct', 'campaign', 'newsletter'],
  initialDocument,
  initialPreheader = '',
  initialThemeKey = 'valorwell',
  readOnly = false,
  onExport,
}: EmailStudioProps) {
  const editorRef = useRef<EmailEditorRef>(null);
  const [mode, setMode] = useState<EmailContentMode>(initialMode);
  const [themeKey, setThemeKey] = useState<EmailStudioThemeKey>(initialThemeKey);
  const [content, setContent] = useState<EmailEditorDocument>(() =>
    cloneEmailStudioDocument(
      initialDocument || createEmailStudioDocument({ mode: initialMode, scope, themeKey: initialThemeKey }),
    ),
  );
  const [preheader, setPreheader] = useState(initialPreheader);
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState<EmailStudioStatus>('loading');
  const [validation, setValidation] = useState<EmailValidationResult>(() => createEmailValidationResult([]));
  const [snapshot, setSnapshot] = useState<EmailContentDocument | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableBlocks = useMemo(() => getEmailStudioBlocksForMode(mode), [mode]);
  const variables = useMemo(() => getEmailVariablesForScope(scope), [scope]);

  const replaceDocument = (
    nextDocument: EmailEditorDocument,
    nextMode = mode,
    nextThemeKey = themeKey,
  ) => {
    setMode(nextMode);
    setThemeKey(nextThemeKey);
    setContent(cloneEmailStudioDocument(nextDocument));
    setSnapshot(null);
    setValidation(validateEmailStudioEditorDocument(nextDocument, nextMode, scope));
    setError(null);
    setStatus('loading');
    setEditorKey((value) => value + 1);
  };

  const changeMode = (nextMode: EmailContentMode) => {
    replaceDocument(createEmailStudioDocument({ mode: nextMode, scope, themeKey }), nextMode, themeKey);
  };

  const changeTheme = (nextThemeKey: EmailStudioThemeKey) => {
    const current = getCurrentEditorDocument(editorRef.current, content);
    replaceDocument(applyThemeToDocument(current, nextThemeKey), mode, nextThemeKey);
  };

  const applyPreset = (presetKey: string) => {
    const preset = createEmailStudioPresetDocument(presetKey, scope);
    replaceDocument(preset.document, preset.mode, preset.themeKey);
  };

  const insertBlock = (definition: EmailStudioBlockDefinition) => {
    if (readOnly) return;
    editorRef.current?.editor
      ?.chain()
      .focus()
      .insertContent(createEmailStudioBlockNode(definition, themeKey))
      .run();
  };

  const insertVariable = (key: string) => {
    if (readOnly) return;
    const definition = variables.find((entry) => entry.key === key);
    if (!definition) return;
    editorRef.current?.editor
      ?.chain()
      .focus()
      .insertContent({
        type: 'emailVariable',
        attrs: { key: definition.key, label: definition.label },
      })
      .run();
  };

  const resetDocument = () => {
    replaceDocument(createEmailStudioDocument({ mode, scope, themeKey }), mode, themeKey);
  };

  const exportContent = async (openPreview: boolean) => {
    const ref = editorRef.current;
    if (!ref) return;

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
      const studioValidation = validateEmailStudioDraft(draft, scope);
      setValidation(studioValidation);

      if (!studioValidation.valid) {
        setStatus('invalid');
        setSnapshot(null);
        return;
      }

      const finalized = await finalizeEmailContentDocument(draft, scope);
      if (!finalized.document) {
        setValidation(finalized.validation);
        setStatus('invalid');
        setSnapshot(null);
        return;
      }

      setContent(cloneEmailStudioDocument(editorDocument));
      setSnapshot(finalized.document);
      setStatus('exported');
      onExport?.(finalized.document);
      if (openPreview) setPreviewOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email Studio export failed.');
      setStatus('dirty');
    }
  };

  return (
    <div className="space-y-5">
      <EmailStudioToolbar
        mode={mode}
        allowedModes={allowedModes}
        themeKey={themeKey}
        status={status}
        readOnly={readOnly}
        onModeChange={changeMode}
        onThemeChange={changeTheme}
        onPreview={() => void exportContent(true)}
        onExport={() => void exportContent(false)}
        onReset={resetDocument}
      />

      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <TemplatePicker onSelect={applyPreset} disabled={readOnly} />
          <BlockLibrary blocks={availableBlocks} onInsert={insertBlock} disabled={readOnly} />
        </div>

        <ComposerField
          editorRef={editorRef}
          editorKey={editorKey}
          mode={mode}
          content={content}
          readOnly={readOnly}
          onReady={() => {
            editorRef.current?.editor?.setEditable(!readOnly);
            setStatus('ready');
          }}
          onUpdate={() => {
            const document = getCurrentEditorDocument(editorRef.current, content);
            setValidation(validateEmailStudioEditorDocument(document, mode, scope));
            setSnapshot(null);
            setStatus('dirty');
          }}
        />

        <div className="space-y-5">
          <EmailStudioInspector
            scope={scope}
            mode={mode}
            themeKey={themeKey}
            preheader={preheader}
            readOnly={readOnly}
            onPreheaderChange={(value) => {
              setPreheader(value);
              setSnapshot(null);
              setStatus('dirty');
            }}
          />
          <VariablePicker variables={variables} onInsert={insertVariable} disabled={readOnly} />
          <ValidationPanel validation={validation} error={error} />
        </div>
      </div>

      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        snapshot={snapshot}
      />
    </div>
  );
}

export function EmailStudioToolbar({
  mode,
  allowedModes,
  themeKey,
  status,
  readOnly,
  onModeChange,
  onThemeChange,
  onPreview,
  onExport,
  onReset,
}: {
  mode: EmailContentMode;
  allowedModes: readonly EmailContentMode[];
  themeKey: EmailStudioThemeKey;
  status: EmailStudioStatus;
  readOnly: boolean;
  onModeChange: (mode: EmailContentMode) => void;
  onThemeChange: (theme: EmailStudioThemeKey) => void;
  onPreview: () => void;
  onExport: () => void;
  onReset: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[190px] space-y-1.5">
          <Label>Authoring mode</Label>
          <Select value={mode} onValueChange={(value) => onModeChange(value as EmailContentMode)} disabled={readOnly}>
            <SelectTrigger aria-label="Email authoring mode"><SelectValue /></SelectTrigger>
            <SelectContent>
              {allowedModes.map((entry) => (
                <SelectItem key={entry} value={entry}>{EMAIL_STUDIO_MODE_LABELS[entry]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[190px] space-y-1.5">
          <Label>Theme</Label>
          <Select value={themeKey} onValueChange={(value) => onThemeChange(value as EmailStudioThemeKey)} disabled={readOnly}>
            <SelectTrigger aria-label="Email theme"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EMAIL_STUDIO_THEME_KEYS.map((key) => (
                <SelectItem key={key} value={key}>{EMAIL_STUDIO_THEMES[key].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge variant={status === 'exported' ? 'default' : status === 'invalid' ? 'destructive' : 'secondary'}>
          {readOnly ? <Lock className="mr-1 h-3 w-3" /> : null}
          {readOnly ? 'read only' : status}
        </Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onReset} disabled={readOnly}>
            <RefreshCw className="mr-2 h-4 w-4" />Reset
          </Button>
          <Button type="button" variant="outline" onClick={onPreview} disabled={status === 'exporting'}>
            <Eye className="mr-2 h-4 w-4" />Preview
          </Button>
          <Button type="button" onClick={onExport} disabled={status === 'exporting'}>
            <FileOutput className="mr-2 h-4 w-4" />
            {status === 'exporting' ? 'Exporting…' : 'Export canonical content'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ComposerField({
  editorRef,
  editorKey,
  mode,
  content,
  readOnly,
  onReady,
  onUpdate,
}: {
  editorRef: React.RefObject<EmailEditorRef>;
  editorKey: number;
  mode: EmailContentMode;
  content: EmailEditorDocument;
  readOnly: boolean;
  onReady: () => void;
  onUpdate: () => void;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="h-4 w-4" />Composer
        </CardTitle>
        <CardDescription>
          {readOnly ? 'This content is available for inspection and export only.' : 'Write directly or insert controlled blocks and variables.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border bg-background p-3">
          <EmailEditor
            key={`${mode}-${editorKey}`}
            ref={editorRef}
            content={content}
            extensions={STUDIO_EXTENSIONS}
            placeholder="Write the email or press / for editor commands"
            className="min-h-[620px]"
            onReady={onReady}
            onUpdate={onUpdate}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function TemplatePicker({ onSelect, disabled }: { onSelect: (key: string) => void; disabled: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><LayoutTemplate className="h-4 w-4" />Starter layout</CardTitle>
        <CardDescription>Replace the current document with a controlled starter.</CardDescription>
      </CardHeader>
      <CardContent>
        <Select onValueChange={onSelect} disabled={disabled}>
          <SelectTrigger aria-label="Email starter layout"><SelectValue placeholder="Choose a layout" /></SelectTrigger>
          <SelectContent>
            {EMAIL_STUDIO_PRESETS.map((preset) => (
              <SelectItem key={preset.key} value={preset.key}>{preset.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}

export function BlockLibrary({
  blocks,
  onInsert,
  disabled,
}: {
  blocks: readonly EmailStudioBlockDefinition[];
  onInsert: (block: EmailStudioBlockDefinition) => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Blocks className="h-4 w-4" />Block library</CardTitle>
        <CardDescription>Only blocks permitted by the selected mode are shown.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[520px] pr-3">
          <div className="space-y-2">
            {blocks.map((block) => (
              <Button
                key={block.kind}
                type="button"
                variant="outline"
                className="h-auto w-full justify-start whitespace-normal p-3 text-left"
                onClick={() => onInsert(block)}
                disabled={disabled}
              >
                <span>
                  <span className="block font-medium">{block.label}</span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">{block.description}</span>
                </span>
              </Button>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export function EmailStudioInspector({
  scope,
  mode,
  themeKey,
  preheader,
  readOnly,
  onPreheaderChange,
}: {
  scope: EmailContentScope;
  mode: EmailContentMode;
  themeKey: EmailStudioThemeKey;
  preheader: string;
  readOnly: boolean;
  onPreheaderChange: (value: string) => void;
}) {
  const theme = EMAIL_STUDIO_THEMES[themeKey];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Inspector</CardTitle>
        <CardDescription>Canonical metadata and current policy context.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{scope}</Badge>
          <Badge variant="outline">{EMAIL_STUDIO_MODE_LABELS[mode]}</Badge>
          <Badge variant="outline">{theme.label}</Badge>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email-studio-preheader">Preview text</Label>
          <Input
            id="email-studio-preheader"
            value={preheader}
            maxLength={240}
            disabled={readOnly}
            onChange={(event) => onPreheaderChange(event.target.value)}
            placeholder="Inbox preview text"
          />
          <p className="text-xs text-muted-foreground">{preheader.length}/200 recommended characters</p>
        </div>
        <div className="rounded-md border p-3 text-xs text-muted-foreground">
          <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
            <ShieldCheck className="h-4 w-4" />Export boundary
          </div>
          Browser export remains non-authoritative until server validation accepts the canonical JSON, HTML, text, scope, mode, and render hash.
        </div>
      </CardContent>
    </Card>
  );
}

export function VariablePicker({
  variables,
  onInsert,
  disabled,
}: {
  variables: ReturnType<typeof getEmailVariablesForScope>;
  onInsert: (key: string) => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Braces className="h-4 w-4" />Variables</CardTitle>
        <CardDescription>Scope-safe structured personalization tokens.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {variables.map((variable) => (
          <Button key={variable.key} type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onInsert(variable.key)}>
            {variable.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

export function ValidationPanel({ validation, error }: { validation: EmailValidationResult; error: string | null }) {
  const clean = !error && validation.issues.length === 0;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {validation.valid && !error ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          Validation
        </CardTitle>
        <CardDescription>{validation.errors.length} errors · {validation.warnings.length} warnings</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        {clean ? <p className="text-sm text-muted-foreground">No current policy issues.</p> : null}
        {validation.issues.map((issue, index) => (
          <div key={`${issue.code}-${issue.path || ''}-${index}`} className="rounded-md border p-3 text-sm">
            <div className="flex items-start gap-2">
              {issue.severity === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" /> : <ShieldCheck className="mt-0.5 h-4 w-4 text-amber-600" />}
              <div>
                <p>{issue.message}</p>
                {issue.path ? <p className="mt-1 text-xs text-muted-foreground">{issue.path}</p> : null}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function PreviewDialog({
  open,
  onOpenChange,
  snapshot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: EmailContentDocument | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Email preview</DialogTitle>
          <DialogDescription>Sandboxed HTML, plain text, canonical JSON, and render hash.</DialogDescription>
        </DialogHeader>
        {!snapshot ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No valid export is available.</p>
        ) : (
          <Tabs defaultValue="preview">
            <TabsList className="flex h-auto flex-wrap">
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="text">Plain text</TabsTrigger>
              <TabsTrigger value="html">HTML</TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
            </TabsList>
            <TabsContent value="preview">
              <iframe title="Sandboxed Email Studio preview" sandbox="" srcDoc={snapshot.renderedHtml} className="h-[620px] w-full rounded-md border bg-white" />
            </TabsContent>
            <TabsContent value="text">
              <pre className="max-h-[620px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-4 text-xs">{snapshot.renderedText}</pre>
            </TabsContent>
            <TabsContent value="html">
              <pre className="max-h-[620px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-4 text-xs">{snapshot.renderedHtml}</pre>
            </TabsContent>
            <TabsContent value="json" className="space-y-3">
              <Badge variant="outline">render hash: {snapshot.renderHash}</Badge>
              <pre className="max-h-[580px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-4 text-xs">{JSON.stringify(snapshot, null, 2)}</pre>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function getCurrentEditorDocument(ref: EmailEditorRef | null, fallback: EmailEditorDocument): EmailEditorDocument {
  const value = ref?.getJSON();
  return value ? cloneEmailStudioDocument(value as unknown as EmailEditorDocument) : cloneEmailStudioDocument(fallback);
}

function applyThemeToDocument(document: EmailEditorDocument, themeKey: EmailStudioThemeKey): EmailEditorDocument {
  const visit = (node: EmailEditorNode): EmailEditorNode => ({
    ...node,
    attrs: node.type === 'emailStudioBlock' ? { ...node.attrs, themeKey } : node.attrs,
    content: node.content?.map(visit),
  });
  return visit(document) as EmailEditorDocument;
}
