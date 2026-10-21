-- Read-only catalog contract for the email-signatures Storage ACL hardening
-- (GitHub issue #201). Operator-run ONLY — never executed by source CI and
-- never against production without explicit release approval.
--
-- Expected post-deployment state on an authorized isolated stack:
--   PASS 1  legacy bucket-wide write policies are gone
--   PASS 2  public SELECT policy exists and predicates on bucket_id only
--   PASS 3  INSERT requires CRM admin/operator capability (TO authenticated)
--   PASS 4  UPDATE requires capability in BOTH USING and WITH CHECK
--   PASS 5  DELETE requires CRM admin/operator capability
--   PASS 6  no write policy on email-signatures is granted TO PUBLIC/anon
--
-- Each SELECT returns one row: (check_name, pass_boolean). Any false row or
-- missing row is a FAIL. This catalog check does NOT prove signed-user
-- behavior; the issue #201 real-actor Storage API reproduction is still
-- required before production release.

WITH pol AS (
  SELECT p.polname,
         p.polcmd,
         p.polroles::regrole[]::text[] AS roles,
         pg_get_expr(p.polqual, p.polrelid) AS using_expr,
         pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage' AND c.relname = 'objects'
),
sig AS (
  SELECT * FROM pol
  WHERE COALESCE(using_expr, '') LIKE '%email-signatures%'
     OR COALESCE(check_expr, '') LIKE '%email-signatures%'
)
SELECT 'legacy_policies_removed' AS check_name,
       NOT EXISTS (
         SELECT 1 FROM sig
         WHERE polname IN (
           'Authenticated users can upload signature images',
           'Authenticated users can delete signature images',
           'Anyone can view signature images'
         )
       ) AS pass
UNION ALL
SELECT 'public_select_preserved',
       EXISTS (
         SELECT 1 FROM sig
         WHERE polname = 'email_signatures_public_select'
           AND polcmd = 'r'
           AND roles @> ARRAY['public']
           AND using_expr LIKE '%bucket_id%email-signatures%'
       )
UNION ALL
SELECT 'insert_requires_crm_capability',
       EXISTS (
         SELECT 1 FROM sig
         WHERE polname = 'email_signatures_crm_insert'
           AND polcmd = 'a'
           AND roles = ARRAY['authenticated']
           AND check_expr LIKE '%crm_user_capabilities%'
           AND check_expr LIKE '%crm_admin%'
           AND check_expr LIKE '%crm_operator%'
       )
UNION ALL
SELECT 'update_using_and_with_check',
       EXISTS (
         SELECT 1 FROM sig
         WHERE polname = 'email_signatures_crm_update'
           AND polcmd = 'w'
           AND roles = ARRAY['authenticated']
           AND using_expr LIKE '%crm_user_capabilities%'
           AND check_expr LIKE '%crm_user_capabilities%'
       )
UNION ALL
SELECT 'delete_requires_crm_capability',
       EXISTS (
         SELECT 1 FROM sig
         WHERE polname = 'email_signatures_crm_delete'
           AND polcmd = 'd'
           AND roles = ARRAY['authenticated']
           AND using_expr LIKE '%crm_user_capabilities%'
       )
UNION ALL
SELECT 'no_public_or_anon_write_policy',
       NOT EXISTS (
         SELECT 1 FROM sig
         WHERE polcmd IN ('a', 'w', 'd')
           AND (roles @> ARRAY['public'] OR roles @> ARRAY['anon'])
       )
ORDER BY check_name;
