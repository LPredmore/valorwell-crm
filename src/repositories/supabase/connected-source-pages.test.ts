// Prepared only; execution deferred to Todoist task 42.
import { describe, expect, it, vi } from 'vitest';
import { loadConnectedSourcePages } from './connected-source-pages';
describe('connected source traversal', () => {
  it('reads beyond the old 2,000-record cap', async () => {
    const rows = Array.from({ length: 2251 }, (_, index) => ({ id: String(index) }));
    const read = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
    expect((await loadConnectedSourcePages(read)).length).toBe(2251);
    expect(read).toHaveBeenCalledWith(2250, 2499);
  });
  it('rejects repeat pages, read errors and exhausted traversal instead of reporting partial success', async () => {
    await expect(loadConnectedSourcePages(async () => ({ data: [{ id: 'same' }], error: null }), 1, 2)).rejects.toThrow(/repeated/);
    await expect(loadConnectedSourcePages(async () => ({ data: null, error: { message: 'Denied' } }))).rejects.toThrow('Denied');
    await expect(loadConnectedSourcePages(async from => ({ data: [{ id: String(from) }], error: null }), 1, 2)).rejects.toThrow(/limit reached/);
  });
});
