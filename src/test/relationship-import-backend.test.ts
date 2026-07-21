import { describe, expect, it } from 'vitest';
import type { Json } from '@/integrations/supabase/types';
import {
  mapRelationshipImportPreview,
  parseRelationshipImportCsv,
  relationshipImportResolutions,
} from '@/repositories/supabase/relationships-import-mappers';

describe('relationship import backend adapter', () => {
  it('parses arbitrary CSV headers using the selected mapping', () => {
    expect(parseRelationshipImportCsv(
      'Organization,Email\nValorWell Partner,hello@example.com',
      { Organization: 'organization_name', Email: 'contact_email' },
    )).toEqual({
      headers: ['Organization', 'Email'],
      rows: [{ Organization: 'ValorWell Partner', Email: 'hello@example.com' }],
    });
  });

  it('rejects missing mapped headers and duplicate CSV headers', () => {
    expect(() => parseRelationshipImportCsv(
      'Organization,Organization\nA,B',
      { Organization: 'organization_name' },
    )).toThrow('CSV headers must be unique.');
    expect(() => parseRelationshipImportCsv(
      'Organization\nA',
      { Missing: 'organization_name' },
    )).toThrow('Mapped CSV header was not found: Missing.');
  });

  it('maps sanitized server previews without requiring raw source rows', () => {
    const payload = {
      previewId: 'preview-1',
      status: 'ready',
      version: 2,
      filename: 'organizations.csv',
      sourceType: 'csv',
      mapping: { Organization: 'organization_name' },
      headers: ['Organization'],
      rowCount: 1,
      validRowCount: 1,
      conflictCount: 0,
      excludedCount: 0,
      committedCount: 0,
      valid: true,
      rows: [{
        row: 2,
        decision: 'create',
        errors: [],
        candidates: [],
        resolution: {},
        normalizedData: { organization_name: 'ValorWell Partner' },
      }],
      conflicts: [],
      excludedRows: [],
      canViewRawRows: false,
      createdAt: '2026-07-21T00:00:00Z',
      updatedAt: '2026-07-21T00:00:01Z',
      completedAt: null,
    } as unknown as Json;

    const result = mapRelationshipImportPreview(payload);
    expect(result.previewId).toBe('preview-1');
    expect(result.rows[0].rawData).toBeUndefined();
    expect(result.canViewRawRows).toBe(false);
  });

  it('requires complete conflict decisions before calling the RPC', () => {
    expect(() => relationshipImportResolutions([{ row: 2, candidates: [] }]))
      .toThrow('Select a resolution for CSV row 2.');
    expect(() => relationshipImportResolutions([{
      row: 2,
      candidates: [],
      decision: 'correct_source',
    }])).toThrow('Provide corrected data for CSV row 2.');
  });
});
