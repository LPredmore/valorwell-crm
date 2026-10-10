interface Props{
 workflow:string;quality:string;due:string;mineOnly:boolean;
 onWorkflow:(v:string)=>void;onQuality:(v:string)=>void;
 onDue:(v:string)=>void;onMine:(v:boolean)=>void;
}
export function RecruitmentFilters(props:Props){
 return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
  <label className="space-y-1 text-xs">Recruitment stage
   <select aria-label="Filter by review stage" className="w-full h-10 rounded border bg-background p-2" value={props.workflow} onChange={e=>props.onWorkflow(e.target.value)}>
    <option value="">All stages</option>
    <optgroup label="Review status">
     <option value="review">Needs review</option><option value="ready">Ready</option><option value="blocked">Blocked</option>
    </optgroup>
    <optgroup label="Recruitment progress">
     <option value="recruiting:not_contacted">Not yet contacted</option>
     <option value="recruiting:contact_attempted">Contact attempted</option>
     <option value="recruiting:replied">Responded</option>
     <option value="recruiting:interested">Interested</option>
     <option value="recruiting:application_handoff">Application handoff discussed</option>
     <option value="recruiting:applicant_linked">Existing application linked</option>
     <option value="recruiting:closed">Closed</option>
    </optgroup>
   </select>
  </label>
  <label className="space-y-1 text-xs">Contact quality
   <select aria-label="Filter by contact quality" className="w-full h-10 rounded border bg-background p-2" value={props.quality} onChange={e=>props.onQuality(e.target.value)}>
    <option value="">All statuses</option><option value="email_valid">Unique valid email</option>
    <option value="email_missing">Missing email</option><option value="email_invalid">Invalid email</option>
    <option value="email_duplicate">Duplicate email</option><option value="suppressed">Excluded / suppressed</option>
    <option value="possible_match">Possible identity match</option>
    <option value="email_unverified">Unverified email</option><option value="preview_eligible">Technically reviewed</option>
   </select>
  </label>
  <label className="space-y-1 text-xs">Follow-up
   <select aria-label="Filter by follow-up" className="w-full h-10 rounded border bg-background p-2" value={props.due} onChange={e=>props.onDue(e.target.value)}>
    <option value="">All follow-ups</option><option value="overdue">Overdue</option>
    <option value="next_7_days">Due within 7 days</option><option value="missing_action">Missing next action</option>
    <option value="no_due_date">Missing due date</option>
   </select>
  </label>
  <label className="flex items-center gap-2 text-xs pt-6">
   <input aria-label="Assigned to me" type="checkbox" checked={props.mineOnly} onChange={e=>props.onMine(e.target.checked)}/>
   Assigned to me
  </label>
 </div>;
}
