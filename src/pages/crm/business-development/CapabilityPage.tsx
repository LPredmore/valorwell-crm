import { Link } from 'react-router-dom';
import { DatabaseZap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Capability } from '@/domain/relationships/contracts';
import { relationshipCapabilities } from '@/domain/relationships/capabilities';

export function CapabilityPage({ title, capability, description }: { title: string; capability: Capability; description: string }) {
  const state = relationshipCapabilities().find(item => item.capability === capability)!;
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold">{title}</h1><p className="mt-2 text-muted-foreground">{description}</p></div><Card><CardHeader><CardTitle className="flex items-center gap-2"><DatabaseZap className="h-5 w-5" />Database support pending</CardTitle><CardDescription>{state.reason}</CardDescription></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p>This application workspace is intentionally separate from clinical clients, clinical campaigns, and inbound-interest records. Actions remain disabled until the relationship database contract is installed and verified.</p><Button asChild variant="outline"><Link to="/crm/business-development/status">View system status</Link></Button></CardContent></Card></div>;
}
