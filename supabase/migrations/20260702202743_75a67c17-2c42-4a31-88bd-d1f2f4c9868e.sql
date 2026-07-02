
select vault.create_secret($CRON$__CRON_SECRET_PLACEHOLDER__$CRON$, 'cron_secret', 'Shared secret for pg_cron -> edge function invocation');
