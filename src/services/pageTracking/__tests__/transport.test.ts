import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRpcSender } from '../transport';

describe('createRpcSender', () => {
    afterEach(() => vi.restoreAllMocks());

    it('posts both arrays to the RPC with keepalive and the caller token', () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));
        const send = createRpcSender('https://p.supabase.co', 'anon', () => 'user-jwt');
        send([], []);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://p.supabase.co/rest/v1/rpc/track_page_events',
            expect.objectContaining({
                method: 'POST',
                keepalive: true,
                headers: {
                    apikey: 'anon',
                    Authorization: 'Bearer user-jwt',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ p_visits: [], p_errors: [] }),
            })
        );
    });

    it('falls back to the anon key and swallows network failures', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
        const send = createRpcSender('https://p.supabase.co', 'anon', () => null);
        expect(() => send([], [])).not.toThrow();
        await Promise.resolve();
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer anon');
    });
});
