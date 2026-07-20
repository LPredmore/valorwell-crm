import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import type { AuditMetadata } from '@/domain/relationships/contracts';

export function PermissionedRelationshipAction({ label, allowed, capabilityAvailable, onClick }: { label: string; allowed: boolean; capabilityAvailable: boolean; onClick: () => void }) {
  const disabled = !allowed || !capabilityAvailable;
  const reason = !allowed ? 'You do not have permission for this action.' : 'Database support pending for this action.';
  return <Button disabled={disabled} title={disabled ? reason : undefined} onClick={onClick}>{label}</Button>;
}

export function SafeExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"><span>{children}</span><ExternalLink aria-hidden className="h-3.5 w-3.5" /></a>;
}

export function RelationshipPagination({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return <div className="flex items-center justify-between gap-3" aria-label="Pagination"><p className="text-sm text-muted-foreground">Page {page} of {lastPage}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => onPageChange(page + 1)}>Next</Button></div></div>;
}

export function ConfirmRelationshipAction({ triggerLabel, title, description, confirmLabel, onConfirm }: { triggerLabel: string; title: string; description: string; confirmLabel: string; onConfirm: () => void }) {
  return <AlertDialog><AlertDialogTrigger asChild><Button variant="outline">{triggerLabel}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

export function RelationshipAuditMetadata({ audit }: { audit: AuditMetadata }) {
  return <dl className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2"><div><dt className="font-medium text-foreground">Created</dt><dd>{audit.createdAt}</dd></div><div><dt className="font-medium text-foreground">Last updated</dt><dd>{audit.updatedAt}</dd></div></dl>;
}

export function RelationshipTimelineShell({ title = 'Relationship timeline', hasItems, children }: { title?: string; hasItems: boolean; children?: React.ReactNode }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>Relationship-only activity; never a clinical client activity timeline.</CardDescription></CardHeader><CardContent>{hasItems ? children : <p className="text-sm text-muted-foreground">No relationship activity is available.</p>}</CardContent></Card>;
}
