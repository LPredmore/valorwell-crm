import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RelationshipCampaignEmailStudioComposer, type RelationshipCampaignEmailStudioHandle } from '@/features/email-studio/campaign';
import { listPublishedRelationshipCampaignTemplates } from '@/features/email-studio/templates/published-relationship-campaign';
import type { RelationshipCampaignDefinitionInput } from '@/domain/relationships/campaign-contracts';

type Step = RelationshipCampaignDefinitionInput['steps'][number];

export function RelationshipCampaignEmailStepEditor({
  index,
  step,
  total,
  disabled,
  onChange,
  onMove,
  onDelete,
  registerExporter,
}: {
  index: number;
  step: Step;
  total: number;
  disabled: boolean;
  onChange: (step: Step) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  registerExporter: (index: number, exporter: (() => Promise<Step>) | null) => void;
}) {
  const studioRef = useRef<RelationshipCampaignEmailStudioHandle>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [selectedTemplateId, setSelectedTemplateId] = useState(step.templateVersionId || 'blank');
  const [message, setMessage] = useState<string | null>(null);
  const templates = useQuery({
    queryKey: ['email-studio', 'published-relationship-campaign-templates'],
    queryFn: listPublishedRelationshipCampaignTemplates,
    staleTime: 30_000,
  });

  useEffect(() => {
    registerExporter(index, async () => {
      const emailContent = await studioRef.current?.exportContent();
      if (!emailContent) throw new Error(`Step ${index + 1} contains invalid Email Studio content.`);
      return {
        ...step,
        bodyTemplate: emailContent.renderedText,
        emailContent,
      };
    });
    return () => registerExporter(index, null);
  }, [index, registerExporter, step]);

  const applyTemplate = (versionId: string) => {
    setSelectedTemplateId(versionId);
    if (versionId === 'blank') {
      onChange({
        ...step,
        subjectTemplate: '',
        bodyTemplate: '',
        emailContent: undefined,
        templateId: undefined,
        templateVersionId: undefined,
      });
      setEditorKey((value) => value + 1);
      return;
    }
    const template = templates.data?.find((entry) => entry.versionId === versionId);
    if (!template) return;
    onChange({
      ...step,
      subjectTemplate: template.subject,
      bodyTemplate: template.content.renderedText,
      emailContent: template.content,
      templateId: template.templateId,
      templateVersionId: template.versionId,
    });
    setEditorKey((value) => value + 1);
    setMessage(`Loaded ${template.name} version ${template.versionNumber}. The campaign stores an editable snapshot and immutable version attribution.`);
  };

  const capture = async () => {
    setMessage(null);
    const emailContent = await studioRef.current?.exportContent();
    if (!emailContent) return;
    onChange({ ...step, bodyTemplate: emailContent.renderedText, emailContent });
    setMessage('Canonical Email Studio content captured for this step. Saving the campaign will persist this exact snapshot.');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Step {index + 1}</CardTitle>
            <CardDescription>Relationship-only Campaign Email Studio content. Client templates and Direct/Newsletter modes are excluded.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="icon" variant="outline" aria-label={`Move step ${index + 1} up`} disabled={disabled || index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="outline" aria-label={`Move step ${index + 1} down`} disabled={disabled || index === total - 1} onClick={() => onMove(1)}><ArrowDown className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="outline" aria-label={`Delete step ${index + 1}`} disabled={disabled} onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Published relationship campaign template</Label>
            <Select value={selectedTemplateId} onValueChange={applyTemplate} disabled={disabled || templates.isLoading}>
              <SelectTrigger><SelectValue placeholder={templates.isLoading ? 'Loading templates…' : 'Start blank or select a published template'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">Start with blank Campaign Email Studio content</SelectItem>
                {(templates.data || []).map((template) => (
                  <SelectItem key={template.versionId} value={template.versionId}>{template.name} · v{template.versionNumber}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templates.isError && <p className="text-sm text-destructive">{templates.error instanceof Error ? templates.error.message : 'Published templates could not be loaded.'}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`step-${index}-subject`}>Subject template</Label>
            <Input id={`step-${index}-subject`} value={step.subjectTemplate} disabled={disabled} onChange={(event) => onChange({ ...step, subjectTemplate: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`step-${index}-delay`}>Delay after prior step (days)</Label>
            <Input id={`step-${index}-delay`} type="number" min="0" max="365" value={step.delayDays} disabled={disabled} onChange={(event) => onChange({ ...step, delayDays: Number(event.target.value) })} />
          </div>
        </div>

        <RelationshipCampaignEmailStudioComposer
          key={editorKey}
          ref={studioRef}
          initialContent={step.emailContent}
          readOnly={disabled}
          onDirty={() => setMessage(null)}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={disabled} onClick={() => void capture()}>
            Capture step content
          </Button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={step.stopOnReply} disabled={disabled} onChange={(event) => onChange({ ...step, stopOnReply: event.target.checked })} />Stop on reply</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={step.isActive} disabled={disabled} onChange={(event) => onChange({ ...step, isActive: event.target.checked })} />Active step</label>
        </div>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  );
}
