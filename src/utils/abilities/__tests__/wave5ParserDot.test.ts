import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, Skill } from '../../../types/abilities';
import { adjacentEnemyScopeForName } from '../../skillTextParser';
import {
    csvAvailable,
    loadShipSkillRecords,
    ShipSkillRecord,
} from '../../../../scripts/lib/shipSkillCsv';

/**
 * Regression tests for Task B1 (ship-kit correctness audit, Wave 5): the Asphyxiator ACTIVE
 * Inferno III DoT carries an enemy-adjacency splash phrase ("on the targeted enemy and all
 * enemies adjacent to it") that the DoT builder (`buildShipAbilities.ts`, dotAbility) previously
 * hardcoded to `target: 'enemy'` and ignored. The CHARGED Inferno III sentence has no adjacency
 * phrase (the adjacency phrasing there belongs to a SEPARATE Stasis sentence), so it must stay
 * 'enemy'. Skips gracefully when the gitignored reference CSV is absent (clean checkout / CI).
 */

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

function abilitiesOfType(abilities: Ability[], type: string): Ability[] {
    return abilities.filter((a) => a.type === type);
}

function recordFor(name: string): ShipSkillRecord {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record found for "${name}"`);
    return rec;
}

describe.skipIf(!csvAvailable())(
    'Task B1 — Asphyxiator active Inferno DoT splash target (verbatim docs/ship-skills.csv)',
    () => {
        it('active Inferno III DoT targets target-and-adjacent-enemies (splash phrase present)', () => {
            const rec = recordFor('Asphyxiator');
            const s = ship({ activeSkillText: rec.active, chargeSkillText: rec.charge });
            const { slots } = buildShipAbilities(s);
            const active = slot(slots, 'active');
            expect(active).toBeDefined();

            const infernoDots = abilitiesOfType(active!.abilities, 'dot').filter(
                (a) => a.config.type === 'dot' && a.config.dotType === 'inferno'
            );
            expect(infernoDots.length).toBeGreaterThan(0);
            expect(infernoDots[0].target).toBe('target-and-adjacent-enemies');
        });

        it('charged Inferno III DoT stays enemy (no adjacency phrase in the Inferno sentence)', () => {
            const rec = recordFor('Asphyxiator');
            const s = ship({ activeSkillText: rec.active, chargeSkillText: rec.charge });
            const { slots } = buildShipAbilities(s);
            const charged = slot(slots, 'charged');
            expect(charged).toBeDefined();

            const infernoDots = abilitiesOfType(charged!.abilities, 'dot').filter(
                (a) => a.config.type === 'dot' && a.config.dotType === 'inferno'
            );
            expect(infernoDots.length).toBeGreaterThan(0);
            expect(infernoDots[0].target).toBe('enemy');
        });
    }
);

describe('adjacentEnemyScopeForName — synthetic clause isolation (CSV-independent)', () => {
    it('"on the targeted enemy and all enemies adjacent to it" resolves to target-and-adjacent-enemies', () => {
        const text =
            'This Unit deals 175% damage, then inflicts X for 3 turns on the targeted enemy and all enemies adjacent to it.';
        expect(adjacentEnemyScopeForName(text, 'X')).toBe('target-and-adjacent-enemies');
    });

    it('"inflicts X for 3 turns." (no adjacency phrase) resolves to null', () => {
        const text = 'This Unit deals 215% damage, and inflicts X for 3 turns.';
        expect(adjacentEnemyScopeForName(text, 'X')).toBeNull();
    });

    it('"on all enemies adjacent to the original target" resolves to adjacent-enemies', () => {
        const text =
            'This Unit inflicts X for 2 turns on all enemies adjacent to the original target.';
        expect(adjacentEnemyScopeForName(text, 'X')).toBe('adjacent-enemies');
    });
});
