/**
 * Madax active-slot base damage — production-routed builder probe. Skill text VERBATIM from
 * docs/ship-skills.csv (parser source of truth). Drives the REAL buildShipAbilities path.
 *
 * Wave 2 Finding A3: the active slot's first `<unit-damage>` tag content is "Damage equal to
 * 70%" (non-numeric-leading — the number sits after "equal to", not at the start of the tag).
 * parseSkillDamage() calls `parseInt(match[1], 10)` on the raw tag content, which is NaN for
 * "Damage equal to 70%" (parseInt only reads leading digits), so the tag is skipped and no base
 * `damage` ability is produced — only the separately-parsed additional 60%-of-Defense survives.
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

// Verbatim from docs/ship-skills.csv row "Madax" (active_skill_text column).
const MADAX_ACTIVE =
    'This Unit grants <unit-skill>Taunt</unit-skill> for 1 turn and deals <unit-damage>Damage equal to 70%</unit-damage> plus an additional <unit-damage>60%</unit-damage> of its Defense.';

describe('Madax active — builder base damage parity', () => {
    it('emits a base damage ability with multiplier 70 alongside the additional-damage', () => {
        const abilities = abilitiesFor({ activeSkillText: MADAX_ACTIVE }, 'active');
        const dmg = abilities.find((a) => a.type === 'damage');
        expect(dmg).toBeDefined();
        expect(dmg!.target).toBe('enemy');
        expect(dmg!.config).toMatchObject({ type: 'damage', multiplier: 70 });

        const add = abilities.find((a) => a.type === 'additional-damage');
        expect(add).toBeDefined();
        expect(add!.config).toMatchObject({ type: 'additional-damage', stat: 'defense', pct: 60 });
    });
});
