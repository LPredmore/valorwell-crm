import { Link } from 'react-router-dom';
import type { Capability } from '@/domain/relationships/contracts';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';

export function CapabilityPage({ title, capability, description }: { title: string; capability: Capability; description: string }) {
  const { capability: state, isLoading, isError, refetch } = useRelationshipCapability(capability);
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold">{title}</h1><p className="mt-2 text-muted-foreground">{description}</p></div><RelationshipCapabilityState state={state} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }}><p className="text-sm text-muted-foreground">This implemented workspace will use the verified relationship database adapter.</p></RelationshipCapabilityState><p className="text-sm text-muted-foreground">This application workspace is intentionally separate from clinical clients, clinical campaigns, and inbound-interest records.</p><Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" to="/crm/business-development/status">View system status</Link></div>;
}
