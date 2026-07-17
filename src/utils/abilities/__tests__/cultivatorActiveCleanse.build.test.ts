/**
 * Cultivator active-slot cleanse — production-routed builder probe. Skill text VERBATIM from
 * docs/ship-skills.csv (parser source of truth). Drives the REAL buildShipAbilities path.
 *
 * Wave 2 Finding A1: the active slot's `<unit-aid>cleanses 1</unit-aid>debuff.` has no space at
 * the tag-removal boundary, so after stripUnitTags the plain text reads "...cleanses 1debuff."
 * CLEANSE_RE's trailing `\b` after the digit never matches (a letter follows immediately), so
 * parseCleanse() silently drops the active-slot cleanse while the charged slot (which has a
 * space: "Cleanses 1</unit-aid> debuff") parses fine.
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

// Verbatim from docs/ship-skills.csv row "Cultivator" (active_skill_text column).
const CULTIVATOR_ACTIVE =
    'This Unit grants <unit-skill>Defense Up III</unit-skill> for 2 turns and <unit-aid>cleanses 1</unit-aid>debuff.';

describe('Cultivator active — builder cleanse parity', () => {
    it('emits a cleanse ability on the active slot (count 1, on-cast)', () => {
        const abilities = abilitiesFor({ activeSkillText: CULTIVATOR_ACTIVE }, 'active');
        const cleanse = abilities.find((a) => a.type === 'cleanse');
        expect(cleanse).toBeDefined();
        expect(cleanse!.trigger).toBe('on-cast');
        expect(cleanse!.config).toMatchObject({ type: 'cleanse', count: 1 });
    });
});
