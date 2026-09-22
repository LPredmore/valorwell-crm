import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import type { SocialPublication } from '@/lib/crm/social-media';

export function SocialPublicationMetadataForm({
  publication,
  onChange,
  disabled,
}: {
  publication: SocialPublication;
  onChange: (changes: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="space-y-4">
      {publication.thumbnailUrl && (
        <img src={publication.thumbnailUrl} alt="" className="w-full max-w-xs rounded-md border" />
      )}
      {publication.sourceType === 'project' && !publication.title && (
        <p className="text-xs text-amber-600">
          Full episodes don't have a source title yet — enter one before this publication can become Ready.
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="pub-title">Title</Label>
        <Input
          id="pub-title"
          value={publication.title ?? ''}
          disabled={disabled}
          onChange={(event) => onChange({ title: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pub-description">Description</Label>
        <Textarea
          id="pub-description"
          rows={5}
          value={publication.description}
          disabled={disabled}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pub-hashtags">Hashtags (space separated)</Label>
        <Input
          id="pub-hashtags"
          value={publication.hashtags.join(' ')}
          disabled={disabled}
          onChange={(event) => onChange({ hashtags: event.target.value.split(/\s+/).filter(Boolean) })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pub-tags">Tags (comma separated)</Label>
        <Input
          id="pub-tags"
          value={publication.tags.join(', ')}
          disabled={disabled}
          onChange={(event) => onChange({ tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })}
        />
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground">
          <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
          Advanced settings
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 space-y-2">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">Category: {publication.categoryName}</Badge>
            <Badge variant="secondary">Made for kids: No</Badge>
            <Badge variant="secondary">Altered/synthetic media: No</Badge>
            <Badge variant="secondary">Language: {publication.defaultLanguage === 'en' ? 'English' : publication.defaultLanguage}</Badge>
            <Badge variant="secondary">License: {publication.license === 'youtube' ? 'Standard YouTube' : publication.license}</Badge>
            <Badge variant="secondary">Embedding: {publication.embeddable ? 'Enabled' : 'Disabled'}</Badge>
            <Badge variant="secondary">Public stats: {publication.publicStatsViewable ? 'Enabled' : 'Disabled'}</Badge>
            <Badge variant="secondary">Notify subscribers: {publication.notifySubscribers ? 'Yes' : 'No'}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            These come from Social Media Manager Settings. Change them there, not per-publication.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
