-- Create function for case-insensitive email array matching
-- This is needed because Supabase JS SDK's .in() filter is case-sensitive
-- and we need to match lowercased HelpScout emails against mixed-case database emails

CREATE OR REPLACE FUNCTION public.find_clients_by_emails_insensitive(
  p_tenant_id uuid,
  p_emails text[]
)
RETURNS TABLE (id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id, c.email
  FROM clients c
  WHERE c.tenant_id = p_tenant_id
    AND LOWER(c.email) = ANY(p_emails);
$$;