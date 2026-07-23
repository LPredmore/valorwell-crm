import { useMemo, useRef, useState } from 'react';
import { EmailEditor, type EmailEditorRef } from '@react-email/editor';
import { StarterKit } from '@react-email/editor/extensions';
import { EmailTheming } from '@react-email/editor/plugins';
import { Braces, FileOutput, Info, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  cloneEmailStudioSpikeDocument,
  collectEmailStudioVariableKeys,
  createEmailStudioSpikeDocument,
} from './documents';
import { EmailVariable, ValorWellCallout } from './extensions';
import {
  EMAIL_STUDIO_RENDERING_DECISION,
  EMAIL_STUDIO_SPIKE_MODES,
  EMAIL_STUDIO_SPIKE_VARIABLES,
  type EmailStudioSpikeDocument,
  type EmailStudioSpikeMode,
  type EmailStudioSpikeSnapshot,
} from './types';

const SPIKE_EXTENSIONS = [
  StarterKit,
  EmailTheming.configure({ theme: 'basic' }),
  ValorWellCallout,
  EmailVariable,
];

const MODE_LABELS: Record<EmailStudioSpikeMode, string> = {
  direct: 'Direct Email',
  campaign: 'Campaign Email',
  newsletter: 'Newsletter',
};

export function EmailStudioSpike() {
  const editorRef = useRef<EmailEditorRef>(null);
  const [mode, setMode] = useState<EmailStudioSpikeMode>('direct');
  const [content, setContent] = useState<EmailStudioSpikeDocument>(() =>
    createEmailStudioSpikeDocument('direct'),
  );
  const [editorKey, setEditorKey] = useState(0);
  const [preheader, setPreheader] = useState('A controlled ValorWell email-editor proof.');
  const [snapshot, setSnapshot] = useState<EmailStudioSpikeSnapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'dirty' | 'exporting' | 'exported'>('loading');
  const [error, setError] = useState<string | null>(null);

  const variableKeys = useMemo(
    () => (snapshot ? collectEmailStudioVariableKeys(snapshot.editorDocument) : []),
    [snapshot],
  );

  const resetForMode = (nextMode: EmailStudioSpikeMode) => {
    setMode(nextMode);
    setContent(createEmailStudioSpikeDocument(nextMode));
    setSnapshot(null);
    setError(null);
    setStatus('loading');
    setEditorKey((value) => value + 1);
  };

  const exportSnapshot = async () => {
    const ref = editorRef.current;
    if (!ref) return;

    setStatus('exporting');
    setError(null);
    try {
      const { html, text } = await ref.getEmail();
      const editorDocument = ref.getJSON() as unknown as EmailStudioSpikeDocument;
      if (!html.trim() || !text.trim()) {
        throw new Error('The editor returned an empty HTML or plain-text export.');
      }
      setContent(cloneEmailStudioSpikeDocument(editorDocument));
      setSnapshot({ mode, preheader: preheader.trim(), editorDocument, html, text });
      setStatus('exported');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email export failed.');
      setStatus('dirty');
    }
  };

  const reloadExportedJson = () => {
    if (!snapshot) return;
    setContent(cloneEmailStudioSpikeDocument(snapshot.editorDocument));
    setEditorKey((value) => value + 1);
    setStatus('loading');
  };

  const insertCallout = () => {
    editorRef.current?.editor
      ?.chain()
      .focus()
      .insertContent({
        type: 'valorWellCallout',
        content: [{ type: 'text', text: 'A new ValorWell callout block.' }],
      })
      .run();
  };

  const insertVariable = (key: string) => {
    const definition = EMAIL_STUDIO_SPIKE_VARIABLES.find((variable) => variable.key === key);
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Email Studio Pass 1 Spike</CardTitle>
              <CardDescription>
                Isolated React Email Editor proof. It does not read or write campaign, template, or message data.
              </CardDescription>
            </div>
            <Badge variant={status === 'exported' ? 'default' : 'secondary'}>{status}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Prototype mode</Label>
              <Select value={mode} onValueChange={(value) => resetForMode(value as EmailStudioSpikeMode)}>
                <SelectTrigger aria-label="Prototype mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMAIL_STUDIO_SPIKE_MODES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {MODE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-spike-preheader">Preview text</Label>
              <Input
                id="email-spike-preheader"
                value={preheader}
                onChange={(event) => {
                  setPreheader(event.target.value);
                  setStatus('dirty');
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={insertCallout}>
              <Info className="mr-2 h-4 w-4" />
              Insert ValorWell callout
            </Button>
            {EMAIL_STUDIO_SPIKE_VARIABLES.map((variable) => (
              <Button
                key={variable.key}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => insertVariable(variable.key)}
              >
                <Braces className="mr-2 h-4 w-4" />
                {variable.label}
              </Button>
            ))}
          </div>

          <div className="rounded-lg border bg-background p-3">
            <EmailEditor
              key={`${mode}-${editorKey}`}
              ref={editorRef}
              content={content}
              extensions={SPIKE_EXTENSIONS}
              placeholder="Write the email or press / for blocks"
              className="min-h-[420px]"
              onReady={() => setStatus('ready')}
              onUpdate={() => setStatus('dirty')}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={exportSnapshot} disabled={status === 'exporting'}>
              <FileOutput className="mr-2 h-4 w-4" />
              {status === 'exporting' ? 'Exporting…' : 'Export JSON, HTML, and text'}
            </Button>
            <Button type="button" variant="outline" onClick={reloadExportedJson} disabled={!snapshot}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Reload exported JSON
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rendering decision</CardTitle>
          <CardDescription>{EMAIL_STUDIO_RENDERING_DECISION.reason}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export inspection</CardTitle>
          <CardDescription>
            Export once to inspect the immutable JSON snapshot, generated HTML, plain text, and sandboxed preview.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!snapshot ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No export snapshot yet.
            </div>
          ) : (
            <Tabs defaultValue="preview">
              <TabsList className="flex h-auto flex-wrap">
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="text">Plain text</TabsTrigger>
                <TabsTrigger value="html">HTML</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>
              <TabsContent value="preview" className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{MODE_LABELS[snapshot.mode]}</Badge>
                  {variableKeys.map((key) => (
                    <Badge key={key} variant="secondary">{`{{${key}}}`}</Badge>
                  ))}
                </div>
                <iframe
                  title="Sandboxed email preview"
                  sandbox=""
                  srcDoc={snapshot.html}
                  className="h-[560px] w-full rounded-md border bg-white"
                />
              </TabsContent>
              <TabsContent value="text">
                <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-4 text-xs">
                  {snapshot.text}
                </pre>
              </TabsContent>
              <TabsContent value="html">
                <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-4 text-xs">
                  {snapshot.html}
                </pre>
              </TabsContent>
              <TabsContent value="json">
                <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-4 text-xs">
                  {JSON.stringify(snapshot.editorDocument, null, 2)}
                </pre>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
