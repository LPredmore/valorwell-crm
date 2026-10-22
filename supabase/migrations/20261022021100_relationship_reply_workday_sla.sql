-- Configurable weekday working-hours target for new actionable CRM replies.
-- No automatic emails or updates to existing replies. Central local time, 09:00-17:00.
CREATE TABLE IF NOT EXISTS private.relationship_reply_sla_policy (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
 enabled boolean NOT NULL DEFAULT false,
 timezone text NOT NULL DEFAULT 'America/Chicago',
 work_start_hour integer NOT NULL DEFAULT 9 CHECK(work_start_hour BETWEEN 0 AND 22),
 work_end_hour integer NOT NULL DEFAULT 17 CHECK(work_end_hour BETWEEN 1 AND 23),
 target_work_minutes integer NOT NULL DEFAULT 480 CHECK(target_work_minutes BETWEEN 15 AND 2400),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(work_end_hour>work_start_hour)
);
REVOKE ALL ON TABLE private.relationship_reply_sla_policy FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE private.relationship_reply_sla_policy TO service_role;
INSERT INTO private.relationship_reply_sla_policy
 (tenant_id,enabled,timezone,work_start_hour,work_end_hour,target_work_minutes)
 VALUES ('00000000-0000-0000-0000-000000000001'::uuid,true,
   'America/Chicago',9,17,480)
 ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.relationship_work_minutes_due_v1(
 p_created timestamptz,p_timezone text,p_start integer,p_end integer,p_minutes integer)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=''
AS $sla$
DECLARE
 v_local timestamp := coalesce(p_created,now()) AT TIME ZONE p_timezone;
 v_left integer:=p_minutes;
 v_available integer;
 v_take integer;
 v_iteration integer:=0;
BEGIN
 IF p_start NOT BETWEEN 0 AND 22 OR p_end NOT BETWEEN 1 AND 23
    OR p_end<=p_start OR p_minutes NOT BETWEEN 15 AND 2400
    OR p_timezone<>'America/Chicago' THEN
   RAISE EXCEPTION 'Invalid relationship reply working-hours policy' USING errcode='22023';
 END IF;
 WHILE v_left>0 LOOP
   v_iteration:=v_iteration+1;
   IF v_iteration>20 THEN RAISE EXCEPTION 'SLA calculation exceeded day bound' USING errcode='54000'; END IF;
   IF extract(isodow from v_local)>5 THEN
      v_local:=date_trunc('day',v_local)+interval '1 day';
      CONTINUE;
   END IF;
   IF v_local < date_trunc('day',v_local)+make_interval(hours=>p_start) THEN
      v_local:=date_trunc('day',v_local)+make_interval(hours=>p_start);
   END IF;
   IF v_local>=date_trunc('day',v_local)+make_interval(hours=>p_end) THEN
      v_local:=date_trunc('day',v_local)+interval '1 day';
      CONTINUE;
   END IF;
   v_available:=floor(extract(epoch FROM
     (date_trunc('day',v_local)+make_interval(hours=>p_end)-v_local))/60)::integer;
   v_take:=least(v_left,v_available);
   v_local:=v_local+make_interval(mins=>v_take);
   v_left:=v_left-v_take;
 END LOOP;
 RETURN v_local AT TIME ZONE p_timezone;
END;
$sla$;
REVOKE ALL ON FUNCTION private.relationship_work_minutes_due_v1(timestamptz,text,integer,integer,integer)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.assign_reply_follow_up_sla_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $trigger$
DECLARE v_policy private.relationship_reply_sla_policy%rowtype;
BEGIN
 IF NEW.status NOT IN ('new','needs_action') OR NEW.follow_up_due_at IS NOT NULL
 THEN RETURN NEW; END IF;
 SELECT * INTO v_policy FROM private.relationship_reply_sla_policy
 WHERE tenant_id=NEW.tenant_id;
 IF FOUND AND v_policy.enabled THEN
   NEW.follow_up_due_at:=private.relationship_work_minutes_due_v1(
      coalesce(NEW.created_at,now()),v_policy.timezone,
      v_policy.work_start_hour,v_policy.work_end_hour,v_policy.target_work_minutes);
   NEW.metadata:=coalesce(NEW.metadata,'{}'::jsonb) ||
     jsonb_build_object('follow_up_sla_rule','one_business_day',
                       'follow_up_sla_minutes',v_policy.target_work_minutes);
 END IF;
 RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION private.assign_reply_follow_up_sla_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS relationship_reply_sla_on_insert_v1 ON public.relationship_replies;
CREATE TRIGGER relationship_reply_sla_on_insert_v1
BEFORE INSERT ON public.relationship_replies
FOR EACH ROW EXECUTE FUNCTION private.assign_reply_follow_up_sla_v1();

COMMENT ON TABLE private.relationship_reply_sla_policy IS
 'Operations-configurable human follow-up target; 8 working hours Mon-Fri 9-17 America/Chicago. Existing replies untouched; no automatic messages.';
