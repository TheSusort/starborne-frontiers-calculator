import { describe, it, expect } from 'vitest';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';

describe('buildTraceShip', () => {
    it.skipIf(!csvAvailable())('merges CSV skill text with SHIPS base stats', () => {
        const ship = buildTraceShip('Aegis');
        expect(ship).not.toBeNull();
        expect(ship!.name).toBe('Aegis');
        expect(ship!.baseStats.hp).toBeGreaterThan(0);
        expect(ship!.baseStats.attack).toBeGreaterThan(0);
        expect(ship!.affinity).toBe('antimatter');
        // CSV active text flows onto the ship (authoritative source) — the CSV text is
        // HTML-tagged ("<unit-damage>Shield...") while the SHIPS.ts fallback text is plain
        // ("a shield equal to..."), so this marker only appears if the CSV record won.
        expect(ship!.activeSkillText).toContain('<unit-damage>');
        // Default refit level 4 → four synthesized refits so R4 passive resolves if present.
        expect(ship!.refits).toHaveLength(4);
    });

    it('returns null when there is neither SHIPS data nor a CSV record', () => {
        expect(buildTraceShip('NotARealShip_zzz')).toBeNull();
    });

    it.skipIf(!csvAvailable())(
        'traces a CSV-only ship (no SHIPS entry) on the default baseline',
        () => {
            // Centurion has skill text in the CSV but no SHIPS entry — must still trace.
            const ship = buildTraceShip('Centurion');
            expect(ship).not.toBeNull();
            expect(ship!.name).toBe('Centurion');
            expect(ship!.baseStats.hp).toBe(200_000); // default baseline
            expect(ship!.affinity).toBe('antimatter'); // neutral fallback
            expect((ship!.activeSkillText ?? '').length).toBeGreaterThan(0); // CSV skill text present
        }
    );

    it.skipIf(!csvAvailable())('honours a lower refit level', () => {
        const r0 = buildTraceShip('Aegis', { refitLevel: 0 });
        expect(r0!.refits).toHaveLength(0);
    });
});
