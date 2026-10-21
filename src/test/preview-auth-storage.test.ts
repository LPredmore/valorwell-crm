import { afterEach, expect, it, vi } from 'vitest';
import { brokeredPreviewStorage } from '../integrations/supabase/previewAuthStorage';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('times out an unanswered editor request, retries once, and removes both listeners', async () => {
  vi.useFakeTimers();
  const removeEventListener = vi.fn();
  const postMessage = vi.fn();
  vi.stubGlobal('window', { parent: { postMessage }, addEventListener: vi.fn(), removeEventListener });
  vi.stubGlobal('location', {
    hostname: '12345678-1234-4123-8123-123456789abc.lovableproject.com',
    ancestorOrigins: ['https://lovable.dev'],
  });
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'synthetic-session') });
  const storage = brokeredPreviewStorage();
  const result = storage!.getItem('synthetic-auth-key');
  await vi.advanceTimersByTimeAsync(4250);
  await expect(result).resolves.toBe('synthetic-session');
  expect(postMessage).toHaveBeenCalledTimes(2);
  expect(removeEventListener).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
