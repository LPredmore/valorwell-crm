# Isolated campaign lifecycle acceptance

`run-campaign-lifecycle-acceptance.py` extends the reviewed Billing Hub 5B/5C
runner with actual campaign SQL and signed GoTrue/PostgREST security regressions.
It requires local PostgreSQL tools, Docker, Node, and reviewed Billing Hub and
Clients checkouts supplied with `--billing-repo` and `--clients-repo`.

The runner creates its own loopback cluster. Every SQL mutation uses the existing
active-connection guard (system identifier, data directory, cluster, port and
database) and `ON_ERROR_STOP`. It never accepts a database URL or production
credential. It runs the unchanged original 5B fixture, including its session
setting and ending rollback, plus all original 5C assertions.

Additional cases cover all six campaign mutation RPCs, readonly and foreign
callers, independent actor/tenant/target/operation key scope, unfinished claims,
same-key and different-key concurrent PostgreSQL sessions, exact successful
replay, all five transitions, and empty-batch manual enrollment compatibility.
Real GoTrue-issued tokens exercise browser denials for all six public RPCs and
the internal helpers. Stripe ACL checks use the exact Clients function and
Billing Hub corrective migration; the service control uses a missing session,
so no payment or allocation is posted.

`--baseline` skips only the new corrective migration and keeps every expected
assertion unchanged, reproducing the original failures. `--output-dir` selects
the evidence directory. Clusters and containers are stopped on completion.
Synthetic dependency tables are reviewed minimal contracts, not a reconstruction
of the complete production schema. This suite does not prove full application
browser workflows, live deployment, or external payment webhook behavior.


Current-main compatibility also covers fail-closed retired-donor reporting and
replay refusal, including overlapping synthetic provider identities under two
real signed tenant JWTs. New migration versions are checked across all three
shared-database checkouts before initialization; `--check-migration-sequence-only`
performs that read-only check without creating a database.
