import type {
  DuplicateCandidate,
  ImportColumnMapping,
  ImportConflictDecision,
} from './contracts';

export type RelationshipImportStatus =
  | 'draft'
  | 'previewed'
  | 'resolving'
  | 'ready'
  | 'committing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RelationshipImportDecision =
  | 'create'
  | 'update'
  | 'duplicate'
  | 'ambiguous'
  | 'invalid'
  | 'excluded';

export type RelationshipImportResolution = {
  row: number;
  candidates: DuplicateCandidate[];
  decision?: ImportConflictDecision;
  selectedCandidateId?: string;
  note?: string;
  correctedData?: Record<string, unknown>;
};

export type RelationshipImportRow = {
  row: number;
  decision: RelationshipImportDecision;
  errors: string[];
  candidates: DuplicateCandidate[];
  resolution: Record<string, unknown>;
  normalizedData: Record<string, unknown>;
  rawData?: Record<string, unknown>;
  committedOrganizationId?: string;
  committedContactId?: string;
  committedOpportunityId?: string;
};

export type RelationshipImportPreviewResult = {
  previewId: string;
  status: RelationshipImportStatus;
  version: number;
  filename: string;
  sourceType: string;
  mapping: ImportColumnMapping;
  headers: string[];
  rowCount: number;
  validRowCount: number;
  conflictCount: number;
  excludedCount: number;
  committedCount: number;
  valid: boolean;
  rows: RelationshipImportRow[];
  conflicts: RelationshipImportResolution[];
  excludedRows: number[];
  canViewRawRows: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
