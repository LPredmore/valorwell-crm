import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20260819235200_clinical_recovery_provenance_ai_ops.sql', import.meta.url),
  'utf8',
);

const checks = [
  [migration.includes("'legacy_clinical_reconciliation'"), 'historical lifecycle reconciliation must have an explicit source'],
  [migration.includes("coalesce(new.source,'') in ('migration_backfill','legacy_clinical_reconciliation')"), 'historical reconciliation must not automatically cancel live campaigns'],
  [migration.includes("'clinical.legacy_reconciliation_backlog'"), 'AI Ops must expose the governed recovery backlog'],
  [migration.includes('private.clinical_recovery_cases'), 'AI Ops recovery evidence must come from the canonical recovery control plane'],
  [migration.includes('staleOver72Hours'), 'AI Ops must distinguish stale recovery cases from normal pending work'],
  [migration.includes('ai_ops_build_sop_compliance_batches'), 'recovery observations must feed the existing SOP compliance pipeline'],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  console.error(`Clinical recovery provenance verification failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(`Clinical recovery provenance verification passed (${checks.length} invariants).`);
