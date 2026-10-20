# Applicant source and review UI

## Changes
- Add acquisition-source badges and a counted All / Cold / Indeed / Legacy / Website / Other filter to the existing applicant list and connected recruiting board.
- Add expandable applicant review details, showing original source/referral source and supported résumé/contact notes separately from verified checks.
- Preserve current stage transitions, closed-record visibility rules, permissions, and all messaging behavior.

## Existing access limitation
Production contains 39 applicants (34 Legacy, four Indeed, one Website), but the existing authorized list/detail RPCs omit `applicant_origin` and `application_data`; the protected table has no browser SELECT access. Render missing fields as unavailable rather than inventing database-origin values or bypassing access. Consume these fields when the authorized response supplies them. No SQL changes are permitted here.

Manual applicant creation belongs to the separate Staff application; this CRM has no corresponding creation form. Do not introduce a new intake flow or change website sources.

## Technical details
- Keep generated origin read-only and parse optional camelCase/snake_case response fields.
- Traverse the existing authorized paged applicant contract before client-side source filtering; never drop historical closed records from the applicant directory.
- Add tests for origin parsing, complete paging, counts/filtering, missing-field handling, and note sanitization.
- Check preview build, run relevant tests, and report authenticated verification and commit limitations accurately.