import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Inbox, Send } from 'lucide-react';

interface InboxSentTabsProps {
  value: 'inbox' | 'sent';
  onChange: (value: 'inbox' | 'sent') => void;
}

export function InboxSentTabs({ value, onChange }: InboxSentTabsProps) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as 'inbox' | 'sent')}>
      <TabsList className="w-full grid grid-cols-2 h-9">
        <TabsTrigger value="inbox" className="text-sm gap-1.5">
          <Inbox className="h-4 w-4" />
          Inbox
        </TabsTrigger>
        <TabsTrigger value="sent" className="text-sm gap-1.5">
          <Send className="h-4 w-4" />
          Sent
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
