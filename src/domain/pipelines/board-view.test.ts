import {describe,it,expect} from 'vitest';
import {canMovePipelineCard,matchesPipelineView,type PipelineCard} from './board-view';
import type {CrmPipelineStage} from './models';
const card:PipelineCard={
 id:'r1',stage_id:'a',owner_profile_id:'user',next_action:null,
 next_action_due_at:'2026-10-01T00:00:00Z',field_values:{region:'Missouri'}
};
const filters={search_text:'',stage_id:null,attention:'all' as const,owner_filter:'all' as const};
const stages=[{id:'a',is_terminal:false},{id:'b',is_terminal:true},{id:'c',is_terminal:false}] as CrmPipelineStage[];
describe('pipeline saved views and stage movement',()=>{
  it('filters search, overdue, unassigned and stage independently',()=>{
    expect(matchesPipelineView(card,'Valley Organization',{...filters,search_text:'Missouri'},'user')).toBe(true);
    expect(matchesPipelineView(card,'Valley Organization',{...filters,search_text:'other'},'user')).toBe(false);
    expect(matchesPipelineView(card,'Valley Organization',{...filters,attention:'overdue'},'user',Date.parse('2026-10-09'))).toBe(true);
    expect(matchesPipelineView(card,'Valley Organization',{...filters,attention:'no_next_action'},'user')).toBe(true);
    expect(matchesPipelineView(card,'Valley Organization',{...filters,owner_filter:'mine'},'other')).toBe(false);
    expect(matchesPipelineView(card,'Valley Organization',{...filters,stage_id:'b'},'user')).toBe(false);
  });
  it('supports explicit overrides but blocks default exit from terminal',()=>{
    expect(canMovePipelineCard('a','b',stages,[])).toBe(true);
    expect(canMovePipelineCard('b','a',stages,[])).toBe(false);
    expect(canMovePipelineCard('b','a',stages,[{from_stage_id:'b',to_stage_id:'a',is_allowed:true}])).toBe(true);
    expect(canMovePipelineCard('a','c',stages,[{from_stage_id:'a',to_stage_id:'c',is_allowed:false}])).toBe(false);
    expect(canMovePipelineCard('a','z',stages,[])).toBe(false);
  });
});
