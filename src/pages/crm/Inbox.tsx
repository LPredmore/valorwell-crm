import { useState } from 'react';
import { useHelpScoutSettings } from '@/hooks/crm/useHelpScoutSettings';
import { useConversations } from '@/hooks/crm/useConversations';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Inbox as InboxIcon, Settings, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ConversationList } from '@/components/crm/inbox/ConversationList';
import { ConversationThread } from '@/components/crm/inbox/ConversationThread';
import { InboxSentTabs } from '@/components/crm/inbox/InboxSentTabs';
import { SentStatusFilter } from '@/components/crm/inbox/SentStatusFilter';
import { HelpScoutConversation } from '@/lib/crm/types';

export default function Inbox() {
  const { isLoading: settingsLoading, isConnected } = useHelpScoutSettings();
  const [activeView, setActiveView] = useState<'inbox' | 'sent'>('inbox');
  const [sentStatusFilter, setSentStatusFilter] = useState<'all' | 'active' | 'pending' | 'closed'>('all');
  const [selectedConversation, setSelectedConversation] = useState<HelpScoutConversation | null>(null);

  // Inbox always shows active only; Sent allows status filtering
  const effectiveStatus = activeView === 'inbox' ? 'active' : sentStatusFilter;

  const {
    data: conversationsData,
    isLoading: conversationsLoading,
    isError: conversationsError,
    refetch,
  } = useConversations({
    view: activeView,
    status: effectiveStatus,
    enabled: isConnected,
  });

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show setup prompt if not connected
  if (!isConnected) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <Card className="max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <InboxIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <CardTitle>Connect HelpScout</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              To use the Inbox, you need to connect your HelpScout account first.
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
              <AlertCircle className="h-4 w-4" />
              <span>HelpScout not connected</span>
            </div>
            <Button asChild>
              <Link to="/crm/settings">
                <Settings className="h-4 w-4 mr-2" />
                Go to Settings
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Conversation List - Left Panel */}
      <div className="w-80 border-r flex flex-col">
        <div className="p-3 border-b space-y-3">
          <InboxSentTabs value={activeView} onChange={setActiveView} />
          {/* Only show status filter in Sent view */}
          {activeView === 'sent' && (
            <SentStatusFilter value={sentStatusFilter} onChange={setSentStatusFilter} />
          )}
        </div>
        <ConversationList
          conversations={conversationsData?.conversations || []}
          isLoading={conversationsLoading}
          isError={conversationsError}
          selectedId={selectedConversation?.id ?? null}
          onSelect={setSelectedConversation}
          onRetry={() => refetch()}
        />
      </div>

      {/* Thread Viewer - Main Panel */}
      <div className="flex-1 flex flex-col bg-background">
        {selectedConversation ? (
          <ConversationThread conversation={selectedConversation} />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-muted/30">
            <div className="text-center text-muted-foreground">
              <InboxIcon className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <h3 className="text-lg font-medium mb-2">Select a conversation</h3>
              <p className="text-sm">
                Choose a conversation from the list to view the thread.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
