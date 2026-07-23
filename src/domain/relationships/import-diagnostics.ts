export type RelationshipImportOperation = 'preview' | 'reload' | 'resolve' | 'commit';

export type RelationshipImportDiagnostic = {
  diagnosticId: string;
  operation: RelationshipImportOperation;
  previewId?: string;
  expectedVersion?: number;
  occurredAt: string;
  code?: string;
  message: string;
  details?: string;
  hint?: string;
  stalePreview: boolean;
};

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

export class RelationshipImportOperationError extends Error {
  readonly diagnostic: RelationshipImportDiagnostic;

  constructor(diagnostic: RelationshipImportDiagnostic) {
    const guidance = diagnostic.stalePreview
      ? 'Create a refreshed server preview from the current CSV, review any newly detected matches, and then commit the new preview.'
      : diagnostic.hint;
    super([diagnostic.message, guidance, `Diagnostic ID: ${diagnostic.diagnosticId}`]
      .filter(Boolean)
      .join(' '));
    this.name = 'RelationshipImportOperationError';
    this.diagnostic = diagnostic;
  }
}

export function createRelationshipImportOperationError(
  error: unknown,
  context: {
    operation: RelationshipImportOperation;
    previewId?: string;
    expectedVersion?: number;
    diagnosticId?: string;
    occurredAt?: string;
  },
): RelationshipImportOperationError {
  if (error instanceof RelationshipImportOperationError) return error;

  const source = isRecord(error) ? error as ErrorLike : {};
  const message = text(source.message)
    ?? (error instanceof Error ? error.message : String(error || 'Relationship import operation failed.'));
  const code = text(source.code);
  const details = text(source.details);
  const hint = text(source.hint);
  const stalePreview = details === 'RELATIONSHIP_IMPORT_STALE_PREVIEW'
    || message.toLowerCase().includes('after preview')
    || message.toLowerCase().includes('import changed after it was loaded')
    || message.toLowerCase().includes('no longer available for row')
    || message.toLowerCase().includes('no longer active for row');

  const diagnostic: RelationshipImportDiagnostic = {
    diagnosticId: context.diagnosticId ?? newDiagnosticId(context.operation),
    operation: context.operation,
    previewId: context.previewId,
    expectedVersion: context.expectedVersion,
    occurredAt: context.occurredAt ?? new Date().toISOString(),
    code,
    message,
    details,
    hint,
    stalePreview,
  };

  return new RelationshipImportOperationError(diagnostic);
}

export function importDiagnosticFromError(error: unknown): RelationshipImportDiagnostic | undefined {
  return error instanceof RelationshipImportOperationError ? error.diagnostic : undefined;
}

export function formatRelationshipImportDiagnostic(diagnostic: RelationshipImportDiagnostic): string {
  return [
    `Diagnostic ID: ${diagnostic.diagnosticId}`,
    `Operation: ${diagnostic.operation}`,
    `Preview ID: ${diagnostic.previewId ?? 'not created'}`,
    `Expected version: ${diagnostic.expectedVersion ?? 'not supplied'}`,
    `Occurred at: ${diagnostic.occurredAt}`,
    `Code: ${diagnostic.code ?? 'unavailable'}`,
    `Message: ${diagnostic.message}`,
    `Details: ${diagnostic.details ?? 'unavailable'}`,
    `Hint: ${diagnostic.hint ?? 'unavailable'}`,
    `Stale preview: ${diagnostic.stalePreview ? 'yes' : 'no'}`,
  ].join('\n');
}

function newDiagnosticId(operation: RelationshipImportOperation): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `relationship-import:${operation}:${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
