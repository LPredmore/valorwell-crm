import { describe, expect, it, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

import {
  fetchSocialMediaLibrary, createSocialPublication, queueSocialPublication, SocialMediaError,
} from '@/lib/crm/social-media';

describe('social-media data layer', () => {
  beforeEach(() => invokeMock.mockReset());

  it('calls the social-media-manager function with the action, body, and a timeout', async () => {
    invokeMock.mockResolvedValue({ data: { data: [], requestId: 'r1' }, error: null });
    await fetchSocialMediaLibrary({ format: 'short' });
    expect(invokeMock).toHaveBeenCalledWith('social-media-manager', {
      body: { action: 'list_library', filters: { format: 'short' } },
      timeout: 15000,
    });
  });

  it('unwraps the {data} envelope on success', async () => {
    invokeMock.mockResolvedValue({ data: { data: { id: 'job-1', publication: { id: 'pub-1' } }, requestId: 'r2' }, error: null });
    const result = await queueSocialPublication('pub-1');
    expect(result).toEqual({ id: 'job-1', publication: { id: 'pub-1' } });
  });

  it('throws using the transport error message when supabase.functions.invoke fails with no Response context', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: 'network down' } });
    await expect(createSocialPublication({ sourceType: 'clip', clipId: 'clip-1' })).rejects.toThrow('network down');
  });

  it('throws using the application error message when the function returns {error}', async () => {
    invokeMock.mockResolvedValue({ data: { error: 'FORBIDDEN', requestId: 'r3' }, error: null });
    await expect(fetchSocialMediaLibrary()).rejects.toThrow('FORBIDDEN');
  });

  it('reads the actual server error body, status, and requestId off a FunctionsHttpError Response', async () => {
    const response = new Response(JSON.stringify({ error: 'AUTH_TIMEOUT', action: 'list_library', requestId: 'req-42' }), {
      status: 504,
      headers: { 'x-request-id': 'req-42' },
    });
    invokeMock.mockResolvedValue({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: response } });
    try {
      await fetchSocialMediaLibrary();
      expect.unreachable('expected fetchSocialMediaLibrary to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SocialMediaError);
      const socialError = error as SocialMediaError;
      expect(socialError.message).toBe('AUTH_TIMEOUT');
      expect(socialError.status).toBe(504);
      expect(socialError.requestId).toBe('req-42');
      expect(socialError.action).toBe('list_library');
    }
  });

  it('reports a client-side timeout distinctly from a transport error', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { name: 'AbortError', message: 'The user aborted a request.' } });
    try {
      await fetchSocialMediaLibrary();
      expect.unreachable('expected fetchSocialMediaLibrary to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SocialMediaError);
      expect((error as SocialMediaError).message).toMatch(/timed out/i);
    }
  });
});
