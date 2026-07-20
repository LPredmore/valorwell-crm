import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/** URL-backed state for scalable relationship directories without local-storage persistence. */
export function useRelationshipUrlFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const setFilter = (name: string, value?: string) => setSearchParams(current => {
    const next = new URLSearchParams(current);
    if (value) next.set(name, value); else next.delete(name);
    return next;
  });
  const resetFilters = () => setSearchParams({});
  return { searchParams, setFilter, resetFilters };
}

/** Warns before browser unload when an editable relationship workspace has unsaved changes. */
export function useRelationshipUnsavedChangesGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);
}
