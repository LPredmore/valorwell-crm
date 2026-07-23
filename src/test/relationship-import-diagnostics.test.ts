import { describe, expect, it } from 'vitest';
import {
  createRelationshipImportOperationError,
  formatRelationshipImportDiagnostic,
  importDiagnosticFromError,
} from '@/domain/relationships/import-diagnostics';

describe('relationship import diagnostics', () => {
  it('preserves structured PostgREST stale-preview diagnostics', () => {
    const error = createRelationshipImportOperationError({
      code: 'P0001',
      message: 'A matching organization appeared after preview for row 42.',
      details: 'RELATIONSHIP_IMPORT_STALE_PREVIEW',
      hint: 'Create a refreshed server preview.',
    }, {
      operation: 'commit',
      previewId: 'preview-42',
      expectedVersion: 3,
      diagnosticId: 'diagnostic-42',
      occurredAt: '2026-07-23T21:30:00.000Z',
    });

    expect(error.message).toContain('Create a refreshed server preview');
    expect(error.message).toContain('Diagnostic ID: diagnostic-42');
    expect(importDiagnosticFromError(error)).toEqual({
      diagnosticId: 'diagnostic-42',
      operation: 'commit',
      previewId: 'preview-42',
      expectedVersion: 3,
      occurredAt: '2026-07-23T21:30:00.000Z',
      code: 'P0001',
      message: 'A matching organization appeared after preview for row 42.',
      details: 'RELATIONSHIP_IMPORT_STALE_PREVIEW',
      hint: 'Create a refreshed server preview.',
      stalePreview: true,
    });
  });

  it('formats a privacy-safe diagnostic without source rows', () => {
    const error = createRelationshipImportOperationError(new Error('Network request failed.'), {
      operation: 'preview',
      diagnosticId: 'diagnostic-network',
      occurredAt: '2026-07-23T21:31:00.000Z',
    });
    const formatted = formatRelationshipImportDiagnostic(error.diagnostic);

    expect(formatted).toContain('Operation: preview');
    expect(formatted).toContain('Message: Network request failed.');
    expect(formatted).not.toContain('CSV');
  });
});
