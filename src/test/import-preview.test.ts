import { describe, expect, it } from 'vitest';
import { previewRelationshipImport } from '@/domain/relationships/import-preview';

describe('import preview', () => {
  it('classifies create, ambiguous, and invalid rows', () => {
    const preview = previewRelationshipImport(
      'organization_name,website\nA,\nB,\n,https://invalid.example',
      {
        organization_name: 'organization_name',
        website: 'website',
      },
      {
        3: [
          {
            entity: 'organization',
            id: 'x',
            score: 80,
            signals: ['name'],
          },
        ],
      },
    );

    expect(preview.rows.map((row) => row.decision)).toEqual([
      'create',
      'ambiguous',
      'invalid',
    ]);
  });
});
