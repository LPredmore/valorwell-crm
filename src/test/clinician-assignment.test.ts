import { describe, expect, it } from 'vitest';
import { mockDataProvider } from '@/repositories/mock';

describe('clinician assignment contract', () => {
  it('rejects null and empty clinician assignments before any canonical RPC path can send them', async () => {
    const first = (await mockDataProvider.clients.list({ page: 1, pageSize: 1 })).rows[0];
    await expect(mockDataProvider.clients.assignClinician(first.id, '')).rejects.toThrow('staffId is required');
  });
});
