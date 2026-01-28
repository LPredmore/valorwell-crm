import { useState } from 'react';
import { useHelpScoutSettings } from '@/hooks/crm/useHelpScoutSettings';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Inbox as InboxIcon, Settings, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Inbox() {
  const { settings, isLoading, isConnected } = useHelpScoutSettings();

  if (isLoading) {
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
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Inbox</h2>
            <Badge variant="secondary">Connected</Badge>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <div className="text-center text-muted-foreground py-8">
            <InboxIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">Loading conversations...</p>
            <p className="text-xs mt-1">
              Conversation list UI coming in Phase 3B
            </p>
          </div>
        </div>
      </div>

      {/* Thread Viewer - Main Panel */}
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center text-muted-foreground">
          <InboxIcon className="h-16 w-16 mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium mb-2">Select a conversation</h3>
          <p className="text-sm">
            Choose a conversation from the list to view the thread.
          </p>
        </div>
      </div>
    </div>
  );
}
