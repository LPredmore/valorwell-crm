import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, MessageSquare, GripVertical, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SignatureSelect } from '@/components/crm/shared/SignatureSelect';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { CampaignStepFormData } from '@/lib/crm/campaign-types';
import { PERSONALIZATION_VARIABLES } from '@/lib/crm/campaign-types';
import { useCanMutate } from '@/hooks/crm/useCanMutate';
import {
  ClientCampaignEmailStudioComposer,
  type ClientCampaignEmailStudioHandle,
} from '@/features/email-studio/campaign';
import { listPublishedClientCampaignTemplates } from '@/features/email-studio/templates';

interface CampaignStepEditorProps {
  step: CampaignStepFormData;
  stepIndex: number;
  onChange: (updates: Partial<CampaignStepFormData>) => void;
  onRemove: () => void;
  registerExporter: (
    clientKey: string,
    exporter: (() => Promise<CampaignStepFormData>) | null,
  ) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

export function CampaignStepEditor({
  step,
  stepIndex,
  onChange,
  onRemove,
  registerExporter,
  dragHandleProps,
}: CampaignStepEditorProps) {
  const canMutate = useCanMutate();
  const studioRef = useRef<ClientCampaignEmailStudioHandle>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [editorKey, setEditorKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const smsLength = step.sms_body_text?.length || 0;
  const isOverSmsLimit = smsLength > 160;
  const templates = useQuery({
    queryKey: ['email-studio', 'published-client-campaign-templates'],
    queryFn: listPublishedClientCampaignTemplates,
    staleTime: 30_000,
  });
  const contentIdentity = step.email_content?.renderHash
    ?? step.email_template_version_id
    ?? `legacy:${step.email_subject}:${step.email_body_html}`;

  useEffect(() => {
    if (step.channel !== 'email') {
      registerExporter(step.client_key, null);
      return;
    }
    registerExporter(step.client_key, async () => {
      const emailContent = await studioRef.current?.exportContent();
      if (!emailContent) throw new Error(`Step ${stepIndex + 1} contains invalid Email Studio content.`);
      return {
        ...step,
        email_body_html: emailContent.renderedHtml,
        email_body_text: emailContent.renderedText,
        email_preheader: emailContent.preheader || '',
        email_content: emailContent,
      };
    });
    return () => registerExporter(step.client_key, null);
  }, [registerExporter, step, stepIndex]);

  const getDelayLabel = () => {
    if (step.delay_days === 0 && step.delay_hours === 0) {
      return stepIndex === 0 ? 'Sends immediately after enrollment' : 'Sends immediately after previous step';
    }
    const parts = [];
    if (step.delay_days > 0) parts.push(`${step.delay_days} day${step.delay_days !== 1 ? 's' : ''}`);
    if (step.delay_hours > 0) parts.push(`${step.delay_hours} hour${step.delay_hours !== 1 ? 's' : ''}`);
    return `${parts.join(' ')} after ${stepIndex === 0 ? 'enrollment' : 'previous step'}`;
  };

  const applyTemplate = (versionId: string) => {
    if (versionId === 'blank') {
      onChange({
        email_subject: '',
        email_body_html: '',
        email_body_text: '',
        email_preheader: '',
        email_content: null,
        email_template_id: null,
        email_template_version_id: null,
      });
      setEditorKey((value) => value + 1);
      setMessage(null);
      return;
    }
    const template = templates.data?.find((entry) => entry.versionId === versionId);
    if (!template) return;
    onChange({
      email_subject: template.subject,
      email_body_html: template.content.renderedHtml,
      email_body_text: template.content.renderedText,
      email_preheader: template.content.preheader || '',
      email_content: template.content,
      email_template_id: template.templateId,
      email_template_version_id: template.versionId,
    });
    setEditorKey((value) => value + 1);
    setMessage(`Loaded ${template.name} version ${template.versionNumber}. This step keeps an editable snapshot and immutable source-version attribution.`);
  };

  const capture = async () => {
    setMessage(null);
    const emailContent = await studioRef.current?.exportContent();
    if (!emailContent) return;
    onChange({
      email_body_html: emailContent.renderedHtml,
      email_body_text: emailContent.renderedText,
      email_preheader: emailContent.preheader || '',
      email_content: emailContent,
    });
    setMessage('Canonical Email Studio content captured. Saving the campaign will persist this exact snapshot.');
  };

  return (
    <div className={cn('border rounded-lg bg-card', !step.is_active && 'opacity-60')}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center gap-2 p-3 border-b">
          <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex items-center gap-2 flex-1">
            {step.channel === 'email' ? <Mail className="h-4 w-4 text-primary" /> : <MessageSquare className="h-4 w-4 text-primary" />}
            <span className="font-medium">Step {stepIndex + 1}</span>
            <span className="text-sm text-muted-foreground">•</span>
            <span className="text-sm text-muted-foreground capitalize">{step.channel}</span>
            <span className="text-sm text-muted-foreground">•</span>
            <span className="text-sm text-muted-foreground">{getDelayLabel()}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor={`step-${step.client_key}-active`} className="text-sm text-muted-foreground">Active</Label>
              <Switch
                id={`step-${step.client_key}-active`}
                checked={step.is_active}
                onCheckedChange={(checked) => onChange({ is_active: checked })}
                disabled={!canMutate}
              />
            </div>
            <Button variant="ghost" size="icon" onClick={onRemove} disabled={!canMutate} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon">{isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select
                  value={step.channel}
                  onValueChange={(value: 'email' | 'sms') => onChange({ channel: value })}
                  disabled={!canMutate}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Delay (days)</Label>
                <Input type="number" min={0} value={step.delay_days} onChange={(event) => onChange({ delay_days: parseInt(event.target.value) || 0 })} disabled={!canMutate} />
              </div>
              <div className="space-y-2">
                <Label>Delay (hours)</Label>
                <Input type="number" min={0} max={23} value={step.delay_hours} onChange={(event) => onChange({ delay_hours: parseInt(event.target.value) || 0 })} disabled={!canMutate} />
              </div>
            </div>

            {step.channel === 'email' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Published client campaign template</Label>
                  <Select value={step.email_template_version_id || 'blank'} onValueChange={applyTemplate} disabled={!canMutate || templates.isLoading}>
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
                  <Label>Subject</Label>
                  <Input value={step.email_subject} onChange={(event) => onChange({ email_subject: event.target.value })} placeholder="Enter email subject..." disabled={!canMutate} />
                </div>
                <ClientCampaignEmailStudioComposer
                  key={`${editorKey}:${contentIdentity}`}
                  ref={studioRef}
                  initialContent={step.email_content}
                  legacyBodyHtml={step.email_content ? '' : step.email_body_html}
                  legacyBodyText={step.email_content ? '' : step.email_body_text}
                  readOnly={!canMutate}
                  onDirty={() => setMessage(null)}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" variant="outline" disabled={!canMutate} onClick={() => void capture()}>Capture step content</Button>
                  {message && <p className="text-sm text-muted-foreground">{message}</p>}
                </div>
                <SignatureSelect value={step.signature_id || 'none'} onChange={(id) => onChange({ signature_id: id === 'none' ? null : id })} />
              </div>
            )}

            {step.channel === 'sms' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Message</Label>
                  <span className={cn('text-xs', isOverSmsLimit ? 'text-destructive' : 'text-muted-foreground')}>
                    {smsLength}/160{isOverSmsLimit && ' (will be split into multiple messages)'}
                  </span>
                </div>
                <Textarea value={step.sms_body_text} onChange={(event) => onChange({ sms_body_text: event.target.value })} placeholder="Enter SMS message..." rows={3} disabled={!canMutate} />
              </div>
            )}

            <div className="text-xs text-muted-foreground border-t pt-3">
              <span className="font-medium">Available client variables: </span>
              {PERSONALIZATION_VARIABLES.map((variable, index) => (
                <span key={variable.key}>
                  <code className="bg-muted px-1 rounded">{variable.key}</code>
                  {index < PERSONALIZATION_VARIABLES.length - 1 && ', '}
                </span>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
