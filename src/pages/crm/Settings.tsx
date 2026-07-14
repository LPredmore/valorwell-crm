import { KanbanConfigPanel } from '@/components/crm/settings/KanbanConfigPanel';
import { HelpScoutConfigPanel } from '@/components/crm/settings/HelpScoutConfigPanel';
import { EmailSignaturesPanel } from '@/components/crm/settings/EmailSignaturesPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldAlert } from 'lucide-react';
import { CONTRACT_VERSION, CANONICAL_READ_VIEW } from '@/lib/crm/contracts';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { CrmMutationGate } from '@/components/crm/auth/CrmMutationGate';

const ReadOnlyNotice = (
  <Alert>
    <ShieldAlert className="h-4 w-4" />
    <AlertDescription className="text-xs">
      You do not have permission to modify this section. Sign in as an admin or staff member to make changes.
    </AlertDescription>
  </Alert>
);

export default function CrmSettings() {
  const { role, tenantId, userId, isAuthenticated } = useCrmAuth();

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="grid gap-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">About / Contract</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="CRM contract version" value={CONTRACT_VERSION} />
            <Row label="Canonical read view" value={CANONICAL_READ_VIEW} />
            <Row label="Role" value={role} />
            <Row label="Tenant" value={tenantId || '—'} />
            <Row label="User" value={userId || '—'} />
            <Row label="Authenticated" value={isAuthenticated ? 'yes' : 'no'} />
            <p className="pt-2 text-xs text-muted-foreground">
              Mutating actions require role <code>admin</code> or <code>staff</code>. Missing
              canonical RPCs surface as <code>CONTRACT_NOT_DEPLOYED</code>. See{' '}
              <code>docs/crm-backend-delivery-request.md</code>.
            </p>
          </CardContent>
        </Card>

        <HelpScoutConfigPanel />
        <KanbanConfigPanel />
        <EmailSignaturesPanel />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
