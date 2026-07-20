import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { RelationshipEnrollmentEligibility } from '@/components/crm/relationships/RelationshipEnrollmentEligibility';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { evaluateRelationshipEnrollmentEligibility } from '@/services/relationships/enrollment-eligibility';

/** A relationship-only capability-gated target-selection workspace. */
export default function RelationshipEnrollmentEligibilityPage() {
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('enrollment');
  const unavailableResult = evaluateRelationshipEnrollmentEligibility({
    sourceLanguage: 'none',
    enrollmentCapability: capability,
  });

  return <div className="space-y-6">
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Enrollment eligibility</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">Review relationship-only target eligibility before enrollment. Clinical campaigns, client records, and clinical enrollment data are never used.</p>
    </div>
    <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />
    <Card>
      <CardHeader>
        <CardTitle>Target selection</CardTitle>
        <CardDescription>Each selected relationship contact will show email, review, qualification, suppression, duplicate, response, and source-permission explanations.</CardDescription>
      </CardHeader>
      <CardContent>
        {capability?.available
          ? <p className="text-sm text-muted-foreground">The typed relationship target adapter is available; select a campaign and relationship target to review eligibility.</p>
          : <RelationshipEnrollmentEligibility result={unavailableResult} />}
      </CardContent>
    </Card>
  </div>;
}
