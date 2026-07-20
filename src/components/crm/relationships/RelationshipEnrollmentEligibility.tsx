import type { RelationshipEnrollmentEligibility } from '@/services/relationships/enrollment-eligibility';

export function RelationshipEnrollmentEligibility({ result }: { result: RelationshipEnrollmentEligibility }) {
  if (result.eligible) {
    return <p className="text-sm text-emerald-700">Eligible for relationship enrollment.</p>;
  }

  return <div className="space-y-2" role="status">
    <p className="text-sm font-medium">Not eligible for enrollment</p>
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      {result.explanations.map((explanation) => <li key={explanation}>{explanation}</li>)}
    </ul>
  </div>;
}
