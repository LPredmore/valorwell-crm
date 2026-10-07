-- Phase 3: operational task/exception ownership uses profiles.id, not staff.id.
-- Both columns are nullable, so deleting a profile clears the operational owner
-- without deleting task/exception history.

ALTER TABLE public.crm_tasks
  ADD CONSTRAINT crm_tasks_owner_id_profiles_fkey
  FOREIGN KEY (owner_id)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL
  NOT VALID;

ALTER TABLE public.crm_exceptions
  ADD CONSTRAINT crm_exceptions_owner_id_profiles_fkey
  FOREIGN KEY (owner_id)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL
  NOT VALID;

ALTER TABLE public.crm_tasks
  VALIDATE CONSTRAINT crm_tasks_owner_id_profiles_fkey;

ALTER TABLE public.crm_exceptions
  VALIDATE CONSTRAINT crm_exceptions_owner_id_profiles_fkey;
