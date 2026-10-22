-- Repair 20261022021100: a sub-minute remainder could floor to zero and loop
-- until "SLA calculation exceeded day bound", aborting Gmail ingestion.
-- Forward-only: preserve the original RPC signature and its service-role ACL.
CREATE OR REPLACE FUNCTION private.relationship_work_minutes_due_v1(
 p_created timestamptz,p_timezone text,p_start integer,p_end integer,p_minutes integer)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=''
AS $sla$
DECLARE
 v_local timestamp := coalesce(p_created,now()) AT TIME ZONE p_timezone;
 v_remaining interval := make_interval(mins=>p_minutes);
 v_start timestamp;
 v_end timestamp;
 v_available interval;
 v_day integer := 0;
BEGIN
 IF p_start NOT BETWEEN 0 AND 22 OR p_end NOT BETWEEN 1 AND 23
    OR p_end<=p_start OR p_minutes NOT BETWEEN 15 AND 2400
    OR p_timezone<>'America/Chicago' THEN
   RAISE EXCEPTION 'Invalid relationship reply working-hours policy' USING errcode='22023';
 END IF;

 -- The minimum allowed workday is one hour, while the maximum target is
 -- 2400 work minutes (= 40 one-hour workdays). Allow weekend crossings.
 FOR v_day IN 1..128 LOOP
   IF extract(isodow from v_local)>5 THEN
      v_local:=date_trunc('day',v_local)+interval '1 day';
      CONTINUE;
   END IF;

   v_start:=date_trunc('day',v_local)+make_interval(hours=>p_start);
   v_end:=date_trunc('day',v_local)+make_interval(hours=>p_end);

   IF v_local<v_start THEN v_local:=v_start; END IF;
   IF v_local>=v_end THEN
      v_local:=date_trunc('day',v_local)+interval '1 day';
      CONTINUE;
   END IF;

   -- Compare intervals precisely. Do NOT floor to integral minutes:
   -- e.g. 16:59:30 has 30 seconds of usable work, not zero progress.
   v_available:=v_end-v_local;
   IF v_remaining<=v_available THEN
      RETURN (v_local+v_remaining) AT TIME ZONE p_timezone;
   END IF;
   v_remaining:=v_remaining-v_available;
   v_local:=date_trunc('day',v_local)+interval '1 day';
 END LOOP;
 RAISE EXCEPTION 'SLA calculation exceeded day bound' USING errcode='54000';
END;
$sla$;
REVOKE ALL ON FUNCTION private.relationship_work_minutes_due_v1(
 timestamptz,text,integer,integer,integer) FROM PUBLIC,anon,authenticated;

-- This migration changes no previously recorded SLA dates, sends no mail,
-- and does not alter Gmail Pub/Sub subscriptions or delivery acknowledgments.
