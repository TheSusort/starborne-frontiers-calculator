/**
 * Vindicator on-resist HP-damage — production-routed builder probe. Skill text VERBATIM from
 * docs/ship-skills.csv (parser source of truth). Drives the REAL buildShipAbilities path.
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

const VINDICATOR_P2 =
    "This Unit has 20% Shield Penetration. At the start of combat, this Unit gains <unit-skill>Magnetized Shielding</unit-skill>.<br /><br />When this Unit resists a debuff infliction from an enemy, it deals <unit-damage>damage equal to 30%</unit-damage> of this Unit's max HP to that enemy.";

describe('Vindicator on-resist HP damage — builder', () => {
    it('emits a damage ability on on-debuff-resisted with hpBasisPct 30', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: VINDICATOR_P2 }, 'passive');
        const proc = abilities.find(
            (a) => a.type === 'damage' && a.trigger === 'on-debuff-resisted'
        );
        expect(proc).toBeDefined();
        expect(proc!.target).toBe('enemy');
        expect(proc!.config).toMatchObject({ type: 'damage', hpBasisPct: 30 });
    });
});
