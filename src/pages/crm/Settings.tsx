import { KanbanConfigPanel } from '@/components/crm/settings/KanbanConfigPanel';
import { HelpScoutConfigPanel } from '@/components/crm/settings/HelpScoutConfigPanel';
import { EmailSignaturesPanel } from '@/components/crm/settings/EmailSignaturesPanel';
import { ClickUpConfigPanel } from '@/components/crm/settings/ClickUpConfigPanel';

export default function CrmSettings() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      
      <div className="grid gap-6 max-w-3xl">
        {/* HelpScout Email Configuration */}
        <HelpScoutConfigPanel />

        {/* Kanban Configuration */}
        <KanbanConfigPanel />

        {/* Email Signatures */}
        <EmailSignaturesPanel />

        {/* ClickUp Sync */}
        <ClickUpConfigPanel />
      </div>
    </div>
  );
}
