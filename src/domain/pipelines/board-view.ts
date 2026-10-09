import type {CrmPipelineRecord,CrmPipelineStage} from './models';
export type PipelineViewMode='board'|'list';
export type AttentionFilter='all'|'overdue'|'no_next_action';
export type OwnerFilter='all'|'mine'|'unassigned';
export type PipelineCard=Pick<CrmPipelineRecord,'id'|'stage_id'|'owner_profile_id'|'next_action'|'next_action_due_at'|'field_values'> & {displayName?:string; primaryContact?:string};
export interface PipelineViewFilters{
  search_text:string;stage_id:string|null;attention:AttentionFilter;owner_filter:OwnerFilter;
}
export function matchesPipelineView(card:PipelineCard,label:string,view:PipelineViewFilters,currentUserId:string,now=Date.now()){
  if(view.stage_id&&card.stage_id!==view.stage_id)return false;
  if(view.owner_filter==='mine'&&card.owner_profile_id!==currentUserId)return false;
  if(view.owner_filter==='unassigned'&&card.owner_profile_id)return false;
  if(view.attention==='no_next_action'&&!!card.next_action?.trim())return false;
  if(view.attention==='overdue'&&
      (!card.next_action_due_at||Date.parse(card.next_action_due_at)>=now))return false;
  const q=view.search_text.trim().toLocaleLowerCase();
  if(!q)return true;
  const haystack=[label,card.primaryContact,...Object.values(card.field_values??{})]
    .filter(v=>v!=null).map(v=>String(v)).join(' ').toLocaleLowerCase();
  return haystack.includes(q);
}
export interface PipelineMoveRule{
  from_stage_id:string;to_stage_id:string;is_allowed:boolean;
}
export function canMovePipelineCard(from:string,to:string,stages:CrmPipelineStage[],rules:PipelineMoveRule[]):boolean{
  if(from===to)return false;
  const source=stages.find(s=>s.id===from);
  if(!source||!stages.some(s=>s.id===to))return false;
  const rule=rules.find(r=>r.from_stage_id===from&&r.to_stage_id===to);
  return rule?rule.is_allowed:!source.is_terminal;
}
