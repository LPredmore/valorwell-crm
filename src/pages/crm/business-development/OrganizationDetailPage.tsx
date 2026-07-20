import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { RelationshipTimeline } from '@/components/crm/relationships/RelationshipTimeline';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';

const panels = ['Contacts and roles', 'Social profiles', 'Referral and source history', 'BTY opportunities', 'Campaign history', 'Suppressions', 'Relationship context and audit'];

export default function OrganizationDetailPage() {
  const { id } = useParams();
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('organizations');
  return <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold tracking-tight">Organization detail</h1><p className="mt-2 text-muted-foreground">Relationship organization {id}. This workspace is separate from clinical client records.</p></div><Button asChild variant="outline"><Link to="/crm/business-development/organizations">Back to organizations</Link></Button></div><RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} /><Card><CardHeader><CardTitle>Organization summary</CardTitle><CardDescription>Summary, owner, stage, next action, duplicate warnings, and audit metadata will load only through the typed organization adapter.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">Database support pending; no organization record is substituted from another CRM domain.</p></CardContent></Card><section className="grid gap-4 md:grid-cols-2">{panels.map((title) => <Card key={title}><CardHeader><CardTitle className="text-base">{title}</CardTitle><CardDescription>Relationship-only information appears when database support is verified.</CardDescription></CardHeader></Card>)}</section><RelationshipTimeline items={[]} title="Organization relationship timeline" /></div>;
}
