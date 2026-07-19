import { Link } from 'react-router-dom';
import { Building2, FileUp, Mail, Megaphone, ShieldBan, UsersRound, BarChart3, CircleHelp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { relationshipCapabilities } from '@/domain/relationships/capabilities';

const modules = [
  ['Organizations', '/crm/business-development/organizations', Building2, 'Relationship organizations, ownership, next actions, and sources.'],
  ['Contacts', '/crm/business-development/contacts', UsersRound, 'Named contacts and clearly labeled role inboxes.'],
  ['BTY opportunities', '/crm/business-development/opportunities', CircleHelp, 'Beyond The Yellow qualification and invitation pipeline.'],
  ['Imports', '/crm/business-development/imports', FileUp, 'CSV preview, normalization, and conflict resolution.'],
  ['Relationship campaigns', '/crm/business-development/campaigns', Megaphone, 'Separate outreach campaigns; never clinical campaign enrollments.'],
  ['Replies', '/crm/business-development/replies', Mail, 'Relationship replies requiring staff follow-up.'],
  ['Suppressions', '/crm/business-development/suppressions', ShieldBan, 'Relationship-only unsubscribe and do-not-contact controls.'],
  ['Reports', '/crm/business-development/reports', BarChart3, 'Operational reporting with truthful pending states.'],
] as const;

export default function BusinessDevelopmentDashboard() {
  const pending = relationshipCapabilities().filter(item => !item.available).length;
  return <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-2 flex gap-2"><Badge variant="outline">Business Development</Badge><Badge variant="secondary">Application code implemented</Badge></div><h1 className="text-3xl font-bold tracking-tight">Business Development dashboard</h1><p className="mt-2 max-w-3xl text-muted-foreground">Managed relationships and Beyond The Yellow outreach, isolated from clinical CRM operations and inbound interest.</p></div><Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" to="/crm/business-development/status">System status</Link></div><Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/10"><CardHeader><CardTitle>Database integration pending</CardTitle><CardDescription>{pending} relationship capabilities are awaiting the separate database implementation. Metrics intentionally show pending rather than zero.</CardDescription></CardHeader></Card><section aria-label="Business development modules" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{modules.map(([title, path, Icon, description]) => <Link key={path} to={path} className="focus:outline-none"><Card className="h-full transition-colors hover:border-primary"><CardHeader><Icon className="mb-2 h-5 w-5 text-primary"/><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><Badge variant="outline">Support pending</Badge></CardContent></Card></Link>)}</section><Card><CardHeader><CardTitle>Operational metrics</CardTitle><CardDescription>Counts will appear only after verified database capabilities are available.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{['Organizations needing review', 'BTY qualification', 'Overdue next actions', 'Unassigned relationships', 'Active outreach campaigns', 'Replies requiring action', 'Import conflicts', 'Recently updated'].map(label => <div className="rounded border p-3" key={label}><p className="text-sm font-medium">{label}</p><p className="mt-2 text-sm text-muted-foreground">Database support pending</p></div>)}</CardContent></Card></div>;
}
