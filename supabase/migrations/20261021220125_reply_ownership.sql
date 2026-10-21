CREATE OR REPLACE FUNCTION private.assign_verified_reply_owner_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $body$
DECLARE v_owner uuid; v_org uuid;
BEGIN
  IF NEW.opportunity_id IS NULL THEN
    NEW.owner_profile_id := NULL;
    RETURN NEW;
  END IF;
  SELECT owner_profile_id, organization_id INTO v_owner,v_org
  FROM public.relationship_opportunities
  WHERE tenant_id=NEW.tenant_id AND id=NEW.opportunity_id;
  IF FOUND AND v_owner IS NOT NULL
    AND (NEW.organization_id IS NULL OR NEW.organization_id=v_org) THEN
    NEW.owner_profile_id := v_owner;
  ELSE
    NEW.owner_profile_id := NULL;
  END IF;
  RETURN NEW;
END;
$body$;
CREATE TRIGGER relationship_reply_verify_owner_on_create
BEFORE INSERT ON public.relationship_replies
FOR EACH ROW EXECUTE FUNCTION private.assign_verified_reply_owner_v1();
