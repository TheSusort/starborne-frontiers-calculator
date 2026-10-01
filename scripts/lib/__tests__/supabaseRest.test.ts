import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Fake credentials set before the module loads: dotenv never overrides a variable already set,
// so no request can reach the real project, and `fetch` is stubbed in every test regardless.
process.env.VITE_SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

let patchRow: typeof import('../supabaseRest').patchRow;
beforeAll(async () => {
    ({ patchRow } = await import('../supabaseRest'));
});
afterEach(() => vi.unstubAllGlobals());

const respondWith = (rows: unknown[]) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

describe('patchRow', () => {
    it('asks for the patched rows back and resolves when exactly one came back', async () => {
        const fetchMock = respondWith([{ id: 'AEGIS' }]);
        await expect(patchRow('ship_templates', 'id', 'AEGIS', { charge_skill_charge: 4 })).resolves.toBeUndefined();
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://supabase.invalid/rest/v1/ship_templates?id=eq.AEGIS');
        expect((init.headers as Record<string, string>).Prefer).toBe('return=representation');
    });

    it('throws when the PATCH matched no row', async () => {
        respondWith([]);
        await expect(patchRow('ship_templates', 'id', 'GONE', { charge_skill_charge: 4 })).rejects.toThrow(/0 rows/);
    });

    it('throws when the PATCH matched more than one row', async () => {
        respondWith([{ id: 'A' }, { id: 'A' }]);
        await expect(patchRow('ship_templates', 'id', 'A', {})).rejects.toThrow(/2 rows/);
    });
});
