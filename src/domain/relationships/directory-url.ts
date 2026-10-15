/** Validate bookmark input before passing it to typed database filters. */
export function directoryEnum<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find(candidate => candidate === value) ?? fallback;
}

export function directoryValues<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[]): T[] {
  return [...new Set(params.getAll(key).flatMap(value => {
    const match = allowed.find(candidate => candidate === value);
    return match === undefined ? [] : [match];
  }))];
}

export function directoryIds(params: URLSearchParams, key: string): string[] {
  return [...new Set(params.getAll(key).filter(value =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  ))];
}

/** Only a query string is retained; the return destination is always fixed locally. */
export function directoryReturnSearch(params: URLSearchParams): string {
  const search = params.get('directory') ?? '';
  return search.startsWith('?') ? search : '';
}

export function directoryDetailSearch(search: string): string {
  return search ? '?' + new URLSearchParams({ directory: search }).toString() : '';
}
