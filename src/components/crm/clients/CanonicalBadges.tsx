import { Badge } from '@/components/ui/badge';
import type { LifecycleStage, EngagementState } from '@/lib/crm/contracts';

const LIFECYCLE_COLORS: Record<LifecycleStage, string> = {
  Lead: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Registration: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  Intake: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  Matching: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  Matched: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  Scheduled: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  'Early Care': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  'Established Care': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Closed: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
};

const ENGAGEMENT_COLORS: Record<EngagementState, string> = {
  Normal: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'Unresponsive Warm': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'Unresponsive Cold': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  'Went Dark': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export function LifecycleBadge({ stage }: { stage: LifecycleStage | null | undefined }) {
  if (!stage) return <Badge variant="outline">Unknown</Badge>;
  return <Badge className={LIFECYCLE_COLORS[stage]} variant="outline">{stage}</Badge>;
}

export function EngagementBadge({ state }: { state: EngagementState | null | undefined }) {
  if (!state || state === 'Normal') return null;
  return <Badge className={ENGAGEMENT_COLORS[state]} variant="outline">{state}</Badge>;
}

export function AtRiskBadge({ atRisk }: { atRisk: boolean | undefined }) {
  if (!atRisk) return null;
  return (
    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" variant="outline">
      At Risk
    </Badge>
  );
}

export function DncBadge({ policy }: { policy: 'Normal' | 'Do Not Contact' | undefined }) {
  if (policy !== 'Do Not Contact') return null;
  return (
    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" variant="outline">
      DNC
    </Badge>
  );
}
