import { describe, expect, it } from 'vitest';
import type { RelationshipImportRow } from '@/domain/relationships/import-contracts';
import {
  conflictDecisionsForRow,
  mappedFieldDuplicates,
  parseCorrectedImportData,
  suggestImportMapping,
  validateImportMapping,
} from '@/domain/relationships/import-workflow';

describe('relationship import workflow', () => {
  it('suggests common mappings without assigning a destination twice', () => {
    const mapping = suggestImportMapping([
      'Company Name',
      'Website',
      'Contact Name',
      'Email Address',
      'Followers',
      'Unrecognized Column',
    ]);

    expect(mapping).toEqual({
      'Company Name': 'organization_name',
      Website: 'website',
      'Contact Name': 'contact_name',
      'Email Address': 'contact_email',
      Followers: 'bty_audience_reach',
      'Unrecognized Column': 'ignore',
    });
    expect(mappedFieldDuplicates(mapping)).toEqual([]);
  });

  it('requires organization name and rejects duplicate destination mappings', () => {
    expect(validateImportMapping({ Email: 'contact_email' }))
      .toEqual(['Map one CSV column to Organization name.']);
    expect(validateImportMapping({
      Organization: 'organization_name',
      Company: 'organization_name',
    })).toEqual([
      'Each destination field can be mapped once. Duplicates: organization_name.',
    ]);
  });

  it('offers safe decisions based on candidate entity types', () => {
    const row: RelationshipImportRow = {
      row: 2,
      decision: 'duplicate',
      errors: [],
      candidates: [{ entity: 'contact', id: 'contact-1', score: 100, signals: ['email'] }],
      resolution: {},
      normalizedData: { organization_name: 'Example', contact_email: 'hello@example.org' },
    };

    expect(conflictDecisionsForRow(row)).toEqual([
      'link_contact',
      'correct_source',
      'exclude',
      'defer',
    ]);
  });

  it('parses corrected JSON objects and rejects invalid values', () => {
    expect(parseCorrectedImportData('{"organization_name":"Corrected"}'))
      .toEqual({ organization_name: 'Corrected' });
    expect(() => parseCorrectedImportData('[]')).toThrow('Corrected data must be a JSON object.');
    expect(() => parseCorrectedImportData('{')).toThrow('Corrected data must be valid JSON.');
  });
});
