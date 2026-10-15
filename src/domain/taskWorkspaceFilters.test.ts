import { describe, expect, it } from 'vitest';
import { readTaskWorkspaceFilters, taskPageRange } from './taskWorkspaceFilters';
describe('task workspace bookmarks and bounded pages', () => {
  it('discards unsupported view, owner, status, priority and page values', () => {
    expect(readTaskWorkspaceFilters(new URLSearchParams('view=unsafe&owner=other&status=done&priority=top&page=Infinity')))
      .toEqual({ view: 'overdue', owner: '', status: undefined, priority: undefined, page: 1, search: '' });
  });
  it('keeps valid combined filters and source view independent', () => {
    expect(readTaskWorkspaceFilters(new URLSearchParams('view=team&status=Waiting&priority=Urgent&page=4&q=followup')))
      .toMatchObject({ view: 'team', status: 'Waiting', priority: 'Urgent', page: 4, search: 'followup' });
  });
  it('does not change existing unpaged consumers, but bounds requested pages', () => {
    expect(taskPageRange()).toBeNull();
    expect(taskPageRange(3, 50)).toEqual([100, 149]);
    for (const [page, size] of [[0, 50], [1, 1001], [Infinity, 50], [1.2, 50]]) {
      expect(() => taskPageRange(page, size)).toThrow(/Invalid task page/);
    }
  });
});
