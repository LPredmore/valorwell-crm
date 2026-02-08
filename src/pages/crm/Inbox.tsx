import { useState, useEffect } from 'react';
import { useHelpScoutSettings } from '@/hooks/crm/useHelpScoutSettings';
import { useConversations } from '@/hooks/crm/useConversations';
import { useSmsConversations, SmsThread, SmsFilter } from '@/hooks/crm/useSmsConversations';
import { useMarkSmsRead } from '@/hooks/crm/useMarkSmsRead';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Inbox as InboxIcon, Settings, AlertCircle, Mail, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ConversationList } from '@/components/crm/inbox/ConversationList';
import { ConversationThread } from '@/components/crm/inbox/ConversationThread';
import { InboxSentTabs } from '@/components/crm/inbox/InboxSentTabs';
import { SentStatusFilter } from '@/components/crm/inbox/SentStatusFilter';
import { SmsConversationList } from '@/components/crm/inbox/SmsConversationList';
import { SmsThread as SmsThreadView } from '@/components/crm/inbox/SmsThread';
import { HelpScoutConversation } from '@/lib/crm/types';

export default function Inbox() {
  const { isLoading: settingsLoading, isConnected } = useHelpScoutSettings();
  
  // Top-level channel tab
  const [channelTab, setChannelTab] = useState<'email' | 'sms'>('email');
  
  // Email-specific state
  const [activeView, setActiveView] = useState<'inbox' | 'sent'>('inbox');
  const [sentStatusFilter, setSentStatusFilter] = useState<'all' | 'active' | 'pending' | 'closed'>('all');
  const [selectedConversation, setSelectedConversation] = useState<HelpScoutConversation | null>(null);
  
  // SMS-specific state
  const [selectedSmsThread, setSelectedSmsThread] = useState<SmsThread | null>(null);
  const [smsFilter, setSmsFilter] = useState<SmsFilter>('all');

  // Inbox always shows active only; Sent allows status filtering
  const effectiveStatus = activeView === 'inbox' ? 'active' : sentStatusFilter;

  const {
    data: conversationsData,
    isLoading: conversationsLoading,
    isError: conversationsError,
    refetch: refetchConversations,
  } = useConversations({
    view: activeView,
    status: effectiveStatus,
    enabled: isConnected && channelTab === 'email',
  });

  const {
    data: smsThreads,
    isLoading: smsLoading,
    isError: smsError,
    refetch: refetchSms,
  } = useSmsConversations(smsFilter);

  const markSmsRead = useMarkSmsRead();

  // Mark messages as read when selecting a thread
  const handleSelectSmsThread = (thread: SmsThread) => {
    setSelectedSmsThread(thread);
    // Mark as read if thread has unread messages
    if (thread.hasUnread) {
      markSmsRead.mutate(thread.phone);
    }
  };

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show setup prompt if HelpScout not connected (only for email tab)
  const showHelpScoutSetup = !isConnected && channelTab === 'email';

  return (
    <div className="flex flex-col h-full">
      {/* Channel Tabs */}
      <div className="border-b bg-card">
        <Tabs value={channelTab} onValueChange={(v) => {
          setChannelTab(v as 'email' | 'sms');
          // Reset selections when switching channels
          setSelectedConversation(null);
          setSelectedSmsThread(null);
        }}>
          <TabsList className="m-2">
            <TabsTrigger value="email" className="gap-2">
              <Mail className="h-4 w-4" />
              Email
            </TabsTrigger>
            <TabsTrigger value="sms" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              SMS
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {channelTab === 'email' ? (
          showHelpScoutSetup ? (
            <div className="flex items-center justify-center flex-1 p-6">
              <Card className="max-w-md">
                <CardHeader className="text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <InboxIcon className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <CardTitle>Connect HelpScout</CardTitle>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                  <p className="text-muted-foreground">
                    To use Email, you need to connect your HelpScout account first.
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
          ) : (
            <>
              {/* Email List - Left Panel */}
              <div className="w-80 border-r flex flex-col">
                <div className="p-3 border-b space-y-3">
                  <InboxSentTabs value={activeView} onChange={setActiveView} />
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
                  onRetry={() => refetchConversations()}
                />
              </div>

              {/* Email Thread - Main Panel */}
              <div className="flex-1 flex flex-col bg-background">
                {selectedConversation ? (
                  <ConversationThread conversation={selectedConversation} />
                ) : (
                  <div className="flex-1 flex items-center justify-center bg-muted/30">
                    <div className="text-center text-muted-foreground">
                      <Mail className="h-16 w-16 mx-auto mb-4 opacity-30" />
                      <h3 className="text-lg font-medium mb-2">Select a conversation</h3>
                      <p className="text-sm">
                        Choose an email from the list to view the thread.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )
        ) : (
          <>
            {/* SMS List - Left Panel */}
            <div className="w-80 border-r flex flex-col">
              <div className="p-3 border-b space-y-3">
                <h3 className="font-medium text-sm text-muted-foreground">SMS Conversations</h3>
                <div className="flex gap-1">
                  <Button
                    variant={smsFilter === 'new' ? 'default' : 'ghost'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setSmsFilter('new')}
                  >
                    New
                  </Button>
                  <Button
                    variant={smsFilter === 'all' ? 'default' : 'ghost'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setSmsFilter('all')}
                  >
                    All
                  </Button>
                </div>
              </div>
              <SmsConversationList
                threads={smsThreads || []}
                isLoading={smsLoading}
                isError={smsError}
                selectedPhone={selectedSmsThread?.phone ?? null}
                onSelect={handleSelectSmsThread}
                onRetry={() => refetchSms()}
              />
            </div>

            {/* SMS Thread - Main Panel */}
            <div className="flex-1 flex flex-col bg-background">
              {selectedSmsThread ? (
                <SmsThreadView thread={selectedSmsThread} />
              ) : (
                <div className="flex-1 flex items-center justify-center bg-muted/30">
                  <div className="text-center text-muted-foreground">
                    <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-30" />
                    <h3 className="text-lg font-medium mb-2">Select a conversation</h3>
                    <p className="text-sm">
                      Choose an SMS thread from the list to view messages.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
