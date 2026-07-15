import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function productionSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'test') continue;
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionSourceFiles(resolved));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(resolved);
    }
  }
  return files;
}

describe('CRM reporting source contract', () => {
  const sourceRoot = path.resolve(process.cwd(), 'src');
  const sourceFiles = productionSourceFiles(sourceRoot);
  const reportsPath = path.join(sourceRoot, 'repositories', 'supabase', 'reports.ts');
  const reportsSource = readFileSync(reportsPath, 'utf8');

  it('contains no unsupported aggregate risk view or reporting API', () => {
    const unsupportedView = ['v_crm_reports', 'at', 'risk'].join('_');
    const unsupportedMethod = ['at', 'Risk', 'Metrics'].join('');
    const references = sourceFiles.filter(file => {
      const source = readFileSync(file, 'utf8');
      return source.includes(unsupportedView) || source.includes(unsupportedMethod);
    });
    expect(references).toEqual([]);
  });

  it('reads only the six canonical report views and no raw metric tables', () => {
    const reportViews = [
      'v_crm_reports_funnel',
      'v_crm_reports_engagement',
      'v_crm_reports_closure',
      'v_crm_reports_campaigns',
      'v_crm_reports_tasks',
      'v_crm_reports_exceptions',
    ];
    for (const view of reportViews) {
      expect(reportsSource).toContain(`.from('${view}')`);
    }

    const rawMetricTables = [
      'clients',
      'crm_client_state_audit',
      'crm_campaign_enrollments',
      'crm_campaign_step_logs',
      'crm_tasks',
      'crm_exceptions',
      'crm_client_canonical_meta',
    ];
    for (const table of rawMetricTables) {
      expect(reportsSource).not.toContain(`.from('${table}')`);
    }
  });

  it('does not read raw or legacy controlled client-state columns', () => {
    for (const column of [
      'lifecycle_stage',
      'engagement_state',
      'at_risk_since',
      'closure_reason',
      'pat_status',
    ]) {
      expect(reportsSource).not.toContain(column);
    }
  });
});
