// Prepared only. Execution deferred to Todoist task 42.
import { describe, expect, it } from 'vitest';
import { readOpportunityDirectory, updateOpportunityDirectory } from './opportunity-directory-url';
import { directoryDetailSearch, directoryReturnSearch } from './directory-url';
describe('BTY opportunity bookmarks', () => {
  it('round trips directory state through a fixed local detail return', () => {
    const original = '?q=Example&status=research&causeArea=Housing&page=3&veteranPriority=true';
    expect(directoryReturnSearch(new URLSearchParams(directoryDetailSearch(original)))).toBe(original);
    expect(directoryReturnSearch(new URLSearchParams('directory=https://foreign.test'))).toBe('');
  });
  it('normalizes unsupported values and resets paging without deleting unrelated state', () => {
    expect(readOpportunityDirectory(new URLSearchParams('status=unknown&page=-1&veteranPriority=false')))
      .toMatchObject({ status: '', page: 1, veteranPriority: false });
    const next = updateOpportunityDirectory(new URLSearchParams('page=8&source=bty'), 'q', 'Example');
    expect(next.get('page')).toBeNull(); expect(next.get('source')).toBe('bty');
  });
});
