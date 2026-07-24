import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EmailEditor, type EmailEditorRef } from '@react-email/editor';
import { StarterKit } from '@react-email/editor/extensions';
import { EmailTheming } from '@react-email/editor/plugins';
import {
  createEmailContentDraftFromEditorExport,
  finalizeEmailContentDocument,
  getEmailVariablesForScope,
  type EmailContentDocument,
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

const CAMPAIGN_EXTENSIONS = [
  StarterKit,
  EmailTheming.configure({ theme: 'basic' }),
  EmailStudioBlock,
  EmailStudioVariable,
];

export type RelationshipCampaignEmailStudioHandle = {
  exportContent: () => Promise<EmailContentDocument | null>;
};

export type RelationshipCampaignEmailStudioComposerProps = {
  initialContent?: EmailContentDocument | null;
  readOnly?: boolean;
  onDirty?: () => void;
};

export const RelationshipCampaignEmailStudioComposer = forwardRef<
  RelationshipCampaignEmailStudioHandle,
  RelationshipCampaignEmailStudioComposerProps
>(function RelationshipCampaignEmailStudioComposer({ initialContent, readOnly = false, onDirty }, ref) {
  const editorRef = useRef<EmailEditorRef>(null);
  const initialThemeKey = normalizeThemeKey(initialContent?.themeKey);
  const initialDocument = initialContent?.editorDocument
    || createEmailStudioDocument({ mode: 'campaign', scope: 'relationship', themeKey: initialThemeKey });
  const [themeKey, setThemeKey] = useState<EmailStudioThemeKey>(initialThemeKey);
  const [content, setContent] = useState<EmailEditorDocument>(() => cloneEmailStudioDocument(initialDocument));
  const [preheader, setPreheader] = useState(initialContent?.preheader || '');
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState<EmailStudioStatus>('loading');
  const [validation, setValidation] = useState<EmailValidationResult>(() =>
    validateEmailStudioEditorDocument(initialDocument, 'campaign', 'relationship'),
  );
  const [snapshot, setSnapshot] = useState<EmailContentDocument | null>(initialContent || null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocks = useMemo(() => getEmailStudioBlocksForMode('campaign'), []);
  const variables = useMemo(() => getEmailVariablesForScope('relationship'), []);

  const markDirty = () => {
    setSnapshot(null);
    setStatus('dirty');
    onDirty?.();
  };

  const replaceDocument = (nextDocument: EmailEditorDocument, nextThemeKey = themeKey) => {
    setThemeKey(nextThemeKey);
    setContent(cloneEmailStudioDocument(nextDocument));
    setSnapshot(null);
    setValidation(validateEmailStudioEditorDocument(nextDocument, 'campaign', 'relationship'));
    setError(null);
    setStatus('loading');
    setEditorKey((value) => value + 1);
    onDirty?.();
  };

  const exportContent = async (openPreview = false): Promise<EmailContentDocument | null> => {
    const current = editorRef.current;
    if (!current) {
      setError('The relationship Campaign Email Studio editor is not ready.');
      return null;
    }
    setStatus('exporting');
    setError(null);
    try {
      const { html, text } = await current.getEmail();
      const editorDocument = current.getJSON() as unknown as EmailEditorDocument;
      const draft = createEmailContentDraftFromEditorExport({
        mode: 'campaign',
        editorDocument,
        html,
        text,
        preheader,
        themeKey,
      });
      const studioValidation = validateEmailStudioDraft(draft, 'relationship');
      setValidation(studioValidation);
      if (!studioValidation.valid) {
        setSnapshot(null);
        setStatus('invalid');
        return null;
      }
      const finalized = await finalizeEmailContentDocument(draft, 'relationship');
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
      setError(caught instanceof Error ? caught.message : 'Relationship Campaign Email Studio export failed.');
      setStatus('dirty');
      return null;
    }
  };

  useImperativeHandle(ref, () => ({ exportContent: () => exportContent(false) }));

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

  return (
    <div className="space-y-4">
      <EmailStudioToolbar
        mode="campaign"
        allowedModes={['campaign']}
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
          replaceDocument(createEmailStudioDocument({ mode: 'campaign', scope: 'relationship', themeKey }));
        }}
      />
      <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_280px]">
        <BlockLibrary blocks={blocks} onInsert={insertBlock} disabled={readOnly} />
        <ComposerField
          editorRef={editorRef}
          editorKey={editorKey}
          mode="campaign"
          content={content}
          readOnly={readOnly}
          onReady={() => {
            editorRef.current?.editor?.setEditable(!readOnly);
            setStatus('ready');
          }}
          onUpdate={() => {
            const document = getCurrentDocument(editorRef.current, content);
            setValidation(validateEmailStudioEditorDocument(document, 'campaign', 'relationship'));
            markDirty();
          }}
        />
        <div className="space-y-4">
          <EmailStudioInspector
            scope="relationship"
            mode="campaign"
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
    </div>
  );
});

function getCurrentDocument(ref: EmailEditorRef | null, fallback: EmailEditorDocument): EmailEditorDocument {
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
  if (value === 'valorwell' || value === 'ocs' || value === 'bty' || value === 'plain-outreach') return value;
  return 'plain-outreach';
}
