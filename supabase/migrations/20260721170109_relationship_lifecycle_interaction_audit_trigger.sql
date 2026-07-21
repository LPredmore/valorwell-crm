drop trigger if exists set_relationship_interactions_audit_fields on public.relationship_interactions;
create trigger set_relationship_interactions_audit_fields
before insert or update on public.relationship_interactions
for each row execute function public.set_relationship_audit_fields();

drop trigger if exists set_relationship_stage_history_audit_fields on public.relationship_stage_history;
create trigger set_relationship_stage_history_audit_fields
before insert or update on public.relationship_stage_history
for each row execute function public.set_relationship_audit_fields();
