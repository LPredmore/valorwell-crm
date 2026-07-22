import { Link } from 'react-router-dom';
import {
  AppWindow,
  ArrowRight,
  Building2,
  CheckCircle2,
  Database,
  Inbox,
  LockKeyhole,
  Megaphone,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRelationshipCapabilities } from '@/hooks/relationships/useRelationshipCapabilities';
import { useRelationshipReleaseContract } from '@/hooks/relationships/useRelationshipReleaseContract';
import {
  RELATIONSHIP_ARCHITECTURE_FALLBACK,
  RELATIONSHIP_MODULE_BOUNDARIES,
} from '@/lib/crm/relationship-architecture';

function formatIdentifier(value: string) {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function shortHash(value: string | null) {
  return value ? `${value.slice(0, 12)}…${value.slice(-8)}` : 'Unavailable';
}

export default function BusinessDevelopmentArchitecture() {
  const capabilities = useRelationshipCapabilities();
  const releaseContract = useRelationshipReleaseContract();
  const contract = releaseContract.data ?? RELATIONSHIP_ARCHITECTURE_FALLBACK;
  const availableCount = capabilities.data?.filter((state) => state.available).length ?? 0;
  const capabilityTotal = capabilities.data?.length ?? 0;
  const allCapabilitiesAvailable = capabilityTotal > 0 && availableCount === capabilityTotal && !capabilities.isError;
  const implementationAccepted = contract.release_status === 'accepted'
    && contract.implementation_status === 'production_hardened';
  const productionActive = contract.activation_status === 'active';
  const activationLocked = !productionActive;

  const readiness = [
    {
      label: 'Architecture established',
      ready: true,
      status: 'Verified',
      detail: 'The non-clinical relationship domain and clinical separation are defined.',
    },
    {
      label: 'Implementation accepted',
      ready: implementationAccepted,
      status: implementationAccepted ? 'Accepted' : 'Not accepted',
      detail: implementationAccepted
        ? 'Database, application, authorization, recovery, and release evidence passed final acceptance.'
        : 'The live release contract has not recorded final acceptance.',
    },
    {
      label: 'Database contract verified',
      ready: Boolean(contract.schema_fingerprint) && !releaseContract.isError,
      status: contract.schema_fingerprint && !releaseContract.isError ? 'Verified' : 'Unavailable',
      detail: contract.schema_fingerprint
        ? `Version ${contract.contract_version}; schema fingerprint ${shortHash(contract.schema_fingerprint)}.`
        : 'The live schema fingerprint could not be verified.',
    },
    {
      label: 'Capabilities verified',
      ready: allCapabilitiesAvailable,
      status: allCapabilitiesAvailable ? 'Verified' : 'Not verified',
      detail: capabilities.isLoading
        ? 'Checking the capability snapshot.'
        : `${availableCount} of ${capabilityTotal} application capability contracts are available.`,
    },
    {
      label: 'Production activation',
      ready: productionActive,
      status: productionActive ? 'Active' : 'Locked',
      detail: productionActive
        ? 'The live contract permits production delivery.'
        : 'Implementation acceptance does not authorize delivery. Provider and pilot gates remain closed.',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Business Development</Badge>
            <Badge variant="secondary">System status</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Business Development / BTY Outreach</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Final implementation acceptance, live database contract, capability status, and production-activation controls for relationship outreach.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to={RELATIONSHIP_MODULE_BOUNDARIES.inbound.route}>
            Review inbound interest<ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {implementationAccepted && activationLocked && (
        <div
          className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
          role="status"
          aria-live="polite"
        >
          <LockKeyhole className="mt-0.5 h-5 w-5 flex-none text-amber-700" aria-hidden="true" />
          <div>
            <p className="font-semibold">Implementation accepted; production delivery locked</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Pass 14 acceptance confirms the system is hardened. It does not enable campaigns, enrollments, providers, workers, or outbound delivery.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Release readiness</CardTitle>
          <CardDescription>Implementation acceptance and production activation are independent decisions.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {readiness.map((item) => (
            <div className="rounded-lg border p-3" key={item.label}>
              <p className="text-sm font-medium">{item.label}</p>
              <Badge className="mt-2" variant={item.ready ? 'default' : 'outline'}>{item.status}</Badge>
              <p className="mt-2 text-xs text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {(capabilities.isError || releaseContract.isError) && (
        <div className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm" role="alert">
          <TriangleAlert className="h-5 w-5 flex-none" aria-hidden="true" />
          <p>
            {releaseContract.isError
              ? 'The live release contract could not be loaded. Production activation remains locked.'
              : 'Capability status could not be loaded. Database-dependent functions remain disabled until status can be verified.'}
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <Database className="mt-1 h-5 w-5 text-primary" aria-hidden="true" />
            <div><CardTitle>Canonical database</CardTitle><CardDescription>Billing Hub is the source of truth.</CardDescription></div>
          </CardHeader>
          <CardContent><p className="text-lg font-semibold">{formatIdentifier(contract.canonical_database)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <AppWindow className="mt-1 h-5 w-5 text-primary" aria-hidden="true" />
            <div><CardTitle>Operational application</CardTitle><CardDescription>Interface used to manage the relationship system.</CardDescription></div>
          </CardHeader>
          <CardContent><p className="text-lg font-semibold">{formatIdentifier(contract.canonical_application)}</p></CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />Acceptance contract</CardTitle>
            <CardDescription>Evidence identifying the hardened implementation.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <div><dt className="font-medium">Release status</dt><dd className="text-muted-foreground">{formatIdentifier(contract.release_status)}</dd></div>
              <div><dt className="font-medium">Implementation status</dt><dd className="text-muted-foreground">{formatIdentifier(contract.implementation_status)}</dd></div>
              <div><dt className="font-medium">Contract version</dt><dd className="text-muted-foreground">{contract.contract_version}</dd></div>
              <div><dt className="font-medium">Schema fingerprint</dt><dd className="break-all font-mono text-xs text-muted-foreground">{shortHash(contract.schema_fingerprint)}</dd></div>
              <div><dt className="font-medium">Accepted at</dt><dd className="text-muted-foreground">{contract.accepted_at ? new Date(contract.accepted_at).toLocaleString() : 'Not recorded'}</dd></div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><LockKeyhole className="h-5 w-5 text-amber-700" aria-hidden="true" />Activation decision</CardTitle>
            <CardDescription>Current operational authorization for outbound delivery.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={productionActive ? 'default' : 'outline'}>{productionActive ? 'Active' : 'No-go / locked'}</Badge>
              <span className="text-sm text-muted-foreground">{formatIdentifier(contract.activation_status)}</span>
            </div>
            {contract.activation_blockers.length > 0 ? (
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                {contract.activation_blockers.map((blocker) => <li key={blocker}>{formatIdentifier(blocker)}</li>)}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No activation blockers are recorded.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Database capability status</CardTitle><CardDescription>Unavailable capabilities do not issue relationship queries or substitute clinical data.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {capabilities.isLoading && <p className="text-sm text-muted-foreground">Checking relationship capability status…</p>}
          {capabilities.data?.map((state) => (
            <div className="rounded border p-3" key={state.capability}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{formatIdentifier(state.capability)}</p>
                <Badge variant={state.available ? 'default' : 'outline'}>{state.status.replace(/_/g, ' ')}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{state.reason}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Module boundaries</CardTitle><CardDescription>Inbound interest, outbound relationship development, and clinical-client campaigns remain separate operating lanes.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          {[
            [RELATIONSHIP_MODULE_BOUNDARIES.inbound, Inbox, contract.inbound_lane],
            [RELATIONSHIP_MODULE_BOUNDARIES.outbound, Building2, contract.outbound_lane],
            [RELATIONSHIP_MODULE_BOUNDARIES.clinical, Megaphone, contract.clinical_campaign_lane],
          ].map(([boundary, Icon, lane]) => {
            const ModuleIcon = Icon as typeof Inbox;
            const module = boundary as typeof RELATIONSHIP_MODULE_BOUNDARIES.inbound;
            return (
              <div className="rounded-lg border p-4" key={module.label}>
                <div className="mb-3 flex items-center gap-2"><ModuleIcon className="h-5 w-5 text-primary" aria-hidden="true" /><h2 className="font-semibold">{module.label}</h2></div>
                <p className="text-sm text-muted-foreground">{module.purpose}</p>
                <Badge variant="secondary" className="mt-4">{formatIdentifier(lane as string)}</Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />Enforced boundary</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Clinical campaign enrollments remain linked exclusively to clinical client records.</p>
            <p>Organizations, creators, partners, and BTY targets use the separate relationship outreach module.</p>
            <Badge variant={contract.clinical_campaign_boundary_enforced ? 'default' : 'destructive'}>
              {contract.clinical_campaign_boundary_enforced ? 'Boundary enforced in application contract' : 'Boundary not enforced'}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Canonical terminology</CardTitle><CardDescription>These terms define the relationship records.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(contract.terminology).map(([term, definition]) => (
              <div key={term} className="grid gap-1 border-b pb-3 last:border-0 last:pb-0 md:grid-cols-[160px_1fr]">
                <p className="font-medium">{formatIdentifier(term)}</p>
                <p className="text-sm text-muted-foreground">{definition}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
