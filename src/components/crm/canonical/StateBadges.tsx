import { Badge } from '@/components/ui/badge';
import type {
  LifecycleStage, EngagementState, EligibilityState,
  ContactPolicy, ServicePolicy, RiskState,
} from '@/domain/canonical';
import { AlertTriangle, Ban, ShieldOff } from 'lucide-react';

const lifecycleColor: Record<LifecycleStage, string> = {
  Registration: 'bg-slate-100 text-slate-700',
  Intake: 'bg-blue-100 text-blue-700',
  Matching: 'bg-indigo-100 text-indigo-700',
  Matched: 'bg-amber-100 text-amber-700',
  Scheduled: 'bg-teal-100 text-teal-700',
  'Early Care': 'bg-emerald-100 text-emerald-700',
  'Established Care': 'bg-green-100 text-green-700',
  Closed: 'bg-zinc-200 text-zinc-700',
};

const engagementColor: Record<EngagementState, string> = {
  Engaged: 'bg-green-100 text-green-700',
  Warm: 'bg-amber-100 text-amber-700',
  Cold: 'bg-orange-100 text-orange-700',
  'Went Dark': 'bg-red-100 text-red-700',
};

const eligibilityColor: Record<EligibilityState, string> = {
  Eligible: 'bg-emerald-100 text-emerald-700',
  'Coverage Issue': 'bg-orange-100 text-orange-700',
  'Manual Review': 'bg-yellow-100 text-yellow-700',
  Unknown: 'bg-gray-100 text-gray-700',
};

export const LifecycleBadge = ({ v }: { v: LifecycleStage }) => (
  <Badge variant="secondary" className={lifecycleColor[v]}>{v}</Badge>
);
export const EngagementBadge = ({ v }: { v: EngagementState }) => (
  <Badge variant="secondary" className={engagementColor[v]}>{v}</Badge>
);
export const EligibilityBadge = ({ v }: { v: EligibilityState }) => (
  <Badge variant="secondary" className={eligibilityColor[v]}>{v}</Badge>
);
export const ContactPolicyBadge = ({ v }: { v: ContactPolicy }) => (
  v === 'Do Not Contact'
    ? <Badge variant="destructive" className="gap-1"><Ban className="h-3 w-3" />DNC</Badge>
    : <Badge variant="outline">Contact OK</Badge>
);
export const ServicePolicyBadge = ({ v }: { v: ServicePolicy }) => (
  v === 'Service Blocked'
    ? <Badge variant="destructive" className="gap-1"><ShieldOff className="h-3 w-3" />Blocked</Badge>
    : <Badge variant="outline">Service OK</Badge>
);
export const AtRiskBadge = ({ r }: { r: RiskState }) => (
  r.atRisk
    ? <Badge className="gap-1 bg-red-600 text-white hover:bg-red-700"><AlertTriangle className="h-3 w-3" />At Risk{r.severity ? ` · ${r.severity}` : ''}</Badge>
    : null
);
