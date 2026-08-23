/**
 * Zosimos charged — `Reversed Repairs` builds as a 1-turn enemy debuff (#362).
 *
 * Production-routed builder probe: drives the REAL buildShipAbilities path, not a parser unit.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ability, Skill } from '../../../types/abilities';
import { Ship } from '../../../types/ship';

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}
function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}
function abilitiesFor(over: Partial<Ship>, name: string): Ability[] {
    return slot(buildShipAbilities(ship(over)).slots, name)?.abilities ?? [];
}

// Verbatim from docs/ship-skills.csv row "Zosimos".
const ZOSIMOS_CHARGED =
    'This Unit inflicts <unit-skill>Reversed Repairs</unit-skill> for 1 turn and deals <unit-damage>300% damage</unit-damage>.';

describe('Zosimos charged — Reversed Repairs debuff', () => {
    const abilities = abilitiesFor({ chargeSkillText: ZOSIMOS_CHARGED }, 'charged');

    it('builds the Reversed Repairs debuff for 1 turn on the enemy', () => {
        const rr = abilities.find(
            (a) =>
                a.type === 'debuff' &&
                (a.config as { buffName?: string }).buffName === 'Reversed Repairs'
        );
        expect(rr).toBeDefined();
        expect(rr!.target).toBe('enemy');
        expect(rr!.config).toMatchObject({
            type: 'debuff',
            buffName: 'Reversed Repairs',
            duration: 1,
        });
    });

    it('still builds the 300% damage clause, and no phantom self-heal', () => {
        // Regression fence for the fabricated 300%-of-max-HP self-heal fixed in `fe0b4644`
        // (maskStatusNameRepairs). "Repairs" in the status NAME must not read the damage clause's %.
        expect(abilities.some((a) => a.type === 'damage')).toBe(true);
        expect(abilities.some((a) => a.type === 'heal')).toBe(false);
    });
});
