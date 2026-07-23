import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { EmailContentDocument, EmailContentScope } from '@/features/email-studio/contracts';
import { EmailStudio } from '@/features/email-studio/studio';

export default function EmailStudioPlaygroundPage() {
  const [scope, setScope] = useState<EmailContentScope>('client');
  const [readOnly, setReadOnly] = useState(false);
  const [lastExport, setLastExport] = useState<EmailContentDocument | null>(null);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3"><Link to="/crm/email-studio"><ArrowLeft className="mr-2 h-4 w-4" />Template library</Link></Button>
          <h1 className="text-2xl font-bold">Email Studio playground</h1>
          <p className="text-sm text-muted-foreground">Non-persistent authoring surface for testing modes, themes, blocks, variables, previews, and canonical exports.</p>
        </div>
        {lastExport ? <Badge variant="outline">Canonical export ready</Badge> : null}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-5 p-4">
          <div className="min-w-[220px] space-y-1.5">
            <Label>Content scope</Label>
            <Select value={scope} onValueChange={(value) => { setScope(value as EmailContentScope); setLastExport(null); }}>
              <SelectTrigger aria-label="Email content scope"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="client">Client communication</SelectItem><SelectItem value="relationship">Relationship outreach</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 pb-2">
            <Switch id="email-studio-read-only" checked={readOnly} onCheckedChange={setReadOnly} />
            <Label htmlFor="email-studio-read-only">Read-only review mode</Label>
          </div>
          <p className="ml-auto max-w-xl text-xs text-muted-foreground">Changing scope remounts the composer so client and relationship variables never share an active editor document.</p>
        </CardContent>
      </Card>

      <EmailStudio
        key={`${scope}-${readOnly ? 'readonly' : 'editable'}`}
        scope={scope}
        initialMode={scope === 'client' ? 'direct' : 'campaign'}
        initialThemeKey={scope === 'client' ? 'valorwell' : 'plain-outreach'}
        readOnly={readOnly}
        onExport={setLastExport}
      />
    </div>
  );
}
