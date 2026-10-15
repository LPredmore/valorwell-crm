import {useMutation,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogTrigger,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {useCrmAuth} from '@/hooks/crm/useCrmAuth';
import {supabase} from '@/integrations/supabase/client';

/** An explicit human choice uses the existing atomic, permission-checked RPC. */
export function OrganizationPrimaryContactAction({organizationId,contactId,contactName,isPrimary}:{
  organizationId:string;contactId:string;contactName:string;isPrimary:boolean;
}){
  const {capabilities,currentTenantId}=useCrmAuth();
  const client=useQueryClient();
  const update=useMutation({
    mutationFn:async()=>{
      if(!capabilities.mutate||!currentTenantId)throw new Error('CRM editing permission is required.');
      const {data,error}=await supabase.rpc('crm_set_organization_primary_contact',{
        p_organization_id:organizationId,p_contact_id:contactId,
      });
      if(error)throw new Error(error.message);
      if(data!==contactId)throw new Error('Primary selection could not be confirmed. Refresh before retrying.');
    },
    onSuccess:async()=>{
      await Promise.all([
        ['relationship-organization-contacts'],['relationship-contact'],['relationship-contacts'],
        ['relationship-organization'],['pipeline-card-subjects'],['pipeline-existing-primary'],
        ['pipeline-connected-cards'],['relationship-pipeline-records'],
      ].map(queryKey=>client.invalidateQueries({queryKey})));
    },
  });
  if(!capabilities.mutate)return null;
  return <div className="space-y-1">
    <AlertDialog>
      <AlertDialogTrigger asChild><Button size="sm" variant="outline" disabled={update.isPending}>
        {isPrimary?'Confirm as sole Primary':'Set as Primary'}
      </Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Choose the organization's Primary contact</AlertDialogTitle>
          <AlertDialogDescription>Make {contactName} the sole Primary contact for this organization across every pipeline.
            This replaces its other Primary assignments. The other contacts and affiliations are retained.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={()=>update.mutate()}>Confirm Primary contact</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {update.isError&&<p role="alert" className="max-w-xs text-xs text-destructive">Primary contact could not be updated. Refresh and retry.</p>}
    {update.isSuccess&&<p role="status" className="text-xs text-muted-foreground">Primary contact saved.</p>}
  </div>;
}
