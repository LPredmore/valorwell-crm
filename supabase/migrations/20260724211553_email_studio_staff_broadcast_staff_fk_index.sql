-- Email Studio Pass 10: index the staff-recipient foreign key for lifecycle checks and cleanup.

create index if not exists crm_bulk_send_staff_recipients_staff_id_idx
  on public.crm_bulk_send_staff_recipients(staff_id);
