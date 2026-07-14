import { Mail, MessageSquare, GripVertical, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RichTextEditor } from '@/components/crm/shared/RichTextEditor';
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
import { useState } from 'react';
import { useCanMutate } from '@/components/crm/auth/CrmMutationGate';

interface CampaignStepEditorProps {
  step: CampaignStepFormData;
  stepIndex: number;
  onChange: (updates: Partial<CampaignStepFormData>) => void;
  onRemove: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

export function CampaignStepEditor({
  step,
  stepIndex,
  onChange,
  onRemove,
  dragHandleProps,
}: CampaignStepEditorProps) {
  const canMutate = useCanMutate();
  const [isOpen, setIsOpen] = useState(true);
  const smsLength = step.sms_body_text?.length || 0;
  const isOverSmsLimit = smsLength > 160;

  const getDelayLabel = () => {
    if (step.delay_days === 0 && step.delay_hours === 0) {
      return stepIndex === 0 ? 'Sends immediately after enrollment' : 'Sends immediately after previous step';
    }
    const parts = [];
    if (step.delay_days > 0) parts.push(`${step.delay_days} day${step.delay_days !== 1 ? 's' : ''}`);
    if (step.delay_hours > 0) parts.push(`${step.delay_hours} hour${step.delay_hours !== 1 ? 's' : ''}`);
    return `${parts.join(' ')} after ${stepIndex === 0 ? 'enrollment' : 'previous step'}`;
  };

  return (
    <div className={cn(
      "border rounded-lg bg-card",
      !step.is_active && "opacity-60"
    )}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center gap-2 p-3 border-b">
          {/* Drag Handle */}
          <div
            {...dragHandleProps}
            className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>

          {/* Step Info */}
          <div className="flex items-center gap-2 flex-1">
            {step.channel === 'email' ? (
              <Mail className="h-4 w-4 text-primary" />
            ) : (
              <MessageSquare className="h-4 w-4 text-primary" />
            )}
            <span className="font-medium">Step {stepIndex + 1}</span>
            <span className="text-sm text-muted-foreground">•</span>
            <span className="text-sm text-muted-foreground capitalize">{step.channel}</span>
            <span className="text-sm text-muted-foreground">•</span>
            <span className="text-sm text-muted-foreground">{getDelayLabel()}</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor={`step-${stepIndex}-active`} className="text-sm text-muted-foreground">
                Active
              </Label>
              <Switch
                id={`step-${stepIndex}-active`}
                checked={step.is_active}
                onCheckedChange={(checked) => onChange({ is_active: checked })}
                disabled={!canMutate}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onRemove}
              disabled={!canMutate}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon">
                {isOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent>
          <div className="p-4 space-y-4">
            {/* Channel & Delay */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select
                  value={step.channel}
                  onValueChange={(value: 'email' | 'sms') => onChange({ channel: value })}
                  disabled={!canMutate}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Delay (days)</Label>
                <Input
                  type="number"
                  min={0}
                  value={step.delay_days}
                  onChange={(e) => onChange({ delay_days: parseInt(e.target.value) || 0 })}
                  disabled={!canMutate}
                />
              </div>
              <div className="space-y-2">
                <Label>Delay (hours)</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={step.delay_hours}
                  onChange={(e) => onChange({ delay_hours: parseInt(e.target.value) || 0 })}
                  disabled={!canMutate}
                />
              </div>
            </div>

            {/* Email Content */}
            {step.channel === 'email' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Input
                    value={step.email_subject}
                    onChange={(e) => onChange({ email_subject: e.target.value })}
                    placeholder="Enter email subject..."
                    disabled={!canMutate}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Body</Label>
                  <RichTextEditor
                    value={step.email_body_html}
                    onChange={(html) => onChange({ email_body_html: html })}
                    placeholder="Enter email body..."
                    minHeight="140px"
                  />
                </div>
                <SignatureSelect
                  value={step.signature_id || 'none'}
                  onChange={(id) => onChange({ signature_id: id === 'none' ? null : id })}
                />
              </div>
            )}

            {/* SMS Content */}
            {step.channel === 'sms' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Message</Label>
                  <span className={cn(
                    "text-xs",
                    isOverSmsLimit ? "text-destructive" : "text-muted-foreground"
                  )}>
                    {smsLength}/160
                    {isOverSmsLimit && " (will be split into multiple messages)"}
                  </span>
                </div>
                <Textarea
                  value={step.sms_body_text}
                  onChange={(e) => onChange({ sms_body_text: e.target.value })}
                  placeholder="Enter SMS message..."
                  rows={3}
                  disabled={!canMutate}
                />
              </div>
            )}

            {/* Variables Help */}
            <div className="text-xs text-muted-foreground border-t pt-3">
              <span className="font-medium">Available variables: </span>
              {PERSONALIZATION_VARIABLES.map((v, i) => (
                <span key={v.key}>
                  <code className="bg-muted px-1 rounded">{v.key}</code>
                  {i < PERSONALIZATION_VARIABLES.length - 1 && ', '}
                </span>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
