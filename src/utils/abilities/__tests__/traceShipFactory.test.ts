import { describe, it, expect, vi } from 'vitest';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';

describe('buildTraceShip', () => {
    it.skipIf(!csvAvailable())('merges CSV skill text with ship-data snapshot base stats', () => {
        const ship = buildTraceShip('Aegis');
        expect(ship).not.toBeNull();
        expect(ship!.name).toBe('Aegis');
        expect(ship!.baseStats.hp).toBeGreaterThan(0);
        expect(ship!.baseStats.attack).toBeGreaterThan(0);
        expect(ship!.affinity).toBe('antimatter');
        // CSV active text flows onto the ship (authoritative source) — the CSV text is
        // HTML-tagged ("<unit-damage>Shield...") while any snapshot fallback text is plain
        // ("a shield equal to..."), so this marker only appears if the CSV record won.
        expect(ship!.activeSkillText).toContain('<unit-damage>');
        // Default refit level 4 → four synthesized refits so R4 passive resolves if present.
        expect(ship!.refits).toHaveLength(4);
    });

    it('returns null when there is neither a ship-data snapshot entry nor a CSV record', () => {
        expect(buildTraceShip('NotARealShip_zzz')).toBeNull();
    });

    it.skipIf(!csvAvailable())(
        'traces a ship with a CSV record but no ship-data snapshot entry on the default baseline',
        async () => {
            // docs/ship-data.json is now a full ship_templates dump, so every real CSV ship also
            // has a snapshot entry — there's no longer a naturally-occurring "CSV-only" ship to
            // exercise this branch against (unlike the old hand-maintained SHIPS constant, which
            // lagged behind newer ships). Isolate the branch instead: reset the module registry
            // and mock the snapshot loader to return an empty map for one fresh import, so any
            // real CSV ship (Centurion) falls through to the default baseline.
            vi.resetModules();
            vi.doMock('../../../../scripts/lib/shipDataSnapshot', () => ({
                loadShipDataByName: () => new Map(),
            }));
            const { buildTraceShip: buildTraceShipIsolated } =
                await import('../../../../scripts/lib/traceShipFactory');
            const ship = buildTraceShipIsolated('Centurion');
            expect(ship).not.toBeNull();
            expect(ship!.name).toBe('Centurion');
            expect(ship!.baseStats.hp).toBe(200_000); // default baseline
            expect(ship!.affinity).toBe('antimatter'); // neutral fallback
            expect((ship!.activeSkillText ?? '').length).toBeGreaterThan(0); // CSV skill text present
            vi.doUnmock('../../../../scripts/lib/shipDataSnapshot');
            vi.resetModules();
        }
    );

    it.skipIf(!csvAvailable())('honours a lower refit level', () => {
        const r0 = buildTraceShip('Aegis', { refitLevel: 0 });
        expect(r0!.refits).toHaveLength(0);
    });
});
