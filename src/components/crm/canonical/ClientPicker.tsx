import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { cn } from '@/lib/utils';

export interface PickedClient {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}

interface Props {
  value: PickedClient | null;
  onChange: (client: PickedClient | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Filter results to those with a value in this contact channel. */
  requireChannel?: 'sms' | 'email';
}

interface Row {
  id: string;
  pat_name_f: string | null;
  pat_name_l: string | null;
  pat_name_preferred: string | null;
  email: string | null;
  phone: string | null;
}

function toDisplay(r: Row): string {
  if (r.pat_name_preferred?.trim()) return r.pat_name_preferred.trim();
  return `${r.pat_name_f ?? ''} ${r.pat_name_l ?? ''}`.trim() || 'Unnamed client';
}

export function ClientPicker({ value, onChange, placeholder = 'Select client…', disabled, requireChannel }: Props) {
  const { currentTenantId } = useCrmAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !currentTenantId) return;
    let cancelled = false;
    setLoading(true);
    const s = query.trim().replace(/[,()]/g, ' ');
    const run = async () => {
      let q = supabase
        .from('clients')
        .select('id, pat_name_f, pat_name_l, pat_name_preferred, email, phone')
        .eq('tenant_id', currentTenantId)
        .order('pat_name_l', { ascending: true })
        .limit(20);
      if (s) {
        q = q.or(
          `pat_name_f.ilike.%${s}%,pat_name_l.ilike.%${s}%,pat_name_preferred.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`,
        );
      }
      if (requireChannel === 'email') q = q.not('email', 'is', null);
      if (requireChannel === 'sms') q = q.not('phone', 'is', null);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        setRows([]);
      } else {
        setRows((data ?? []) as Row[]);
      }
      setLoading(false);
    };
    const t = setTimeout(run, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query, currentTenantId, requireChannel]);

  const label = useMemo(() => value?.displayName ?? placeholder, [value, placeholder]);

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className={cn('w-full justify-between', !value && 'text-muted-foreground')}
          >
            <span className="truncate">{label}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <div className="flex items-center gap-2 border-b px-2 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, phone…"
              className="h-8 border-0 p-0 focus-visible:ring-0"
            />
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {loading && <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>}
            {!loading && rows.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">No clients match.</div>
            )}
            {!loading && rows.map((r) => {
              const dn = toDisplay(r);
              const selected = value?.id === r.id;
              return (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => {
                    onChange({ id: r.id, displayName: dn, email: r.email, phone: r.phone });
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <Check className={cn('mt-0.5 h-4 w-4', selected ? 'opacity-100' : 'opacity-0')} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{dn}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.email ?? '—'} · {r.phone ?? '—'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)} aria-label="Clear client">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
