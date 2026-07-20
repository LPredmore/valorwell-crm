import { Link } from 'react-router-dom';
import { AppWindow, ArrowRight, Building2, Database, Inbox, Megaphone, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRelationshipCapabilities } from '@/hooks/relationships/useRelationshipCapabilities';
import { RELATIONSHIP_ARCHITECTURE_FALLBACK, RELATIONSHIP_MODULE_BOUNDARIES } from '@/lib/crm/relationship-architecture';

function formatIdentifier(value: string) {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function readinessLabel(ready: boolean) {
  return ready ? 'Verified' : 'Not verified';
}

export default function BusinessDevelopmentArchitecture() {
  const capabilities = useRelationshipCapabilities();
  const contract = RELATIONSHIP_ARCHITECTURE_FALLBACK;
  const availableCount = capabilities.data?.filter((state) => state.available).length ?? 0;
  const capabilityTotal = capabilities.data?.length ?? 0;
  const organizationsAvailable = capabilities.data?.find((state) => state.capability === 'organizations')?.available === true;
  const contactsAvailable = capabilities.data?.find((state) => state.capability === 'contacts')?.available === true;
  const integrationVerified = organizationsAvailable && contactsAvailable && !capabilities.isError;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="outline">Business Development</Badge><Badge variant="secondary">System status</Badge></div>
          <h1 className="text-3xl font-bold tracking-tight">Business Development / BTY Outreach</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">Application architecture and database-readiness status for researched or referred organizations, contacts, Beyond The Yellow opportunities, and relationship outreach.</p>
        </div>
        <Button asChild variant="outline"><Link to={RELATIONSHIP_MODULE_BOUNDARIES.inbound.route}>Review inbound interest<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Readiness</CardTitle><CardDescription>Each status is reported independently. Available first-slice capabilities do not imply that later workflow capabilities are complete.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Architecture established', true, 'The domain boundary and clinical separation are defined in application code.'],
            ['Application code implemented', true, 'Tenant-scoped organization, contact, and affiliation persistence is installed.'],
            ['Database support available', availableCount > 0, capabilities.isLoading ? 'Checking the capability snapshot.' : `${availableCount} of ${capabilityTotal} capability contracts are available.`],
            ['Integration verified', integrationVerified, integrationVerified ? 'Organizations and contacts are verified against the selected Billing Hub tenant.' : 'The organization and contact integration has not been verified for this session.'],
            ['Production ready', false, 'The first persistence slice is live; later workflow and operational-approval requirements remain.'],
          ].map(([label, ready, detail]) => <div className="rounded-lg border p-3" key={label as string}><p className="text-sm font-medium">{label}</p><Badge className="mt-2" variant={ready ? 'default' : 'outline'}>{readinessLabel(ready as boolean)}</Badge><p className="mt-2 text-xs text-muted-foreground">{detail}</p></div>)}
        </CardContent>
      </Card>

      {capabilities.isError && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">Capability status could not be loaded. Database-dependent functions remain disabled until status can be verified.</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader className="flex flex-row items-start gap-3 space-y-0"><Database className="mt-1 h-5 w-5 text-primary" /><div><CardTitle>Canonical database</CardTitle><CardDescription>Billing Hub is the source of truth for the relationship domain.</CardDescription></div></CardHeader><CardContent><p className="text-lg font-semibold">{formatIdentifier(contract.canonical_database)}</p></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-start gap-3 space-y-0"><AppWindow className="mt-1 h-5 w-5 text-primary" /><div><CardTitle>Operational application</CardTitle><CardDescription>Interface used to manage the relationship system.</CardDescription></div></CardHeader><CardContent><p className="text-lg font-semibold">{formatIdentifier(contract.canonical_application)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Database capability status</CardTitle><CardDescription>Unavailable capabilities do not issue relationship queries or substitute clinical data.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {capabilities.isLoading && <p className="text-sm text-muted-foreground">Checking relationship capability status…</p>}
          {capabilities.data?.map((state) => <div className="rounded border p-3" key={state.capability}><div className="flex items-center justify-between gap-2"><p className="font-medium">{formatIdentifier(state.capability)}</p><Badge variant={state.available ? 'default' : 'outline'}>{state.status.replace(/_/g, ' ')}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{state.reason}</p></div>)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Module boundaries</CardTitle><CardDescription>Inbound interest, outbound relationship development, and clinical-client campaigns remain separate operating lanes.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          {[[RELATIONSHIP_MODULE_BOUNDARIES.inbound, Inbox, contract.inbound_lane], [RELATIONSHIP_MODULE_BOUNDARIES.outbound, Building2, contract.outbound_lane], [RELATIONSHIP_MODULE_BOUNDARIES.clinical, Megaphone, contract.clinical_campaign_lane]].map(([boundary, Icon, lane]) => { const ModuleIcon = Icon as typeof Inbox; const module = boundary as typeof RELATIONSHIP_MODULE_BOUNDARIES.inbound; return <div className="rounded-lg border p-4" key={module.label}><div className="mb-3 flex items-center gap-2"><ModuleIcon className="h-5 w-5 text-primary" /><h2 className="font-semibold">{module.label}</h2></div><p className="text-sm text-muted-foreground">{module.purpose}</p><Badge variant="secondary" className="mt-4">{formatIdentifier(lane as string)}</Badge></div>; })}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Enforced boundary</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p>Clinical campaign enrollments remain linked exclusively to clinical client records.</p><p>Organizations, creators, partners, and BTY targets use the separate relationship outreach module.</p><Badge variant={contract.clinical_campaign_boundary_enforced ? 'default' : 'destructive'}>{contract.clinical_campaign_boundary_enforced ? 'Boundary enforced in application contract' : 'Boundary not enforced'}</Badge></CardContent></Card>
        <Card><CardHeader><CardTitle>Canonical terminology</CardTitle><CardDescription>These terms define the current and planned relationship records.</CardDescription></CardHeader><CardContent className="space-y-4">{Object.entries(contract.terminology).map(([term, definition]) => <div key={term} className="grid gap-1 border-b pb-3 last:border-0 last:pb-0 md:grid-cols-[160px_1fr]"><p className="font-medium">{formatIdentifier(term)}</p><p className="text-sm text-muted-foreground">{definition}</p></div>)}</CardContent></Card>
      </div>
    </div>
  );
}
