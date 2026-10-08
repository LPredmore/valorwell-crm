import { useEffect, useState } from 'react';

/** Prevent a database query on every keystroke while keeping URL filters editable. */
export function useDebouncedDirectorySearch(value: string | undefined, delay = 300): string {
  const [debounced, setDebounced] = useState(value ?? '');
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value ?? ''), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}
