import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { KanbanConfigPanel } from '@/components/crm/settings/KanbanConfigPanel';
import { HelpScoutConfigPanel } from '@/components/crm/settings/HelpScoutConfigPanel';

export default function CrmSettings() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      
      <div className="grid gap-6 max-w-3xl">
        {/* HelpScout Email Configuration */}
        <HelpScoutConfigPanel />

        {/* Kanban Configuration */}
        <KanbanConfigPanel />

        {/* Future settings cards */}
        <Card>
          <CardHeader>
            <CardTitle>Email Templates</CardTitle>
            <CardDescription>
              Manage email templates for client communications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Email template management will be available in Phase 4.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
