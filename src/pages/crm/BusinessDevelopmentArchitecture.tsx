import { Link } from 'react-router-dom';
import {
  AppWindow,
  ArrowRight,
  Building2,
  Database,
  Inbox,
  Megaphone,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRelationshipArchitecture } from '@/hooks/crm/useRelationshipArchitecture';
import {
  RELATIONSHIP_ARCHITECTURE_FALLBACK,
  RELATIONSHIP_MODULE_BOUNDARIES,
} from '@/lib/crm/relationship-architecture';

function formatIdentifier(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function BusinessDevelopmentArchitecture() {
  const { data, isLoading, isError } = useRelationshipArchitecture();
  const contract = data ?? RELATIONSHIP_ARCHITECTURE_FALLBACK;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Business Development</Badge>
            <Badge variant="secondary">Architecture established</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Business Development / BTY Outreach</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Canonical architecture for researched or referred organizations, named contacts,
            Beyond The Yellow opportunities, direct outreach, and relationship follow-up.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to={RELATIONSHIP_MODULE_BOUNDARIES.inbound.route}>
            Review inbound interest
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          Database support for the live architecture contract is pending. This page shows the
          application boundary, not a loaded database contract.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <Database className="mt-1 h-5 w-5 text-primary" />
            <div>
              <CardTitle>Canonical database</CardTitle>
              <CardDescription>Business Development relationship source of record</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-52" />
            ) : (
              <p className="text-lg font-semibold">{formatIdentifier(contract.canonical_database)}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <AppWindow className="mt-1 h-5 w-5 text-primary" />
            <div>
              <CardTitle>Operational application</CardTitle>
              <CardDescription>Interface used to manage the relationship system</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-52" />
            ) : (
              <p className="text-lg font-semibold">{formatIdentifier(contract.canonical_application)}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Module boundaries</CardTitle>
          <CardDescription>
            Inbound interest, outbound relationship development, and clinical-client campaigns
            remain separate operating lanes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center gap-2">
              <Inbox className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">{RELATIONSHIP_MODULE_BOUNDARIES.inbound.label}</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {RELATIONSHIP_MODULE_BOUNDARIES.inbound.purpose}
            </p>
            <Badge variant="secondary" className="mt-4">
              {formatIdentifier(contract.inbound_lane)}
            </Badge>
          </div>

          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">{RELATIONSHIP_MODULE_BOUNDARIES.outbound.label}</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {RELATIONSHIP_MODULE_BOUNDARIES.outbound.purpose}
            </p>
            <Badge variant="secondary" className="mt-4">
              {formatIdentifier(contract.outbound_lane)}
            </Badge>
          </div>

          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">{RELATIONSHIP_MODULE_BOUNDARIES.clinical.label}</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {RELATIONSHIP_MODULE_BOUNDARIES.clinical.purpose}
            </p>
            <Badge variant="secondary" className="mt-4">
              {formatIdentifier(contract.clinical_campaign_lane)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Enforced boundary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Clinical campaign enrollments remain linked exclusively to clinical client records.
            </p>
            <p>
              Organizations, creators, partners, and BTY targets will use the separate relationship
              outreach module.
            </p>
            <Badge variant={contract.clinical_campaign_boundary_enforced ? 'default' : 'destructive'}>
              {contract.clinical_campaign_boundary_enforced ? 'Boundary enforced' : 'Boundary not enforced'}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Canonical terminology</CardTitle>
            <CardDescription>
              These terms define the records that subsequent implementation phases will build.
            </CardDescription>
          </CardHeader>
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
