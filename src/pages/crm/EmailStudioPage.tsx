import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Loader2, Plus, RefreshCw, Search, TestTube2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmailAssetManager } from '@/features/email-studio/templates/EmailAssetManager';
import { getEmailStudioAccessContext, listEmailTemplates } from '@/features/email-studio/templates/api';
import type {
  EmailStudioAccessContext,
  EmailTemplateFilters,
  EmailTemplateRecord,
} from '@/features/email-studio/templates/types';

const DEFAULT_FILTERS: EmailTemplateFilters = { search: '', status: 'all', scope: 'all' };

export default function EmailStudioPage() {
  const [context, setContext] = useState<EmailStudioAccessContext | null>(null);
  const [templates, setTemplates] = useState<EmailTemplateRecord[]>([]);
  const [filters, setFilters] = useState<EmailTemplateFilters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const access = await getEmailStudioAccessContext();
      const records = await listEmailTemplates(filters);
      setContext(access);
      setTemplates(records);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email Studio templates could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(); }, filters.search ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [load, filters.search]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Email Studio</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">Create reusable canonical templates, publish immutable versions, and manage tenant-scoped images without changing any live delivery path.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link to="/crm/email-studio/playground"><TestTube2 className="mr-2 h-4 w-4" />Playground</Link></Button>
          {context?.canManage ? <Button asChild><Link to="/crm/email-studio/new"><Plus className="mr-2 h-4 w-4" />New template</Link></Button> : <Button disabled><Plus className="mr-2 h-4 w-4" />New template</Button>}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Template filters</CardTitle><CardDescription>Search by template identity and filter the tenant library by lifecycle or audience boundary.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="email-template-search">Search</Label>
            <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="email-template-search" className="pl-9" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Name, subject, or description" /></div>
          </div>
          <div className="space-y-2"><Label>Status</Label><Select value={filters.status} onValueChange={(value) => setFilters((current) => ({ ...current, status: value as EmailTemplateFilters['status'] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="published">Published</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label>Content scope</Label><Select value={filters.scope} onValueChange={(value) => setFilters((current) => ({ ...current, scope: value as EmailTemplateFilters['scope'] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All scopes</SelectItem><SelectItem value="client">Client</SelectItem><SelectItem value="relationship">Relationship</SelectItem></SelectContent></Select></div>
        </CardContent>
      </Card>

      {error ? <Card><CardHeader><CardTitle>Template library could not be loaded</CardTitle><CardDescription>{error}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></CardContent></Card> : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Template library</CardTitle><CardDescription>{templates.length} matching tenant templates. Legacy HTML remains marked until reviewed and saved as canonical content.</CardDescription></div><Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
        </CardHeader>
        <CardContent>
          {loading ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading templates…</div> : templates.length === 0 ? <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No templates match the current filters.</p> : (
            <div className="divide-y rounded-md border">
              {templates.map((template) => <TemplateRow key={template.id} template={template} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {context ? <EmailAssetManager context={context} /> : null}
    </div>
  );
}

function TemplateRow({ template }: { template: EmailTemplateRecord }) {
  const canonical = Boolean(template.editorDocument && template.renderHash);
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <Link to={`/crm/email-studio/templates/${template.id}`} className="font-medium text-primary hover:underline">{template.name}</Link>
          <Badge variant={template.status === 'published' ? 'default' : 'outline'}>{template.status}</Badge>
          <Badge variant="outline">{template.scope}</Badge>
          <Badge variant="outline">{template.mode}</Badge>
          {!canonical ? <Badge variant="destructive">legacy HTML</Badge> : null}
        </div>
        <p className="mt-2 text-sm">{template.subject}</p>
        <p className="mt-1 text-sm text-muted-foreground">{template.description || 'No description'} · Updated {new Date(template.updatedAt).toLocaleString()}</p>
      </div>
      <Button asChild size="sm" variant="outline"><Link to={`/crm/email-studio/templates/${template.id}`}>{template.status === 'draft' ? 'Edit' : 'Review'}</Link></Button>
    </div>
  );
}
