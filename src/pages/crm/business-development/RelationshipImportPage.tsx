import { useMemo, useState } from 'react';
import { useMutation, useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileUp, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import type {
  ImportColumnMapping,
  ImportConflictDecision,
  ImportField,
} from '@/domain/relationships/contracts';
import type {
  RelationshipImportPreviewResult,
  RelationshipImportResolution,
  RelationshipImportRow,
} from '@/domain/relationships/import-contracts';
import { parseCsvRows } from '@/domain/relationships/import-normalization';
import {
  conflictDecisionsForRow,
  importConflictDecisionLabels,
  importDecisionLabel,
  importDecisionTone,
  importFieldDefinitions,
  parseCorrectedImportData,
  suggestImportMapping,
  validateImportMapping,
} from '@/domain/relationships/import-workflow';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

type ResolutionDraft = {
  decision?: ImportConflictDecision;
  selectedCandidateId?: string;
  note: string;
  correctedText: string;
};

type RowFilter = 'all' | 'unresolved' | 'create' | 'update' | 'excluded';

const pageSize = 25;

export default function RelationshipImportPage() {
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('imports');
  const available = capability?.available === true;
  const [filename, setFilename] = useState('relationship-import.csv');
  const [csv, setCsv] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ImportColumnMapping>({});
  const [sourceError, setSourceError] = useState<string>();
  const [preview, setPreview] = useState<RelationshipImportPreviewResult>();
  const [previewIdInput, setPreviewIdInput] = useState('');
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<number, ResolutionDraft>>({});
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const [page, setPage] = useState(1);

  const synchronizePreview = (result: RelationshipImportPreviewResult) => {
    setPreview(result);
    setPreviewIdInput(result.previewId);
    setPage(1);
    setResolutionDrafts((current) => {
      const next: Record<number, ResolutionDraft> = {};
      for (const row of result.rows) {
        if (!isUnresolved(row)) continue;
        next[row.row] = current[row.row] ?? {
          note: '',
          correctedText: JSON.stringify(row.normalizedData, null, 2),
        };
      }
      return next;
    });
  };

  const analyzeCsv = () => {
    setSourceError(undefined);
    const parsed = parseCsvRows(csv.replace(/^\uFEFF/, ''));
    if (parsed.errors.length) {
      setHeaders([]);
      setSampleRows([]);
      setSourceError(parsed.errors.join(' '));
      return;
    }
    const [rawHeaders = [], ...rows] = parsed.rows;
    const nextHeaders = rawHeaders.map((header) => header.trim());
    if (!nextHeaders.length || nextHeaders.every((header) => !header)) {
      setSourceError('The CSV must include a header row.');
      return;
    }
    if (nextHeaders.some((header) => !header)) {
      setSourceError('CSV headers cannot be blank.');
      return;
    }
    if (new Set(nextHeaders).size !== nextHeaders.length) {
      setSourceError('CSV headers must be unique.');
      return;
    }
    if (!rows.length) {
      setSourceError('The CSV must include at least one data row.');
      return;
    }

    setHeaders(nextHeaders);
    setSampleRows(rows.slice(0, 4).map((values) => Object.fromEntries(
      nextHeaders.map((header, index) => [header, values[index] ?? '']),
    )));
    setMapping(suggestImportMapping(nextHeaders));
    setPreview(undefined);
    setResolutionDrafts({});
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    setFilename(file.name);
    const text = await file.text();
    setCsv(text);
    setSourceError(undefined);
    const parsed = parseCsvRows(text.replace(/^\uFEFF/, ''));
    if (parsed.errors.length) {
      setHeaders([]);
      setSampleRows([]);
      setSourceError(parsed.errors.join(' '));
      return;
    }
    const [rawHeaders = [], ...rows] = parsed.rows;
    const nextHeaders = rawHeaders.map((header) => header.trim());
    if (!nextHeaders.length || nextHeaders.some((header) => !header) || new Set(nextHeaders).size !== nextHeaders.length || !rows.length) {
      setHeaders([]);
      setSampleRows([]);
      setSourceError('The file needs a unique, nonblank header row and at least one data row.');
      return;
    }
    setHeaders(nextHeaders);
    setSampleRows(rows.slice(0, 4).map((values) => Object.fromEntries(
      nextHeaders.map((header, index) => [header, values[index] ?? '']),
    )));
    setMapping(suggestImportMapping(nextHeaders));
    setPreview(undefined);
    setResolutionDrafts({});
  };

  const createPreview = useMutation({
    mutationFn: async () => {
      const mappingErrors = validateImportMapping(mapping);
      if (mappingErrors.length) throw new Error(mappingErrors.join(' '));
      return dataProvider.relationships.previewImport({
        csv,
        mapping,
        filename: filename.trim() || 'relationship-import.csv',
        sourceType: 'csv',
      });
    },
    onSuccess: synchronizePreview,
  });

  const reloadPreview = useMutation({
    mutationFn: async () => {
      if (!previewIdInput.trim()) throw new Error('Enter an import preview ID.');
      return dataProvider.relationships.getImportPreview(previewIdInput.trim());
    },
    onSuccess: synchronizePreview,
  });

  const applyResolutions = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error('Create or reload an import preview first.');
      const resolutions: RelationshipImportResolution[] = [];
      for (const row of preview.rows.filter(isUnresolved)) {
        const draft = resolutionDrafts[row.row];
        if (!draft?.decision) continue;
        resolutions.push({
          row: row.row,
          candidates: row.candidates,
          decision: draft.decision,
          selectedCandidateId: draft.selectedCandidateId,
          note: draft.note.trim() || undefined,
          correctedData: draft.decision === 'correct_source'
            ? parseCorrectedImportData(draft.correctedText)
            : undefined,
        });
      }
      if (!resolutions.length) throw new Error('Choose at least one row resolution.');
      return dataProvider.relationships.resolveImportConflicts({
        previewId: preview.previewId,
        expectedVersion: preview.version,
        conflicts: resolutions,
      });
    },
    onSuccess: synchronizePreview,
  });

  const commitImport = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error('Create or reload an import preview first.');
      if (preview.status !== 'ready' || preview.conflictCount > 0) {
        throw new Error('Resolve or exclude every conflict before committing.');
      }
      await dataProvider.relationships.commitImport({
        previewId: preview.previewId,
        expectedVersion: preview.version,
        idempotencyKey: `relationship-import:${preview.previewId}`,
      });
      return dataProvider.relationships.getImportPreview(preview.previewId);
    },
    onSuccess: synchronizePreview,
  });

  const candidateKeys = useMemo(() => {
    const keys = new Map<string, { entity: 'organization' | 'contact'; id: string }>();
    for (const row of preview?.rows ?? []) {
      for (const candidate of row.candidates) {
        keys.set(`${candidate.entity}:${candidate.id}`, { entity: candidate.entity, id: candidate.id });
      }
    }
    return [...keys.values()];
  }, [preview]);

  const candidateQueries = useQueries({
    queries: candidateKeys.map((candidate) => ({
      queryKey: [`relationship-${candidate.entity}`, candidate.id],
      queryFn: () => candidate.entity === 'organization'
        ? dataProvider.relationships.getOrganization(candidate.id)
        : dataProvider.relationships.getContact(candidate.id),
      enabled: available,
      retry: false,
    })),
  });

  const candidateLabels = new Map(candidateKeys.map((candidate, index) => {
    const data = candidateQueries[index]?.data;
    const label = candidate.entity === 'organization'
      ? data && 'name' in data ? data.name : candidate.id
      : data && 'displayName' in data ? data.displayName : candidate.id;
    return [`${candidate.entity}:${candidate.id}`, label] as const;
  }));

  const filteredRows = useMemo(() => {
    const rows = preview?.rows ?? [];
    if (rowFilter === 'all') return rows;
    if (rowFilter === 'unresolved') return rows.filter(isUnresolved);
    return rows.filter((row) => row.decision === rowFilter);
  }, [preview, rowFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const mappingErrors = headers.length ? validateImportMapping(mapping) : [];
  const anyPending = createPreview.isPending || reloadPreview.isPending || applyResolutions.isPending || commitImport.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Relationship imports</h1>
          <p className="mt-2 text-muted-foreground">Preview, normalize, resolve, and commit non-clinical Business Development records without touching clinical or inbound-interest data.</p>
        </div>
        <Button asChild variant="outline"><Link to="/crm/business-development/status">System status</Link></Button>
      </div>

      <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }}>
        <p className="text-sm text-muted-foreground">Imports use the tenant-scoped Billing Hub relationship backend. Raw source rows are returned only to CRM administrators.</p>
      </RelationshipCapabilityState>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" />Recover an existing preview</CardTitle>
          <CardDescription>Every preview is persisted. Reload by ID after navigation, refresh, or an interrupted resolution session.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Input aria-label="Import preview ID" value={previewIdInput} onChange={(event) => setPreviewIdInput(event.target.value)} placeholder="Import preview UUID" />
          <Button type="button" variant="outline" disabled={!available || reloadPreview.isPending} onClick={() => reloadPreview.mutate()}>{reloadPreview.isPending ? 'Loading…' : 'Load preview'}</Button>
          {reloadPreview.isError && <p className="self-center text-sm text-destructive">{errorMessage(reloadPreview.error, 'The import preview could not be loaded.')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileUp className="h-5 w-5" />1. Select CSV source</CardTitle>
          <CardDescription>Upload a CSV or paste its contents. No relationship record is written during analysis or preview.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="relationship-import-filename">Filename</Label><Input id="relationship-import-filename" value={filename} onChange={(event) => setFilename(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="relationship-import-file">CSV file</Label><Input id="relationship-import-file" type="file" accept=".csv,text/csv" onChange={(event) => { void handleFile(event.target.files?.[0]); }} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="relationship-import-csv">CSV contents</Label><Textarea id="relationship-import-csv" className="min-h-48 font-mono text-xs" value={csv} onChange={(event) => setCsv(event.target.value)} placeholder="Organization,Website,Email&#10;Example Organization,https://example.org,hello@example.org" /></div>
          {sourceError && <p className="text-sm text-destructive">{sourceError}</p>}
          <Button type="button" variant="outline" disabled={!available || !csv.trim() || anyPending} onClick={analyzeCsv}>Analyze headers</Button>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>2. Map columns</CardTitle>
            <CardDescription>Confirm the suggested destination for each source column. Organization name is required, and each destination may be used once.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/50 text-left"><tr><th className="p-3">CSV column</th><th className="p-3">Sample values</th><th className="p-3">Destination</th></tr></thead>
                <tbody>
                  {headers.map((header) => (
                    <tr className="border-t align-top" key={header}>
                      <td className="p-3 font-medium">{header}</td>
                      <td className="max-w-sm p-3 text-xs text-muted-foreground">{sampleRows.map((row) => row[header]).filter(Boolean).slice(0, 3).join(' · ') || 'No sample value'}</td>
                      <td className="p-3">
                        <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={mapping[header] ?? 'ignore'} onChange={(event) => setMapping((current) => ({ ...current, [header]: event.target.value as ImportField | 'ignore' }))}>
                          <option value="ignore">Ignore column</option>
                          {importFieldDefinitions.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}
                        </select>
                        {mapping[header] !== 'ignore' && <p className="mt-1 text-xs text-muted-foreground">{importFieldDefinitions.find((field) => field.value === mapping[header])?.description}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mappingErrors.map((error) => <p className="text-sm text-destructive" key={error}>{error}</p>)}
            {createPreview.isError && <p className="text-sm text-destructive">{errorMessage(createPreview.error, 'The import preview could not be created.')}</p>}
            <Button type="button" disabled={!available || mappingErrors.length > 0 || anyPending} onClick={() => createPreview.mutate()}>{createPreview.isPending ? 'Creating preview…' : 'Create server preview'}</Button>
          </CardContent>
        </Card>
      )}

      {preview && (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><CardTitle>3. Review preview</CardTitle><CardDescription>Preview ID: <span className="font-mono">{preview.previewId}</span> · Version {preview.version}</CardDescription></div>
                <Badge variant={preview.status === 'completed' ? 'default' : preview.status === 'ready' ? 'secondary' : 'outline'}>{preview.status.replace(/_/g, ' ')}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Metric label="Rows" value={preview.rowCount} />
                <Metric label="Valid" value={preview.validRowCount} />
                <Metric label="Conflicts" value={preview.conflictCount} />
                <Metric label="Excluded" value={preview.excludedCount} />
                <Metric label="Committed" value={preview.committedCount} />
              </div>
              {preview.status === 'ready' && <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Every row is ready to commit.</p>}
              {preview.conflictCount > 0 && <p className="flex items-center gap-2 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" />Resolve, correct, or exclude every conflict before commit.</p>}
              <div className="flex flex-wrap gap-2">
                {(['all', 'unresolved', 'create', 'update', 'excluded'] as RowFilter[]).map((filter) => <Button key={filter} type="button" size="sm" variant={rowFilter === filter ? 'default' : 'outline'} onClick={() => { setRowFilter(filter); setPage(1); }}>{filter.replace(/_/g, ' ')}</Button>)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Preview rows</CardTitle><CardDescription>{filteredRows.length} rows in this view. Only the current page is rendered for large imports.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {visibleRows.length === 0 && <p className="text-sm text-muted-foreground">No rows match this view.</p>}
              {visibleRows.map((row) => (
                <ImportRowCard
                  key={row.row}
                  row={row}
                  draft={resolutionDrafts[row.row]}
                  candidateLabels={candidateLabels}
                  disabled={anyPending || preview.status === 'completed'}
                  onChange={(draft) => setResolutionDrafts((current) => ({ ...current, [row.row]: draft }))}
                />
              ))}
              {filteredRows.length > pageSize && <div className="flex items-center justify-between"><Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span><Button type="button" variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</Button></div>}
            </CardContent>
          </Card>

          {preview.status !== 'completed' && (
            <Card>
              <CardHeader><CardTitle>4. Resolve and commit</CardTitle><CardDescription>Resolution updates are version-checked. Commit is transactional and idempotent.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {applyResolutions.isError && <p className="text-sm text-destructive">{errorMessage(applyResolutions.error, 'The row resolutions could not be applied.')}</p>}
                {commitImport.isError && <p className="text-sm text-destructive">{errorMessage(commitImport.error, 'The import could not be committed.')}</p>}
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="outline" disabled={anyPending || !preview.rows.some((row) => isUnresolved(row) && resolutionDrafts[row.row]?.decision)} onClick={() => applyResolutions.mutate()}>{applyResolutions.isPending ? 'Applying decisions…' : 'Apply selected decisions'}</Button>
                  <Button type="button" disabled={anyPending || preview.status !== 'ready' || preview.conflictCount > 0} onClick={() => commitImport.mutate()}>{commitImport.isPending ? 'Committing import…' : 'Commit import'}</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {preview.status === 'completed' && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5" />Import completed</CardTitle><CardDescription>{preview.committedCount} rows were committed. Excluded rows were preserved in the import ledger but not written as relationships.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {preview.rows.filter((row) => row.committedOrganizationId || row.committedContactId || row.committedOpportunityId).map((row) => (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm" key={row.row}>
                    <span className="font-medium">CSV row {row.row}</span>
                    {row.committedOrganizationId && <Link className="text-primary hover:underline" to={`/crm/business-development/organizations/${row.committedOrganizationId}`}>Organization</Link>}
                    {row.committedContactId && <Link className="text-primary hover:underline" to={`/crm/business-development/contacts/${row.committedContactId}`}>Contact</Link>}
                    {row.committedOpportunityId && <Link className="text-primary hover:underline" to={`/crm/business-development/opportunities/${row.committedOpportunityId}`}>Opportunity</Link>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function ImportRowCard({ row, draft, candidateLabels, disabled, onChange }: {
  row: RelationshipImportRow;
  draft?: ResolutionDraft;
  candidateLabels: Map<string, string>;
  disabled: boolean;
  onChange: (draft: ResolutionDraft) => void;
}) {
  const unresolved = isUnresolved(row);
  const decisions = unresolved ? conflictDecisionsForRow(row) : [];
  const selectedEntity = draft?.decision === 'link_contact' ? 'contact' : 'organization';
  const selectableCandidates = row.candidates.filter((candidate) => {
    if (draft?.decision === 'create_contact') return candidate.entity === 'organization';
    if (draft?.decision === 'link_contact' || draft?.decision === 'link_organization') return candidate.entity === selectedEntity;
    return false;
  });
  const requiresCandidate = draft?.decision === 'link_contact' || draft?.decision === 'link_organization';
  const offersCandidate = requiresCandidate || (draft?.decision === 'create_contact' && selectableCandidates.length > 0);
  const currentDraft = draft ?? { note: '', correctedText: JSON.stringify(row.normalizedData, null, 2) };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold">CSV row {row.row}</p><p className="mt-1 text-xs text-muted-foreground">{summaryLine(row.normalizedData)}</p></div>
        <Badge variant={importDecisionTone(row.decision)}>{importDecisionLabel(row.decision)}</Badge>
      </div>
      {row.errors.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">{row.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
      {row.candidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Duplicate candidates</p>
          {row.candidates.map((candidate) => (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2 text-xs" key={`${candidate.entity}:${candidate.id}`}>
              <Badge variant="outline">{candidate.entity}</Badge>
              <span className="font-medium">{candidateLabels.get(`${candidate.entity}:${candidate.id}`) ?? candidate.id}</span>
              <span className="text-muted-foreground">Score {candidate.score} · {candidate.signals.join(', ')}</span>
              <Link className="ml-auto text-primary hover:underline" to={`/crm/business-development/${candidate.entity === 'organization' ? 'organizations' : 'contacts'}/${candidate.id}`}>Open</Link>
            </div>
          ))}
        </div>
      )}
      <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Normalized row data</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(row.normalizedData, null, 2)}</pre>{row.rawData && <><p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Admin raw source row</p><pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(row.rawData, null, 2)}</pre></>}</details>

      {unresolved && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor={`resolution-${row.row}`}>Resolution</Label><select id={`resolution-${row.row}`} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" disabled={disabled} value={currentDraft.decision ?? ''} onChange={(event) => onChange({ ...currentDraft, decision: event.target.value as ImportConflictDecision || undefined, selectedCandidateId: undefined })}><option value="">Choose a decision</option>{decisions.map((decision) => <option key={decision} value={decision}>{importConflictDecisionLabels[decision]}</option>)}</select></div>
          {offersCandidate && <div className="space-y-2"><Label htmlFor={`candidate-${row.row}`}>{requiresCandidate ? 'Required candidate' : 'Organization candidate (optional)'}</Label><select id={`candidate-${row.row}`} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" disabled={disabled} value={currentDraft.selectedCandidateId ?? ''} onChange={(event) => onChange({ ...currentDraft, selectedCandidateId: event.target.value || undefined })}><option value="">{requiresCandidate ? 'Select candidate' : 'Create organization from row'}</option>{selectableCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidateLabels.get(`${candidate.entity}:${candidate.id}`) ?? candidate.id}</option>)}</select></div>}
          {currentDraft.decision === 'correct_source' && <div className="space-y-2 md:col-span-2"><Label htmlFor={`corrected-${row.row}`}>Corrected normalized data (JSON)</Label><Textarea id={`corrected-${row.row}`} className="min-h-48 font-mono text-xs" disabled={disabled} value={currentDraft.correctedText} onChange={(event) => onChange({ ...currentDraft, correctedText: event.target.value })} /></div>}
          <div className="space-y-2 md:col-span-2"><Label htmlFor={`resolution-note-${row.row}`}>Internal resolution note</Label><Input id={`resolution-note-${row.row}`} disabled={disabled} value={currentDraft.note} onChange={(event) => onChange({ ...currentDraft, note: event.target.value })} placeholder="Optional reason or verification note" /></div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}

function isUnresolved(row: RelationshipImportRow) {
  return row.decision === 'duplicate' || row.decision === 'ambiguous' || row.decision === 'invalid';
}

function summaryLine(data: Record<string, unknown>) {
  const values = ['organization_name', 'contact_name', 'contact_email', 'website']
    .map((key) => data[key])
    .filter((value): value is string => typeof value === 'string' && Boolean(value));
  return values.join(' · ') || 'No display fields were normalized.';
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
