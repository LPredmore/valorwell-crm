import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EmailEditor, type EmailEditorRef } from '@react-email/editor';
import { StarterKit } from '@react-email/editor/extensions';
import { EmailTheming } from '@react-email/editor/plugins';
import {
  Copy,
  ImagePlus,
  Lock,
  MoveDown,
  MoveUp,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmailAssetManager } from '../templates/EmailAssetManager';
import { getEmailStudioAccessContext } from '../templates/api';
import type { EmailStudioAccessContext } from '../templates/types';
import {
  createEmailContentDraftFromEditorExport,
  finalizeEmailContentDocument,
  getEmailVariablesForScope,
  type EmailContentDocument,
  type EmailContentScope,
  type EmailEditorDocument,
  type EmailEditorNode,
  type EmailValidationResult,
} from '../contracts';
import {
  BlockLibrary,
  ComposerField,
  EmailStudioInspector,
  EmailStudioToolbar,
  PreviewDialog,
  ValidationPanel,
  VariablePicker,
  type EmailStudioStatus,
} from '../studio/EmailStudio';
import {
  EMAIL_STUDIO_BLOCKS,
  getEmailStudioBlocksForMode,
  type EmailStudioBlockDefinition,
  type EmailStudioThemeKey,
} from '../studio/config';
import {
  cloneEmailStudioDocument,
  createEmailStudioBlockNode,
  createEmailStudioDocument,
} from '../studio/documents';
import { EmailStudioBlock, EmailStudioVariable } from '../studio/extensions';
import {
  validateEmailStudioDraft,
  validateEmailStudioEditorDocument,
} from '../studio/validation';
import {
  deleteSelectedNewsletterBlock,
  duplicateSelectedNewsletterBlock,
  getSelectedNewsletterBlock,
  moveSelectedNewsletterBlock,
  newsletterBlockSupportsImage,
  newsletterBlockSupportsLink,
  updateSelectedNewsletterBlock,
  type NewsletterBlockPatch,
  type NewsletterSelectedBlock,
} from './newsletterVisualEditing';

const NEWSLETTER_EXTENSIONS = [
  StarterKit,
  EmailTheming.configure({ theme: 'basic' }),
  EmailStudioBlock,
  EmailStudioVariable,
];

export type ClientNewsletterEmailStudioHandle = {
  exportContent: () => Promise<EmailContentDocument | null>;
};

export type ClientNewsletterEmailStudioComposerProps = {
  initialContent?: EmailContentDocument | null;
  readOnly?: boolean;
  scope?: EmailContentScope;
  onDirty?: () => void;
};

export const ClientNewsletterEmailStudioComposer = forwardRef<
  ClientNewsletterEmailStudioHandle,
  ClientNewsletterEmailStudioComposerProps
>(function ClientNewsletterEmailStudioComposer({
  initialContent,
  readOnly = false,
  scope = 'client',
  onDirty,
}, ref) {
  const editorRef = useRef<EmailEditorRef>(null);
  const selectionCleanupRef = useRef<(() => void) | null>(null);
  const initialThemeKey = normalizeThemeKey(initialContent?.themeKey);
  const initialDocument = initialContent?.mode === 'newsletter' && initialContent.editorDocument
    ? initialContent.editorDocument
    : createEmailStudioDocument({ mode: 'newsletter', scope, themeKey: initialThemeKey });

  const [themeKey, setThemeKey] = useState<EmailStudioThemeKey>(initialThemeKey);
  const [content, setContent] = useState<EmailEditorDocument>(() => cloneEmailStudioDocument(initialDocument));
  const [preheader, setPreheader] = useState(initialContent?.preheader || '');
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState<EmailStudioStatus>('loading');
  const [validation, setValidation] = useState<EmailValidationResult>(() =>
    validateEmailStudioEditorDocument(initialDocument, 'newsletter', scope),
  );
  const [snapshot, setSnapshot] = useState<EmailContentDocument | null>(initialContent?.mode === 'newsletter' ? initialContent : null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<NewsletterSelectedBlock | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [assetContext, setAssetContext] = useState<EmailStudioAccessContext | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);

  const blocks = useMemo(() => getEmailStudioBlocksForMode('newsletter'), []);
  const variables = useMemo(() => getEmailVariablesForScope(scope), [scope]);

  useEffect(() => {
    let active = true;
    void getEmailStudioAccessContext()
      .then((context) => {
        if (active) setAssetContext(context);
      })
      .catch((caught) => {
        if (active) setAssetError(caught instanceof Error ? caught.message : 'Email image library is unavailable.');
      });
    return () => {
      active = false;
      selectionCleanupRef.current?.();
    };
  }, []);

  const markDirty = () => {
    setSnapshot(null);
    setStatus('dirty');
    onDirty?.();
  };

  const syncEditorControls = () => {
    const editor = editorRef.current?.editor ?? null;
    setSelectedBlock(getSelectedNewsletterBlock(editor));
    setCanUndo(Boolean(editor?.can().undo()));
    setCanRedo(Boolean(editor?.can().redo()));
  };

  const attachEditorControls = () => {
    selectionCleanupRef.current?.();
    const editor = editorRef.current?.editor;
    if (!editor) return;
    const sync = () => syncEditorControls();
    editor.on('selectionUpdate', sync);
    editor.on('transaction', sync);
    selectionCleanupRef.current = () => {
      editor.off('selectionUpdate', sync);
      editor.off('transaction', sync);
    };
    sync();
  };

  const replaceDocument = (nextDocument: EmailEditorDocument, nextThemeKey = themeKey) => {
    setThemeKey(nextThemeKey);
    setContent(cloneEmailStudioDocument(nextDocument));
    setSnapshot(null);
    setSelectedBlock(null);
    setValidation(validateEmailStudioEditorDocument(nextDocument, 'newsletter', scope));
    setError(null);
    setStatus('loading');
    setEditorKey((value) => value + 1);
    onDirty?.();
  };

  const exportContent = async (openPreview = false): Promise<EmailContentDocument | null> => {
    const current = editorRef.current;
    if (!current) {
      setError('The Newsletter Email Studio editor is not ready.');
      return null;
    }

    setStatus('exporting');
    setError(null);
    try {
      const { html, text } = await current.getEmail();
      const editorDocument = current.getJSON() as unknown as EmailEditorDocument;
      const draft = createEmailContentDraftFromEditorExport({
        mode: 'newsletter',
        editorDocument,
        html,
        text,
        preheader,
        themeKey,
      });
      const studioValidation = validateEmailStudioDraft(draft, scope);
      setValidation(studioValidation);
      if (!studioValidation.valid) {
        setSnapshot(null);
        setStatus('invalid');
        return null;
      }

      const finalized = await finalizeEmailContentDocument(draft, scope);
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
      setError(caught instanceof Error ? caught.message : 'Newsletter Email Studio export failed.');
      setStatus('dirty');
      return null;
    }
  };

  useImperativeHandle(ref, () => ({
    exportContent: () => exportContent(false),
  }));

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

  const updateBlock = (patch: NewsletterBlockPatch) => {
    if (readOnly) return;
    if (updateSelectedNewsletterBlock(editorRef.current?.editor ?? null, patch)) {
      syncEditorControls();
    }
  };

  const runEditorAction = (action: () => boolean) => {
    if (readOnly) return;
    if (action()) syncEditorControls();
  };

  return (
    <div className="space-y-4">
      <EmailStudioToolbar
        mode="newsletter"
        allowedModes={['newsletter']}
        themeKey={themeKey}
        status={status}
        readOnly={readOnly}
        onModeChange={() => undefined}
        onThemeChange={(nextTheme) => {
          const current = getCurrentDocument(editorRef.current, content);
          replaceDocument(applyTheme(current, nextTheme), nextTheme);
        }}
        onPreview={() => void exportContent(true)}
        onExport={() => void exportContent(false)}
        onReset={() => {
          setPreheader('');
          replaceDocument(createEmailStudioDocument({ mode: 'newsletter', scope, themeKey }));
        }}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <span className="mr-2 text-sm font-medium">Editing</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly || !canUndo}
            onClick={() => runEditorAction(() => Boolean(editorRef.current?.editor?.chain().focus().undo().run()))}
          >
            <Undo2 className="mr-2 h-4 w-4" />Undo
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly || !canRedo}
            onClick={() => runEditorAction(() => Boolean(editorRef.current?.editor?.chain().focus().redo().run()))}
          >
            <Redo2 className="mr-2 h-4 w-4" />Redo
          </Button>
          <p className="ml-auto text-xs text-muted-foreground">Select a structured block in the canvas to edit its content and image.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
        <BlockLibrary blocks={blocks} onInsert={insertBlock} disabled={readOnly} />
        <ComposerField
          editorRef={editorRef}
          editorKey={editorKey}
          mode="newsletter"
          content={content}
          readOnly={readOnly}
          onReady={() => {
            editorRef.current?.editor?.setEditable(!readOnly);
            attachEditorControls();
            setStatus('ready');
          }}
          onUpdate={() => {
            const document = getCurrentDocument(editorRef.current, content);
            setValidation(validateEmailStudioEditorDocument(document, 'newsletter', scope));
            markDirty();
          }}
        />
        <div className="space-y-4">
          <NewsletterBlockInspector
            selectedBlock={selectedBlock}
            readOnly={readOnly}
            onChange={updateBlock}
            onMoveUp={() => runEditorAction(() => moveSelectedNewsletterBlock(editorRef.current?.editor ?? null, 'up'))}
            onMoveDown={() => runEditorAction(() => moveSelectedNewsletterBlock(editorRef.current?.editor ?? null, 'down'))}
            onDuplicate={() => runEditorAction(() => duplicateSelectedNewsletterBlock(editorRef.current?.editor ?? null))}
            onDelete={() => runEditorAction(() => deleteSelectedNewsletterBlock(editorRef.current?.editor ?? null))}
            onOpenAssets={() => setAssetDialogOpen(true)}
          />
          <EmailStudioInspector
            scope={scope}
            mode="newsletter"
            themeKey={themeKey}
            preheader={preheader}
            readOnly={readOnly}
            onPreheaderChange={(value) => {
              setPreheader(value);
              markDirty();
            }}
          />
          <VariablePicker variables={variables} onInsert={insertVariable} disabled={readOnly} />
          <ValidationPanel validation={validation} error={error} />
        </div>
      </div>

      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} snapshot={snapshot} />

      <Dialog open={assetDialogOpen} onOpenChange={setAssetDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose newsletter image</DialogTitle>
            <DialogDescription>Use an existing tenant image or upload a new email-safe asset.</DialogDescription>
          </DialogHeader>
          {assetError ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{assetError}</p> : null}
          {!assetContext && !assetError ? <p className="p-6 text-center text-sm text-muted-foreground">Loading image library…</p> : null}
          {assetContext ? (
            <EmailAssetManager
              context={assetContext}
              compact
              onInsert={(asset) => {
                updateBlock({ imageUrl: asset.publicUrl, altText: asset.altText || selectedBlock?.altText || '' });
                setAssetDialogOpen(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
});

function NewsletterBlockInspector({
  selectedBlock,
  readOnly,
  onChange,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
  onOpenAssets,
}: {
  selectedBlock: NewsletterSelectedBlock | null;
  readOnly: boolean;
  onChange: (patch: NewsletterBlockPatch) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenAssets: () => void;
}) {
  if (!selectedBlock) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Block settings</CardTitle>
          <CardDescription>Select a structured block in the canvas to edit it visually.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Text can still be edited directly in the canvas. Hero, story, CTA, resource, image, footer, and other structured blocks are edited here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const definition = EMAIL_STUDIO_BLOCKS.find((entry) => entry.kind === selectedBlock.kind);
  const supportsImage = newsletterBlockSupportsImage(selectedBlock.kind);
  const supportsLink = newsletterBlockSupportsLink(selectedBlock.kind);
  const editable = !readOnly && !selectedBlock.locked;
  const hasTextFields = selectedBlock.kind !== 'divider';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{definition?.label ?? selectedBlock.kind}</CardTitle>
            <CardDescription>{definition?.description ?? 'Edit the selected newsletter block.'}</CardDescription>
          </div>
          {selectedBlock.locked ? <Badge variant="secondary"><Lock className="mr-1 h-3 w-3" />Locked</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!editable || !selectedBlock.canMoveUp} onClick={onMoveUp}>
            <MoveUp className="mr-1 h-3.5 w-3.5" />Up
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!editable || !selectedBlock.canMoveDown} onClick={onMoveDown}>
            <MoveDown className="mr-1 h-3.5 w-3.5" />Down
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!editable} onClick={onDuplicate}>
            <Copy className="mr-1 h-3.5 w-3.5" />Duplicate
          </Button>
          <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={!editable} onClick={onDelete}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
          </Button>
        </div>

        {selectedBlock.locked ? (
          <p className="rounded-md border p-3 text-xs text-muted-foreground">
            This block is required by newsletter policy and cannot be edited, duplicated, moved, or deleted.
          </p>
        ) : null}

        {hasTextFields ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="newsletter-block-title">Title</Label>
              <Input
                id="newsletter-block-title"
                value={selectedBlock.title}
                disabled={!editable}
                onChange={(event) => onChange({ title: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newsletter-block-body">Body</Label>
              <Textarea
                id="newsletter-block-body"
                value={selectedBlock.body}
                disabled={!editable}
                rows={5}
                onChange={(event) => onChange({ body: event.target.value })}
              />
            </div>
          </>
        ) : null}

        {supportsLink ? (
          <div className="space-y-1.5">
            <Label htmlFor="newsletter-block-link">Destination URL</Label>
            <Input
              id="newsletter-block-link"
              value={selectedBlock.href}
              disabled={!editable}
              inputMode="url"
              placeholder="https://valorwell.org/..."
              onChange={(event) => onChange({ href: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">Enter an external destination only when this block should be clickable.</p>
          </div>
        ) : null}

        {supportsImage ? (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="newsletter-block-image">Image</Label>
              <Button type="button" size="sm" variant="outline" disabled={!editable} onClick={onOpenAssets}>
                <ImagePlus className="mr-2 h-4 w-4" />Choose / upload
              </Button>
            </div>
            {selectedBlock.imageUrl ? (
              <img src={selectedBlock.imageUrl} alt={selectedBlock.altText} className="max-h-40 w-full rounded-md border object-contain" />
            ) : null}
            <Input
              id="newsletter-block-image"
              value={selectedBlock.imageUrl}
              disabled={!editable}
              inputMode="url"
              placeholder="https://..."
              onChange={(event) => onChange({ imageUrl: event.target.value })}
            />
            <div className="space-y-1.5">
              <Label htmlFor="newsletter-block-alt">Alt text</Label>
              <Input
                id="newsletter-block-alt"
                value={selectedBlock.altText}
                disabled={!editable}
                maxLength={240}
                placeholder="Describe the image"
                onChange={(event) => onChange({ altText: event.target.value })}
              />
            </div>
            {selectedBlock.imageUrl ? (
              <Button type="button" size="sm" variant="ghost" disabled={!editable} onClick={() => onChange({ imageUrl: '', altText: '' })}>
                Remove image
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function getCurrentDocument(
  ref: EmailEditorRef | null,
  fallback: EmailEditorDocument,
): EmailEditorDocument {
  const value = ref?.getJSON();
  return value
    ? cloneEmailStudioDocument(value as unknown as EmailEditorDocument)
    : cloneEmailStudioDocument(fallback);
}

function applyTheme(document: EmailEditorDocument, themeKey: EmailStudioThemeKey): EmailEditorDocument {
  const visit = (node: EmailEditorNode): EmailEditorNode => ({
    ...node,
    attrs: node.type === 'emailStudioBlock' ? { ...node.attrs, themeKey } : node.attrs,
    content: node.content?.map(visit),
  });
  return visit(document) as EmailEditorDocument;
}

function normalizeThemeKey(value: string | undefined): EmailStudioThemeKey {
  if (value === 'valorwell' || value === 'ocs' || value === 'bty' || value === 'plain-outreach') {
    return value;
  }
  return 'valorwell';
}
