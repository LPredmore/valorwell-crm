import type { AttentionFilter, OwnerFilter, PipelineViewMode } from './board-view';

/** Shareable UI state for the selected pipeline; no tenant/user permissions in URLs. */
export interface PipelineUrlFilters {
  view_mode:PipelineViewMode;
  sort_key:string;
  search_text:string;
  stage_id:string;
  attention:AttentionFilter;
  owner_filter:OwnerFilter;
}
export const defaultPipelineUrlFilters:PipelineUrlFilters={
  view_mode:'board',sort_key:'updated_at',search_text:'',stage_id:'',
  attention:'all',owner_filter:'all',
};
const keys=['view','sort','q','stage','attention','owner'] as const;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readPipelineUrlFilters(params:URLSearchParams):PipelineUrlFilters{
  const view=params.get('view');
  const sort=params.get('sort')??'';
  const stage=params.get('stage')??'';
  const attention=params.get('attention');
  const owner=params.get('owner');
  return {
    view_mode:view==='list'?'list':'board',
    sort_key:/^[a-z][a-z0-9_]{0,63}$/.test(sort)?sort:'updated_at',
    search_text:(params.get('q')??'').slice(0,200),
    stage_id:uuid.test(stage)?stage:'',
    attention:attention==='overdue'||attention==='no_next_action'?attention:'all',
    owner_filter:owner==='mine'||owner==='unassigned'?owner:'all',
  };
}
export function writePipelineUrlFilters(previous:URLSearchParams,view:PipelineUrlFilters):URLSearchParams{
  const next=new URLSearchParams(previous);
  for(const key of keys)next.delete(key);
  if(view.view_mode!=='board')next.set('view',view.view_mode);
  if(view.sort_key!=='updated_at')next.set('sort',view.sort_key);
  if(view.search_text)next.set('q',view.search_text.slice(0,200));
  if(view.stage_id&&uuid.test(view.stage_id))next.set('stage',view.stage_id);
  if(view.attention!=='all')next.set('attention',view.attention);
  if(view.owner_filter!=='all')next.set('owner',view.owner_filter);
  return next;
}
