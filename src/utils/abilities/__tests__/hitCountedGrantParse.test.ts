/**
 * "for N hit(s)" grants — production-routed builder probe. Skill text VERBATIM from
 * docs/ship-skills.csv (parser source of truth). Drives the REAL buildShipAbilities path so the
 * detector is exercised through the buff-merge site that actually stamps `hits`, not in isolation.
 *
 * Corpus: exactly four rows say "for 1 hit" — Malvex (charge), Panon (charge), Quixilver
 * (passive R4), Sansi (charge). Panon's R0/R2 passive grants the SAME buff name for 1 TURN in the
 * same row family, so it is the regression canary: a turn-duration grant must stay hit-less.
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
function buff(abilities: Ability[], buffName: string): Ability | undefined {
    return abilities.find(
        (a) => a.config.type === 'buff' && (a.config as { buffName?: string }).buffName === buffName
    );
}

// Verbatim from docs/ship-skills.csv, charge_skill_text column.
const SANSI_CHARGE =
    'This Unit deals <unit-damage>230% Damage</unit-damage> and grants <unit-skill>Taunt</unit-skill> for 1 turn and <unit-skill>Barrier</unit-skill> for 1 hit.';
const MALVEX_CHARGE =
    'This Unit deals <unit-damage>220% damage</unit-damage> with additional damage equal to <unit-damage>12%</unit-damage> of its current Shield and removes 30% of the enemy’s Shield. If the target has a Shield, it gains <unit-skill>Barrier</unit-skill> for 1 hit.';
// Verbatim from docs/ship-skills.csv, first_passive_skill_text column (Panon).
const PANON_PASSIVE =
    'If this Unit is directly damaged and does not have <unit-skill>Barrier Recharging</unit-skill>, it gains <unit-skill>Barrier</unit-skill> for 1 turn and applies <unit-skill>Barrier Recharging</unit-skill> to itself for 3 turns.';

describe('"for N hit(s)" grants', () => {
    it('stamps hits:1 on a Barrier granted for 1 hit (Sansi charge)', () => {
        const barrier = buff(abilitiesFor({ chargeSkillText: SANSI_CHARGE }, 'charged'), 'Barrier');
        expect(barrier?.config).toMatchObject({ hits: 1 });
    });

    it('does not leak the hit count onto a sibling clause granting turns (Sansi Taunt)', () => {
        const taunt = buff(abilitiesFor({ chargeSkillText: SANSI_CHARGE }, 'charged'), 'Taunt');
        expect(taunt?.config).toMatchObject({ duration: 1 });
        expect((taunt?.config as { hits?: number }).hits).toBeUndefined();
    });

    it('stamps hits:1 on a durationless conditional grant (Malvex charge)', () => {
        const barrier = buff(
            abilitiesFor({ chargeSkillText: MALVEX_CHARGE }, 'charged'),
            'Barrier'
        );
        expect(barrier?.config).toMatchObject({ hits: 1 });
        expect((barrier?.config as { duration?: number }).duration).toBeUndefined();
    });

    it('leaves a turn-duration grant alone (Panon passive canary)', () => {
        const barrier = buff(
            abilitiesFor({ firstPassiveSkillText: PANON_PASSIVE, refits: [] }, 'passive'),
            'Barrier'
        );
        expect(barrier?.config).toMatchObject({ duration: 1 });
        expect((barrier?.config as { hits?: number }).hits).toBeUndefined();
    });
});
