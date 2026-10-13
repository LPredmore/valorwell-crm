import {describe,it,expect} from 'vitest';
import {defaultPipelineUrlFilters,readPipelineUrlFilters,writePipelineUrlFilters} from './pipeline-url-filters';

const stage='7d3634c6-6527-4d78-b2a6-9db2d1fefc17';
describe('pipeline shareable filter URLs',()=>{
  it('round-trips view, stage, owner, overdue, search and sort while preserving pipeline',()=>{
    const initial=new URLSearchParams('pipeline=pipeline-1&other=keep');
    const state={...defaultPipelineUrlFilters,view_mode:'list' as const,
      sort_key:'created_at',search_text:'Missouri veteran',stage_id:stage,
      attention:'overdue' as const,owner_filter:'mine' as const};
    const next=writePipelineUrlFilters(initial,state);
    expect(next.get('pipeline')).toBe('pipeline-1');
    expect(next.get('other')).toBe('keep');
    expect(readPipelineUrlFilters(next)).toEqual(state);
  });
  it('clears old filters when switching pipelines and keeps unrelated query values',()=>{
    const old=new URLSearchParams('pipeline=a&view=list&owner=mine&attention=overdue&q=old');
    old.set('pipeline','b');
    const next=writePipelineUrlFilters(old,defaultPipelineUrlFilters);
    expect(next.toString()).toBe('pipeline=b');
    expect(readPipelineUrlFilters(next)).toEqual(defaultPipelineUrlFilters);
  });
  it('ignores invalid or malicious filters and bounds search input',()=>{
    const input=new URLSearchParams({view:'invalid',sort:'bad;DROP',attention:'irrelevant',
      owner:'someone-else',stage:'not-uuid',q:'z'.repeat(350)});
    const state=readPipelineUrlFilters(input);
    expect(state).toMatchObject({
      view_mode:'board',sort_key:'updated_at',attention:'all',owner_filter:'all',stage_id:'',
    });
    expect(state.search_text).toHaveLength(200);
    expect(writePipelineUrlFilters(new URLSearchParams(),state).get('q')).toHaveLength(200);
  });
  it('handles stable defaults and missing optional parameters',()=>{
    expect(readPipelineUrlFilters(new URLSearchParams())).toEqual(defaultPipelineUrlFilters);
    expect(writePipelineUrlFilters(new URLSearchParams(),defaultPipelineUrlFilters).toString()).toBe('');
  });
});
