import { describe, expect, it, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

import {
  fetchSocialMediaLibrary, createSocialPublication, queueSocialPublication,
} from '@/lib/crm/social-media';

describe('social-media data layer', () => {
  beforeEach(() => invokeMock.mockReset());

  it('calls the social-media-manager function with the action and body it was given', async () => {
    invokeMock.mockResolvedValue({ data: { data: [], requestId: 'r1' }, error: null });
    await fetchSocialMediaLibrary({ format: 'short' });
    expect(invokeMock).toHaveBeenCalledWith('social-media-manager', { body: { action: 'list_library', filters: { format: 'short' } } });
  });

  it('unwraps the {data} envelope on success', async () => {
    invokeMock.mockResolvedValue({ data: { data: { id: 'job-1', publication: { id: 'pub-1' } }, requestId: 'r2' }, error: null });
    const result = await queueSocialPublication('pub-1');
    expect(result).toEqual({ id: 'job-1', publication: { id: 'pub-1' } });
  });

  it('throws using the transport error message when supabase.functions.invoke fails', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: 'network down' } });
    await expect(createSocialPublication({ sourceType: 'clip', clipId: 'clip-1' })).rejects.toThrow('network down');
  });

  it('throws using the application error message when the function returns {error}', async () => {
    invokeMock.mockResolvedValue({ data: { error: 'FORBIDDEN', requestId: 'r3' }, error: null });
    await expect(fetchSocialMediaLibrary()).rejects.toThrow('FORBIDDEN');
  });
});
