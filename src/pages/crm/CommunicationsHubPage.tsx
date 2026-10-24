import { Link, useSearchParams } from 'react-router-dom';
import { Mail, Megaphone, Inbox, ShieldCheck, FileText, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import type { CrmCapabilities } from '@/lib/crm/types';

const sections = [
  { id:'all', label:'All communications' },
  { id:'direct', label:'Direct messages & replies' },
  { id:'campaigns', label:'Campaigns' },
  { id:'newsletters', label:'Newsletters' },
  { id:'templates', label:'Templates' },
] as const;
type Section = typeof sections[number]['id'];
const destinations = [
  { name:'Direct email', detail:'Compose an individual email and choose a permitted recipient.', href:'/crm/email-studio', section:'direct', icon:Mail, capability:'communicate' },
  { name:'Client inbox', detail:'Review client conversations in the secured client workspace.', href:'/crm/inbox', section:'direct', icon:Inbox },
  { name:'Relationship replies', detail:'Review partner and organization replies, ownership and follow-ups.', href:'/crm/business-development/replies', section:'direct', icon:Inbox },
  { name:'Autonomous Inbox', detail:'Review the assistant\'s Gmail and business SMS cases, approve closure, and verify actions.', href:'/crm/communications/autonomous-inbox', section:'direct', icon:Inbox },
  { name:'Campaign management', detail:'View client, staff, donor and relationship campaigns and their enrollments.', href:'/crm/communications/campaigns', section:'campaigns', icon:Megaphone },
  { name:'Relationship outreach', detail:'Manage organization outreach campaigns, previews and delivery records.', href:'/crm/business-development/campaigns', section:'campaigns', icon:Users },
  { name:'Recruitment sequences & replies', detail:'Prepare clinician recruitment sequences and review replies and delivery status.', href:'/crm/recruitment/sequences', section:'campaigns', icon:Users },
  { name:'Newsletters', detail:'Draft and preview newsletters, manage audiences and review delivery status.', href:'/crm/communications/newsletters', section:'newsletters', icon:Mail },
  { name:'Email templates', detail:'Browse and edit reusable email content in Email Studio.', href:'/crm/email-studio', section:'templates', icon:FileText, capability:'communicate' },
  { name:'Relationship suppressions', detail:'Review relationship contact restrictions and opt-out records.', href:'/crm/business-development/suppressions', section:'direct', icon:ShieldCheck },
] satisfies Array<{name:string;detail:string;href:string;section:Section;icon:typeof Mail;capability?:keyof CrmCapabilities}>;

/** Navigation only: visiting this page never enrolls recipients or changes delivery state. */
export default function CommunicationsHubPage() {
  const {capabilities}=useCrmAuth();
  const [params,setParams]=useSearchParams();
  const current=sections.find(section=>section.id===params.get('tab'))?.id??'all';
  const visible=destinations.filter(item=>(!('capability' in item)||!item.capability||capabilities[item.capability])
    &&(current==='all'||item.section===current));
  return <div className="space-y-6 p-4 md:p-6">
    <div><h1 className="text-3xl font-bold">Communications</h1>
      <p className="mt-2 text-muted-foreground">Choose a workspace to compose, review replies, manage campaigns or work on newsletters.</p></div>
    <nav className="flex flex-wrap gap-2" aria-label="Communication workspaces">
      {sections.map(section=><Button key={section.id} variant={current===section.id?'default':'outline'} aria-pressed={current===section.id}
        onClick={()=>setParams(previous=>{const next=new URLSearchParams(previous);if(section.id==='all')next.delete('tab');else next.set('tab',section.id);return next;})}>
        {section.label}
      </Button>)}
    </nav>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {visible.map(item=><Card key={item.name} className="flex flex-col">
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><item.icon className="h-5 w-5" aria-hidden="true"/>{item.name}</CardTitle>
          <CardDescription>{item.detail}</CardDescription></CardHeader>
        <CardContent className="mt-auto"><Button variant="outline" asChild><Link to={item.href} aria-label={`Open ${item.name}`}>Open workspace</Link></Button></CardContent>
      </Card>)}
    </div>
    {!visible.length&&<p className="text-sm text-muted-foreground">No workspaces in this category are available with your current permissions.</p>}
    <p className="text-xs text-muted-foreground">Sending and scheduling controls are available inside each workspace according to your permissions and its delivery settings.</p>
  </div>;
}
