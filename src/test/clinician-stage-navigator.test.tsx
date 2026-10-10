import {fireEvent,render,screen} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {ClinicianStageNavigator} from '@/pages/crm/pipelines/ClinicianStageNavigator';
import type {CrmPipelineStage} from '@/domain/pipelines/models';

const makeStage=(id:string,name:string,key:string,position:number):CrmPipelineStage=>({
 id,tenant_id:'test-tenant',pipeline_id:'test-pipeline',name,position,
 is_terminal:false,source_stage_key:key,created_at:'2026-10-10T00:00:00Z',
});

const stages=[
 makeStage('p-review','Prospects — Review','outreach_review',0),
 makeStage('p-contact','Prospects — Contact Attempted','outreach_contact_attempted',2),
 makeStage('p-reply','Prospects — Responded','outreach_replied',3),
 makeStage('p-interested','Prospects — Interested','outreach_interested',4),
 makeStage('p-handoff','Prospects — Application Handoff','outreach_application_handoff',5),
 makeStage('a-screening','Screening','screening',10),
];

describe('Prospective Clinicians stage navigator',()=>{
 it('shows every configured prospect and applicant stage, including empty stages',()=>{
  render(<ClinicianStageNavigator stages={stages} selectedStageId="" onChooseStage={vi.fn()}
   loadedCounts={{'p-review':200}} totalLoaded={200} loading={false}/>);
  expect(screen.getByText(/6 configured stages/)).toBeInTheDocument();
  expect(screen.getByText('Prospect recruitment (5)')).toBeInTheDocument();
  expect(screen.getByText('Submitted applications (1)')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Prospects — Contact Attempted/})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Prospects — Application Handoff/})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Screening/})).toBeInTheDocument();
  expect(screen.getByText(/200 loaded records/)).toBeInTheDocument();
 });
 it('selects a stage and allows showing all again without changing source data',()=>{
  const choose=vi.fn();
  const {rerender}=render(<ClinicianStageNavigator stages={stages} selectedStageId="" onChooseStage={choose}
   loadedCounts={{'p-review':200}} totalLoaded={200} loading={false}/>);
  fireEvent.click(screen.getByRole('button',{name:/Prospects — Responded/}));
  expect(choose).toHaveBeenCalledWith('p-reply');
  rerender(<ClinicianStageNavigator stages={stages} selectedStageId="p-reply" onChooseStage={choose}
   loadedCounts={{'p-review':200}} totalLoaded={200} loading={false}/>);
  fireEvent.click(screen.getByRole('button',{name:'Show all stages'}));
  expect(choose).toHaveBeenCalledWith('');
 });
});
