/**
 * Morao active-slot Provoke duration — production-routed builder probe. Skill text VERBATIM
 * from docs/ship-skills.csv (parser source of truth). Drives the REAL buildShipAbilities path.
 *
 * Wave 2 Finding A2: the active slot's trailing clause is "...applies <unit-skill>Provoke</unit-
 * skill> for 1turn." — a CSV concatenation typo with no space between "1" and "turn". DURATION_RE
 * (`for\s+(\d+)\s+turns?`) requires whitespace between the number and "turn(s)", so it never
 * matches "1turn" and the Provoke debuff carries no `duration`, unlike every other timed
 * control-debuff in the corpus (Stasis on Medved/Meiying/Nayra all carry duration).
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

// Verbatim from docs/ship-skills.csv row "Morao" (active_skill_text column).
const MORAO_ACTIVE =
    'This Unit deals <unit-damage>70% damage</unit-damage> with an additional damage equal to <unit-damage>60%</unit-damage> of its Defense and applies <unit-skill>Provoke</unit-skill> for 1turn.';

describe('Morao active — builder Provoke duration parity', () => {
    it('emits the Provoke debuff with duration 1', () => {
        const abilities = abilitiesFor({ activeSkillText: MORAO_ACTIVE }, 'active');
        const provoke = abilities.find(
            (a) => a.type === 'debuff' && (a.config as { buffName?: string }).buffName === 'Provoke'
        );
        expect(provoke).toBeDefined();
        expect(provoke!.config).toMatchObject({ type: 'debuff', buffName: 'Provoke', duration: 1 });
    });
});
