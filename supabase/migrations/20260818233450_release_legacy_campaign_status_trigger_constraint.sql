-- Canonical client campaign triggers use trigger_dimension/trigger_value.
-- Retain trigger_on_status only as a nullable legacy compatibility column.
alter table public.crm_campaign_triggers
  alter column trigger_on_status drop not null;
