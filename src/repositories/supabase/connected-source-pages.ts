/** Read authorized connected-source pages without silently truncating at 2,000.
 * Callers must supply a stable unique order and their tenant/source predicate.
 * A traversal safety ceiling rejects rather than returning incomplete success.
 */
export async function loadConnectedSourcePages<T extends { id: string }>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 250,
  maxPages = 1000,
): Promise<T[]> {
  const out: T[] = []; const seen = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await makeQuery(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(error.message);
    if (!Array.isArray(data) || data.length > pageSize) throw new Error('Connected source returned an invalid page.');
    for (const row of data) {
      if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id))
        throw new Error('Connected source changed or repeated a record during paging. Refresh before using the board.');
      seen.add(row.id); out.push(row);
    }
    if (data.length < pageSize) return out;
  }
  throw new Error('Connected source traversal limit reached. Use its paged source workspace; complete board data is unavailable.');
}
