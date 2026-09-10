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
  Bold,
  Copy,
  Heading2,
  ImagePlus,
  Italic,
  Lock,
  MoveDown,
  MoveUp,
  Redo2,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { PreviewDialog, type EmailStudioStatus } from '../studio/EmailStudio';
import {
  EMAIL_STUDIO_BLOCKS,
  EMAIL_STUDIO_THEME_KEYS,
  EMAIL_STUDIO_THEMES,
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
  getNewsletterBlockAtPosition,
  getSelectedNewsletterBlock,
  moveSelectedNewsletterBlock,
  newsletterBlockSupportsImage,
  newsletterBlockSupportsLink,
  selectNewsletterBlockFromDom,
  updateNewsletterBlockAtPosition,
  type NewsletterBlockPatch,
  type NewsletterSelectedBlock,
} from './newsletterVisualEditing';

const NEWSLETTER_EXTENSIONS = [
  StarterKit,
  EmailTheming.configure({ theme: 'basic' }),
  EmailStudioBlock,
  EmailStudioVariable,
];

const HIDDEN_BUBBLE_MENU_NODES = [
  'paragraph',
  'heading',
  'emailStudioBlock',
  'bulletList',
  'orderedList',
  'listItem',
];

const HIDDEN_BUBBLE_MENU_MARKS = ['link', 'bold', 'italic', 'underline'];

export type ClientNewsletterEmailStudioHandle = {
  exportContent: () => Promise<EmailContentDocument | null>;
  preview: () => Promise<EmailContentDocument | null>;
};

export type ClientNewsletterEmailStudioComposerProps = {
  initialContent?: EmailContentDocument | null;
  readOnly?: boolean;
  scope?: EmailContentScope;
  onDirty?: () => void;
};

type InspectorTab = 'block' | 'email' | 'checks';

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
  const selectedPositionRef = useRef<number | null>(null);
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
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('block');

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

  const applySelectedBlock = (next: NewsletterSelectedBlock | null) => {
    setSelectedBlock((current) => (areNewsletterBlocksEqual(current, next) ? current : next));
  };

  const syncEditorControls = () => {
    const editor = editorRef.current?.editor ?? null;
    const nextSelectedBlock = getSelectedNewsletterBlock(editor);
    if (nextSelectedBlock) {
      selectedPositionRef.current = nextSelectedBlock.from;
      applySelectedBlock(nextSelectedBlock);
      setInspectorTab('block');
    } else if (editor?.isFocused) {
      // Caret moved into free text inside the canvas: no structured block is selected.
      selectedPositionRef.current = null;
      applySelectedBlock(null);
    } else if (selectedPositionRef.current !== null) {
      // Editor lost focus (e.g. typing in the inspector): keep the logical block.
      const stored = getNewsletterBlockAtPosition(editor, selectedPositionRef.current);
      if (stored) applySelectedBlock(stored);
      else {
        selectedPositionRef.current = null;
        applySelectedBlock(null);
      }
    }
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
      setInspectorTab('checks');
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
        setInspectorTab('checks');
        return null;
      }

      const finalized = await finalizeEmailContentDocument(draft, scope);
      if (!finalized.document) {
        setValidation(finalized.validation);
        setSnapshot(null);
        setStatus('invalid');
        setInspectorTab('checks');
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
      setInspectorTab('checks');
      return null;
    }
  };

  useImperativeHandle(ref, () => ({
    exportContent: () => exportContent(false),
    preview: () => exportContent(true),
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
    const editor = editorRef.current?.editor ?? null;
    const position = selectedPositionRef.current ?? selectedBlock?.from ?? null;
    if (position === null) return;
    if (updateNewsletterBlockAtPosition(editor, position, patch)) {
      const updated = getNewsletterBlockAtPosition(editor, position);
      if (updated) applySelectedBlock(updated);
    }
  };

  const runEditorAction = (action: () => boolean) => {
    if (readOnly) return;
    if (action()) syncEditorControls();
  };

  const runFormattingAction = (action: () => boolean) => {
    if (readOnly) return;
    if (action()) {
      syncEditorControls();
      markDirty();
    }
  };

  return (
    <div
      className="grid h-full min-h-0 grid-cols-[190px_minmax(680px,1fr)_310px] bg-muted/30"
      data-testid="newsletter-authoring-layout"
    >
      <aside
        className="min-h-0 overflow-y-auto border-r bg-background p-3"
        data-testid="newsletter-block-library"
      >
        <div className="mb-3">
          <p className="text-sm font-semibold">Blocks</p>
          <p className="text-xs text-muted-foreground">Add an email-safe section.</p>
        </div>
        <div className="space-y-1.5">
          {blocks.map((block) => (
            <Button
              key={block.kind}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start whitespace-normal rounded-md border px-2.5 py-2 text-left"
              onClick={() => insertBlock(block)}
              disabled={readOnly}
              title={block.description}
            >
              <span>
                <span className="block text-sm font-medium">{block.label}</span>
                <span className="mt-0.5 line-clamp-2 block text-[11px] font-normal leading-4 text-muted-foreground">
                  {block.description}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </aside>

      <section
        className="min-h-0 min-w-0 overflow-auto bg-[#e9ece9]"
        data-testid="newsletter-canvas-region"
      >
        <div
          className="sticky top-0 z-20 flex min-h-12 items-center gap-1 border-b bg-background/95 px-3 shadow-sm backdrop-blur"
          data-testid="newsletter-formatting-toolbar"
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={readOnly || !canUndo}
            onClick={() => runEditorAction(() => Boolean(editorRef.current?.editor?.chain().focus().undo().run()))}
            aria-label="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={readOnly || !canRedo}
            onClick={() => runEditorAction(() => Boolean(editorRef.current?.editor?.chain().focus().redo().run()))}
            aria-label="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <span className="mx-1 h-6 w-px bg-border" />
          <Button
            type="button"
            size="sm"
            variant={editorRef.current?.editor?.isActive('bold') ? 'secondary' : 'ghost'}
            disabled={readOnly}
            onClick={() => runFormattingAction(() => Boolean(editorRef.current?.editor?.chain().focus().toggleBold().run()))}
            aria-label="Bold"
          >
            <Bold className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={editorRef.current?.editor?.isActive('italic') ? 'secondary' : 'ghost'}
            disabled={readOnly}
            onClick={() => runFormattingAction(() => Boolean(editorRef.current?.editor?.chain().focus().toggleItalic().run()))}
            aria-label="Italic"
          >
            <Italic className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={editorRef.current?.editor?.isActive('underline') ? 'secondary' : 'ghost'}
            disabled={readOnly}
            onClick={() => runFormattingAction(() => Boolean(editorRef.current?.editor?.chain().focus().toggleUnderline().run()))}
            aria-label="Underline"
          >
            <Underline className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={editorRef.current?.editor?.isActive('heading', { level: 2 }) ? 'secondary' : 'ghost'}
            disabled={readOnly}
            onClick={() => runFormattingAction(() => Boolean(editorRef.current?.editor?.chain().focus().toggleHeading({ level: 2 }).run()))}
            aria-label="Heading"
          >
            <Heading2 className="h-4 w-4" />
          </Button>
          <span className="ml-auto text-xs text-muted-foreground" data-testid="newsletter-canvas-hint">
            Click a section, then edit its text in the Block panel.
          </span>
        </div>

        <div className="min-w-[680px] px-4 py-8">
          <div
            className="mx-auto w-[648px] rounded-xl border border-border/80 bg-white p-6 shadow-[0_10px_30px_rgba(20,30,24,0.10)]"
            data-testid="newsletter-email-canvas"
            onMouseDownCapture={(event) => {
              if (selectNewsletterBlockFromDom(editorRef.current?.editor ?? null, event.target)) {
                syncEditorControls();
              }
            }}
          >
            <EmailEditor
              key={`newsletter-${editorKey}`}
              ref={editorRef}
              content={content}
              extensions={NEWSLETTER_EXTENSIONS}
              editable={!readOnly}
              bubbleMenu={{
                hideWhenActiveNodes: HIDDEN_BUBBLE_MENU_NODES,
                hideWhenActiveMarks: HIDDEN_BUBBLE_MENU_MARKS,
              }}
              placeholder="Add or select a newsletter block"
              className="newsletter-email-editor min-h-[760px] w-full [&_.ProseMirror]:min-h-[720px] [&_.ProseMirror]:outline-none [&_.ProseMirror-selectednode]:outline [&_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror-selectednode]:outline-offset-2 [&_.ProseMirror-selectednode]:outline-[#C69A45] [&_.newsletter-structured-block]:cursor-pointer"
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
          </div>
        </div>
      </section>

      <aside
        className="min-h-0 overflow-y-auto border-l bg-background"
        data-testid="newsletter-settings-panel"
      >
        <Tabs value={inspectorTab} onValueChange={(value) => setInspectorTab(value as InspectorTab)} className="min-h-full">
          <div className="sticky top-0 z-10 border-b bg-background p-3">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="block">Block</TabsTrigger>
              <TabsTrigger value="email">Email</TabsTrigger>
              <TabsTrigger value="checks">
                Checks{validation.errors.length > 0 ? ` (${validation.errors.length})` : ''}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="block" className="m-0 p-4">
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
          </TabsContent>

          <TabsContent value="email" className="m-0 space-y-5 p-4">
            <div className="space-y-2">
              <div>
                <p className="text-sm font-semibold">Newsletter settings</p>
                <p className="text-xs text-muted-foreground">Inbox text, theme, and safe personalization.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{scope}</Badge>
                <Badge variant="outline">Newsletter</Badge>
                <Badge variant={status === 'invalid' ? 'destructive' : 'secondary'}>{status}</Badge>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="newsletter-theme">Theme</Label>
              <Select
                value={themeKey}
                onValueChange={(nextTheme) => {
                  const normalized = nextTheme as EmailStudioThemeKey;
                  const current = getCurrentDocument(editorRef.current, content);
                  replaceDocument(applyTheme(current, normalized), normalized);
                }}
                disabled={readOnly}
              >
                <SelectTrigger id="newsletter-theme"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EMAIL_STUDIO_THEME_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>{EMAIL_STUDIO_THEMES[key].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="newsletter-preheader">Preview text</Label>
              <Textarea
                id="newsletter-preheader"
                value={preheader}
                maxLength={240}
                rows={3}
                disabled={readOnly}
                onChange={(event) => {
                  setPreheader(event.target.value);
                  markDirty();
                }}
                placeholder="Inbox preview text"
              />
              <p className="text-xs text-muted-foreground">{preheader.length}/200 recommended characters</p>
            </div>

            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium">Personalization</p>
                <p className="text-xs text-muted-foreground">Only mailbox-safe newsletter variables are available.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {variables.map((variable) => (
                  <Button
                    key={variable.key}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={readOnly}
                    onClick={() => insertVariable(variable.key)}
                  >
                    {variable.label}
                  </Button>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="checks" className="m-0 p-4">
            <NewsletterChecks validation={validation} error={error} />
          </TabsContent>
        </Tabs>
      </aside>

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
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold">Block settings</p>
          <p className="text-xs text-muted-foreground">Click a section, then edit its text in the Block panel.</p>
        </div>
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Hero, story, CTA, resource, image, footer, and other structured blocks are edited here. Direct text remains editable in the canvas.
        </p>
      </div>
    );
  }

  const definition = EMAIL_STUDIO_BLOCKS.find((entry) => entry.kind === selectedBlock.kind);
  const supportsImage = newsletterBlockSupportsImage(selectedBlock.kind);
  const supportsLink = newsletterBlockSupportsLink(selectedBlock.kind);
  const editable = !readOnly && !selectedBlock.locked;
  const hasTextFields = selectedBlock.kind !== 'divider';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{definition?.label ?? selectedBlock.kind}</p>
          <p className="text-xs text-muted-foreground">{definition?.description ?? 'Edit the selected newsletter block.'}</p>
        </div>
        {selectedBlock.locked ? <Badge variant="secondary"><Lock className="mr-1 h-3 w-3" />Locked</Badge> : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
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
              rows={6}
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
        </div>
      ) : null}

      {supportsImage ? (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="newsletter-block-image">Image</Label>
            <Button type="button" size="sm" variant="outline" disabled={!editable} onClick={onOpenAssets}>
              <ImagePlus className="mr-2 h-4 w-4" />Choose
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
    </div>
  );
}

function NewsletterChecks({
  validation,
  error,
}: {
  validation: EmailValidationResult;
  error: string | null;
}) {
  const clean = !error && validation.issues.length === 0;
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">Newsletter checks</p>
        <p className="text-xs text-muted-foreground">{validation.errors.length} errors · {validation.warnings.length} warnings</p>
      </div>
      {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {clean ? <p className="rounded-md border p-3 text-sm text-muted-foreground">No current policy or rendering issues.</p> : null}
      {validation.issues.map((issue, index) => (
        <div key={`${issue.code}-${issue.path || ''}-${index}`} className="rounded-md border p-3 text-sm">
          <p className={issue.severity === 'error' ? 'text-destructive' : 'text-amber-700'}>{issue.message}</p>
          {issue.path ? <p className="mt-1 text-xs text-muted-foreground">{issue.path}</p> : null}
        </div>
      ))}
    </div>
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

// syncEditorControls rebuilds a fresh block object on every transaction/
// selectionUpdate, so an unconditional setState here never lets React bail via
// reference equality. Confirmed via a real-editor repro (a single attrs-only
// dispatch, no typing involved) that this specific composer's re-render
// re-triggers another transaction/selectionUpdate event indefinitely — root
// cause not fully bisected, but comparing by value before setState breaks the
// loop, since a no-op sync then leaves selectedBlock referentially unchanged.
function areNewsletterBlocksEqual(a: NewsletterSelectedBlock | null, b: NewsletterSelectedBlock | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind
    && a.title === b.title
    && a.body === b.body
    && a.href === b.href
    && a.imageUrl === b.imageUrl
    && a.altText === b.altText
    && a.locked === b.locked
    && a.from === b.from
    && a.to === b.to
    && a.index === b.index
    && a.canMoveUp === b.canMoveUp
    && a.canMoveDown === b.canMoveDown
  );
}
