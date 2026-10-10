import {Button} from '@/components/ui/button';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import type {CrmPipelineStage} from '@/domain/pipelines/models';

interface Props{
 stages:CrmPipelineStage[];
 selectedStageId:string;
 onChooseStage:(stageId:string)=>void;
 loadedCounts:Record<string,number>;
 totalLoaded:number;
 loading:boolean;
 error?:string;
}

/** Always shows the complete configured funnel, including stages with no cards. */
export function ClinicianStageNavigator({
 stages,selectedStageId,onChooseStage,loadedCounts,totalLoaded,loading,error,
}:Props){
 const groups=[
  {heading:'Prospect recruitment',items:stages.filter(s=>s.source_stage_key?.startsWith('outreach_'))},
  {heading:'Submitted applications',items:stages.filter(s=>!s.source_stage_key?.startsWith('outreach_'))},
 ];
 return <Card>
  <CardHeader>
   <CardTitle>Prospective Clinicians — stage navigator</CardTitle>
   <CardDescription>
    {stages.length} configured stages. Select any stage to filter the board or list, even if it has no cards.
    Prospect stages are updated on each therapist's source record; submitted application statuses
    remain in the applicant workflow. Clicking a stage does not send a message.
   </CardDescription>
  </CardHeader>
  <CardContent className="space-y-3">
   <div className="flex flex-wrap items-center gap-3">
    <Button size="sm" variant={selectedStageId?'outline':'default'}
      aria-pressed={!selectedStageId} onClick={()=>onChooseStage('')}>Show all stages</Button>
    <span className="text-xs text-muted-foreground">
     {loading?'Loading candidate preview…':`${totalLoaded} loaded records`} ·
     Board counts reflect the currently loaded preview, not all 1,279 outreach prospects.
    </span>
   </div>
   {error&&<p role="alert" className="text-sm text-destructive">Cards could not load: {error}.
     Stage names are still available; the recruitment directory has the full source.</p>}
   {groups.map(group=><section key={group.heading} className="space-y-2">
    <h3 className="text-sm font-semibold">{group.heading} ({group.items.length})</h3>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
     {group.items.map(s=><Button key={s.id} type="button" size="sm"
       aria-pressed={selectedStageId===s.id}
       variant={selectedStageId===s.id?'default':'outline'}
       className="h-auto min-h-10 justify-between whitespace-normal text-left"
       onClick={()=>onChooseStage(selectedStageId===s.id?'':s.id)}>
       <span>{s.name}</span><span className="ml-2 tabular-nums opacity-80">{loadedCounts[s.id]??0}</span>
     </Button>)}
    </div>
   </section>)}
  </CardContent>
 </Card>;
}
