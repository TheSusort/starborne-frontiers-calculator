/**
 * "for N hit(s)" grants — production-routed builder probe. Skill text VERBATIM from
 * docs/ship-skills.csv (parser source of truth). Drives the REAL buildShipAbilities path so the
 * detector is exercised through the buff-merge site that actually stamps `hits`, not in isolation.
 *
 * Corpus: exactly four rows say "for 1 hit" — Malvex (charge), Panon (charge), Quixilver
 * (passive R2, second_passive_skill_text), Sansi (charge). Panon's R0/R2 passive grants the SAME
 * buff name for 1 TURN in the same row family, so it is the regression canary: a turn-duration
 * grant must stay hit-less.
 *
 * The Sansi/Panon builder-probe tests below prove the window is narrow enough to keep a sibling
 * grant's duration out of reach — they do NOT prove the first-match-wins turn-discrimination rule
 * itself is load-bearing, since with the shipped window width neither corpus text puts a turn
 * phrase and a hit phrase both in range of the SAME anchor. The direct `detectHitCount` probe
 * below closes that gap. Quixilver is the one live site where the hit phrase is followed by a
 * SIBLING grant's turn phrase (the inverse ordering), so it is covered directly too.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { detectHitCount } from '../../skillTextParser';
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
// Barrier Recharging is registered debuff-typed even when self-applied (Finding B3, see
// skillTextParser.ts), so it never reaches the buff() helper above — look it up by name
// regardless of buff/debuff typing.
function namedAbility(abilities: Ability[], buffName: string): Ability | undefined {
    return abilities.find((a) => (a.config as { buffName?: string }).buffName === buffName);
}

// Verbatim from docs/ship-skills.csv, charge_skill_text column.
const SANSI_CHARGE =
    'This Unit deals <unit-damage>230% Damage</unit-damage> and grants <unit-skill>Taunt</unit-skill> for 1 turn and <unit-skill>Barrier</unit-skill> for 1 hit.';
const MALVEX_CHARGE =
    'This Unit deals <unit-damage>220% damage</unit-damage> with additional damage equal to <unit-damage>12%</unit-damage> of its current Shield and removes 30% of the enemy’s Shield. If the target has a Shield, it gains <unit-skill>Barrier</unit-skill> for 1 hit.';
// Verbatim from docs/ship-skills.csv, first_passive_skill_text column (Panon).
const PANON_PASSIVE =
    'If this Unit is directly damaged and does not have <unit-skill>Barrier Recharging</unit-skill>, it gains <unit-skill>Barrier</unit-skill> for 1 turn and applies <unit-skill>Barrier Recharging</unit-skill> to itself for 3 turns.';
// Verbatim from docs/ship-skills.csv, second_passive_skill_text column (Quixilver). This is the
// only live site where the hit-counted grant's OWN phrase comes first and a sibling grant's turn
// phrase follows — the inverse of Sansi/Panon, and the reason it needs its own coverage rather
// than relying on the other three sites.
const QUIXILVER_PASSIVE_R2 =
    "This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of the damage taken when taking HP damage and still having Shield.<br /><br />At the end of this Unit's turn if it has shield equal to 100% of its max HP, this Unit grants all allies <unit-skill>Barrier</unit-skill> for 1 hit and applies <unit-skill>Barrier Recharging</unit-skill> for 3 turns.";

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

    it('stamps hits:1 on Barrier and leaves Barrier Recharging hit-less (Quixilver R2 passive)', () => {
        // 2 refits (R2, not the default 4/R4) so getShipSkillRows picks secondPassiveSkillText —
        // the actual row this text lives in.
        const abilities = abilitiesFor(
            {
                secondPassiveSkillText: QUIXILVER_PASSIVE_R2,
                refits: [
                    { id: 'r1', stats: [] },
                    { id: 'r2', stats: [] },
                ],
            },
            'passive'
        );
        const barrier = buff(abilities, 'Barrier');
        expect(barrier?.config).toMatchObject({ hits: 1 });
        const recharging = namedAbility(abilities, 'Barrier Recharging');
        expect(recharging?.config).toMatchObject({ duration: 3 });
        expect((recharging?.config as { hits?: number }).hits).toBeUndefined();
    });
});

describe('detectHitCount direct probe', () => {
    // The builder-probe tests above use real corpus text, but in every corpus site the OTHER
    // duration phrase falls outside the 60-char window from the anchor under test — so they
    // pass on window-narrowness alone and would keep passing even if the first-match-wins
    // turn-discrimination in detectHitCount (skillTextParser.ts) were deleted. This crafts an
    // anchor whose window spans BOTH phrases, closest one first, to exercise the rule itself.
    it('returns undefined when the first duration phrase after the anchor is a turn, even though a hit phrase follows in the same window', () => {
        const text = 'Anchor for 1 turn and Barrier for 1 hit.';
        expect(detectHitCount(text, 0)).toBeUndefined();
    });
});
