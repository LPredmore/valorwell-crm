import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';

export default function ContactDirectoryPage() {
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('contacts');
  return <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold tracking-tight">Relationship contacts</h1><p className="mt-2 text-muted-foreground">Named people and role inboxes are distinct relationship records, never clinical clients.</p></div><Button asChild variant="outline"><Link to="/crm/business-development/status">System status</Link></Button></div><Card><CardHeader><CardTitle>Contact directory filters</CardTitle><CardDescription>Search names, email, phone, organization, role, owner, lifecycle, outreach, veteran affiliation, next action, and last interaction.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-3"><div><Label htmlFor="contact-search">Search</Label><Input id="contact-search" placeholder="Name, email, or phone" /></div><div><Label htmlFor="contact-kind">Contact kind</Label><Input id="contact-kind" placeholder="Person or role inbox" /></div><div><Label htmlFor="contact-organization">Organization</Label><Input id="contact-organization" placeholder="Organization" /></div></CardContent></Card><RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} /><Card><CardHeader><CardTitle>Contact detail readiness</CardTitle><CardDescription>Identity, affiliations, sources, opportunities, campaign history, suppression, ownership, next action, and audit information will load only through the typed relationship contacts adapter.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">Role inboxes such as partnerships@ or info@ never require staff to invent a person’s name.</p></CardContent></Card></div>;
}
