import { useQuery } from '@tanstack/react-query';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { fetchYouTubeConnectionStatus, type DeliveryMode, type PrivacyStatus } from '@/lib/crm/social-media';
import { centralTimeToUtcIso, utcIsoToCentralParts } from './centralTime';

export type PublishMode = 'private' | 'unlisted' | 'public' | 'scheduled';

function modeFor(deliveryMode: DeliveryMode, privacy: PrivacyStatus): PublishMode {
  if (deliveryMode === 'scheduled') return 'scheduled';
  return privacy;
}

export function SocialPublicationScheduleForm({
  deliveryMode,
  privacyStatus,
  scheduledFor,
  onChange,
  disabled,
}: {
  deliveryMode: DeliveryMode;
  privacyStatus: PrivacyStatus;
  scheduledFor: string | null;
  onChange: (next: { deliveryMode: DeliveryMode; desiredPrivacyStatus: PrivacyStatus; scheduledFor: string | null }) => void;
  disabled?: boolean;
}) {
  const { data: connection } = useQuery({ queryKey: ['social-media', 'youtube-connection'], queryFn: fetchYouTubeConnectionStatus, retry: 1 });
  const connected = connection?.state === 'connected';
  const mode = modeFor(deliveryMode, privacyStatus);
  const parts = scheduledFor ? utcIsoToCentralParts(scheduledFor) : { date: '', time: '' };

  const setMode = (next: PublishMode) => {
    if (next === 'scheduled') {
      onChange({ deliveryMode: 'scheduled', desiredPrivacyStatus: 'public', scheduledFor: scheduledFor ?? null });
    } else {
      onChange({ deliveryMode: 'immediate', desiredPrivacyStatus: next, scheduledFor: null });
    }
  };

  return (
    <div className="space-y-3">
      <Label>Publish mode</Label>
      <RadioGroup value={mode} onValueChange={(value) => setMode(value as PublishMode)} className="space-y-2">
        <div className="flex items-center gap-2">
          <RadioGroupItem value="private" id="mode-private" disabled={disabled} />
          <Label htmlFor="mode-private" className="font-normal">Private (immediate)</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="unlisted" id="mode-unlisted" disabled={disabled || !connected} />
          <Label htmlFor="mode-unlisted" className="font-normal text-muted-foreground">
            Unlisted {!connected && '(enabled after YouTube connection is verified)'}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="public" id="mode-public" disabled={disabled || !connected} />
          <Label htmlFor="mode-public" className="font-normal text-muted-foreground">
            Publish Now — Public {!connected && '(enabled after YouTube connection is verified)'}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="scheduled" id="mode-scheduled" disabled={disabled || !connected} />
          <Label htmlFor="mode-scheduled" className="font-normal text-muted-foreground">
            Schedule on YouTube {!connected && '(enabled after YouTube connection is verified)'}
          </Label>
        </div>
      </RadioGroup>

      {mode === 'scheduled' && (
        <div className="space-y-2 pl-6">
          <p className="text-xs text-muted-foreground">
            The CRM uploads the video to YouTube immediately as Private and sets the date/time below as YouTube's public publish time. For Shorts, add the custom thumbnail manually in YouTube Studio before that time.
          </p>
          <div className="flex items-center gap-2">
          <Input
            type="date"
            value={parts.date}
            disabled={disabled}
            onChange={(event) => {
              const time = parts.time || '09:00';
              onChange({ deliveryMode: 'scheduled', desiredPrivacyStatus: 'public', scheduledFor: centralTimeToUtcIso(event.target.value, time) });
            }}
          />
          <Input
            type="time"
            value={parts.time}
            disabled={disabled}
            onChange={(event) => {
              if (!parts.date) return;
              onChange({ deliveryMode: 'scheduled', desiredPrivacyStatus: 'public', scheduledFor: centralTimeToUtcIso(parts.date, event.target.value) });
            }}
          />
          <span className="text-xs text-muted-foreground">Central Time</span>
          </div>
        </div>
      )}
    </div>
  );
}
