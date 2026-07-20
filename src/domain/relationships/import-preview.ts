import type {
  DuplicateCandidate,
  ImportColumnMapping,
  ImportPreviewResult,
} from './contracts';
import { parseCsvRows } from './import-normalization';

type ImportDecision = ImportPreviewResult['rows'][number]['decision'];

export function previewRelationshipImport(
  csv: string,
  mapping: ImportColumnMapping,
  candidates: Record<number, DuplicateCandidate[]> = {},
): ImportPreviewResult {
  const parsed = parseCsvRows(csv);

  if (parsed.errors.length > 0) {
    return {
      rows: [],
      mapping,
      valid: false,
      conflicts: [],
      excludedRows: [],
    };
  }

  const [headers = [], ...data] = parsed.rows;

  const rows = data.map((values, index) => {
    const row = index + 2;
    const record: Record<string, string> = {};

    headers.forEach((header, columnIndex) => {
      const mappedField = mapping[header];

      if (mappedField && mappedField !== 'ignore') {
        record[mappedField] = values[columnIndex] ?? '';
      }
    });

    const matches = candidates[row] ?? [];

    let decision: ImportDecision;

    if (!record.organization_name) {
      decision = 'invalid';
    } else if (matches.some((candidate) => candidate.score === 100)) {
      decision = 'duplicate';
    } else if (matches.length > 0) {
      decision = 'ambiguous';
    } else {
      decision = 'create';
    }

    return {
      row,
      decision,
      errors:
        decision === 'invalid'
          ? ['Organization name is required.']
          : [],
      candidates: matches,
    };
  });

  return {
    rows,
    mapping,
    valid: rows.every((row) => row.decision !== 'invalid'),
    conflicts: rows
      .filter((row) => row.decision === 'ambiguous')
      .map((row) => ({
        row: row.row,
        candidates: row.candidates,
      })),
    excludedRows: rows
      .filter((row) => row.decision === 'invalid')
      .map((row) => row.row),
  };
}
