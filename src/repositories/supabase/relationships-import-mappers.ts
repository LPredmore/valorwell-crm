import type { Json } from '@/integrations/supabase/types';
import type {
  DuplicateCandidate,
  ImportColumnMapping,
} from '@/domain/relationships/contracts';
import type {
  RelationshipImportDecision,
  RelationshipImportPreviewResult,
  RelationshipImportResolution,
  RelationshipImportRow,
  RelationshipImportStatus,
} from '@/domain/relationships/import-contracts';
import { parseCsvRows } from '@/domain/relationships/import-normalization';

const importStatuses = new Set<RelationshipImportStatus>([
  'draft',
  'previewed',
  'resolving',
  'ready',
  'committing',
  'completed',
  'failed',
  'cancelled',
]);

const importDecisions = new Set<RelationshipImportDecision>([
  'create',
  'update',
  'duplicate',
  'ambiguous',
  'invalid',
  'excluded',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`Invalid relationship import ${label}.`);
  return value;
}

function stringValue(value: unknown, label: string) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`Invalid relationship import ${label}.`);
  }
  return value;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value ? value : undefined;
}

function numberValue(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid relationship import ${label}.`);
  }
  return value;
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid relationship import ${label}.`);
  }
  return value as string[];
}

function numberArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number')) {
    throw new Error(`Invalid relationship import ${label}.`);
  }
  return value as number[];
}

function candidate(value: unknown): DuplicateCandidate {
  const record = objectValue(value, 'duplicate candidate');
  const entity = record.entity;
  if (entity !== 'organization' && entity !== 'contact') {
    throw new Error('Invalid relationship import candidate entity.');
  }
  return {
    entity,
    id: stringValue(record.id, 'candidate id'),
    score: numberValue(record.score, 'candidate score'),
    signals: stringArray(record.signals, 'candidate signals'),
  };
}

function candidates(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Invalid relationship import candidates.');
  return value.map(candidate);
}

function mappingValue(value: unknown): ImportColumnMapping {
  const record = objectValue(value, 'mapping');
  return Object.fromEntries(
    Object.entries(record).map(([header, field]) => {
      if (typeof field !== 'string') throw new Error('Invalid relationship import mapping field.');
      return [header, field];
    }),
  ) as ImportColumnMapping;
}

function rowValue(value: unknown): RelationshipImportRow {
  const record = objectValue(value, 'row');
  const decision = record.decision;
  if (typeof decision !== 'string' || !importDecisions.has(decision as RelationshipImportDecision)) {
    throw new Error('Invalid relationship import row decision.');
  }

  return {
    row: numberValue(record.row, 'row number'),
    decision: decision as RelationshipImportDecision,
    errors: stringArray(record.errors, 'row errors'),
    candidates: candidates(record.candidates),
    resolution: objectValue(record.resolution ?? {}, 'row resolution'),
    normalizedData: objectValue(record.normalizedData ?? {}, 'normalized row data'),
    rawData: record.rawData === undefined
      ? undefined
      : objectValue(record.rawData, 'raw row data'),
    committedOrganizationId: optionalString(record.committedOrganizationId),
    committedContactId: optionalString(record.committedContactId),
    committedOpportunityId: optionalString(record.committedOpportunityId),
  };
}

function conflictValue(value: unknown): RelationshipImportResolution {
  const record = objectValue(value, 'conflict');
  return {
    row: numberValue(record.row, 'conflict row'),
    candidates: candidates(record.candidates),
  };
}

export function parseRelationshipImportCsv(
  csv: string,
  mapping: ImportColumnMapping,
) {
  const parsed = parseCsvRows(csv.replace(/^\uFEFF/, ''));
  if (parsed.errors.length) throw new Error(parsed.errors.join(' '));

  const [rawHeaders = [], ...rawRows] = parsed.rows;
  const headers = rawHeaders.map((header) => header.trim());
  if (!headers.length || headers.every((header) => !header)) {
    throw new Error('The CSV must include a header row.');
  }
  if (headers.some((header) => !header)) {
    throw new Error('CSV headers cannot be blank.');
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error('CSV headers must be unique.');
  }
  if (!rawRows.length) throw new Error('The CSV must include at least one data row.');

  for (const header of Object.keys(mapping)) {
    if (!headers.includes(header)) {
      throw new Error(`Mapped CSV header was not found: ${header}.`);
    }
  }
  if (!Object.values(mapping).includes('organization_name')) {
    throw new Error('Map one CSV column to organization_name.');
  }

  const rows = rawRows.map((values, index) => {
    if (values.length > headers.length && values.slice(headers.length).some(Boolean)) {
      throw new Error(`CSV row ${index + 2} contains more values than the header row.`);
    }
    return Object.fromEntries(headers.map((header, column) => [header, values[column] ?? '']));
  });

  return { headers, rows };
}

export function mapRelationshipImportPreview(
  value: Json | undefined,
): RelationshipImportPreviewResult {
  const record = objectValue(value, 'preview response');
  const status = record.status;
  if (typeof status !== 'string' || !importStatuses.has(status as RelationshipImportStatus)) {
    throw new Error('Invalid relationship import status.');
  }
  if (!Array.isArray(record.rows) || !Array.isArray(record.conflicts)) {
    throw new Error('Invalid relationship import preview collections.');
  }

  return {
    previewId: stringValue(record.previewId, 'preview id'),
    status: status as RelationshipImportStatus,
    version: numberValue(record.version, 'version'),
    filename: stringValue(record.filename, 'filename'),
    sourceType: stringValue(record.sourceType, 'source type'),
    mapping: mappingValue(record.mapping),
    headers: stringArray(record.headers, 'headers'),
    rowCount: numberValue(record.rowCount, 'row count'),
    validRowCount: numberValue(record.validRowCount, 'valid row count'),
    conflictCount: numberValue(record.conflictCount, 'conflict count'),
    excludedCount: numberValue(record.excludedCount, 'excluded count'),
    committedCount: numberValue(record.committedCount, 'committed count'),
    valid: record.valid === true,
    rows: record.rows.map(rowValue),
    conflicts: record.conflicts.map(conflictValue),
    excludedRows: numberArray(record.excludedRows, 'excluded rows'),
    canViewRawRows: record.canViewRawRows === true,
    createdAt: stringValue(record.createdAt, 'created timestamp'),
    updatedAt: stringValue(record.updatedAt, 'updated timestamp'),
    completedAt: optionalString(record.completedAt),
  };
}

export function relationshipImportResolutions(
  conflicts: RelationshipImportResolution[],
): Json {
  return conflicts.map((conflict) => {
    if (!conflict.decision) {
      throw new Error(`Select a resolution for CSV row ${conflict.row}.`);
    }
    if (
      (conflict.decision === 'link_organization' || conflict.decision === 'link_contact')
      && !conflict.selectedCandidateId
    ) {
      throw new Error(`Select a duplicate candidate for CSV row ${conflict.row}.`);
    }
    if (conflict.decision === 'correct_source' && !conflict.correctedData) {
      throw new Error(`Provide corrected data for CSV row ${conflict.row}.`);
    }

    return {
      row: conflict.row,
      decision: conflict.decision,
      selectedCandidateId: conflict.selectedCandidateId ?? null,
      correctedData: conflict.correctedData ?? null,
      note: conflict.note?.trim() || null,
    };
  }) as Json;
}
