import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, Skill } from '../../../types/abilities';

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

function cheatDeath(abilities: Ability[]): Ability | undefined {
    return abilities.find(
        (a) => a.type === 'buff' && a.config.type === 'buff' && a.config.buffName === 'Cheat Death'
    );
}

// Cheat Death is a no-payload, until-triggered named buff. It must parse from the grant
// clause with an EMPTY stat payload and a NON-EXPIRING ('recurring') duration so the
// StatusEngine's per-turn decrement never removes it (it is consumed only on a lethal hit).
describe('Cheat Death grant parsing', () => {
    it('Hayyan charged: "grants Cheat Death to all allies" → all-allies, no payload, recurring', () => {
        const s = ship({
            chargeSkillText:
                'This Unit <unit-damage>repairs 17%</unit-damage> of its Max HP, grants <unit-skill>Cheat Death</unit-skill> to all allies, and <unit-aid>adds 1 charge</unit-aid> to their Charged Skill.',
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        const cd = cheatDeath(charged.abilities)!;
        expect(cd).toBeDefined();
        expect(cd.target).toBe('all-allies');
        expect(cd.trigger).toBe('on-cast');
        expect(cd.config.type).toBe('buff');
        if (cd.config.type === 'buff') {
            expect(cd.config.parsedEffects).toEqual({});
            expect(cd.config.duration).toBe('recurring');
        }
        // Cheat Death must be emitted exactly once (no double-emit from the segment loop +
        // conjoined-grant pass). The ally-scoped "repairs … of its Max HP" and "adds 1 charge
        // to THEIR Charged Skill" are disqualified by the existing heal/charge paths (ally-grant
        // exclusions) — pre-existing behaviour this task neither adds nor regresses.
        const cheatDeaths = charged.abilities.filter(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Cheat Death'
        );
        expect(cheatDeaths).toHaveLength(1);
    });

    it('Yazid 2nd passive: start-of-combat "gains … Cheat Death" → self, no payload, recurring', () => {
        const s = ship({
            secondPassiveSkillText:
                'At the start of combat, this Unit gains <unit-skill>Everliving Regeneration II</unit-skill> for 9 turns and <unit-skill>Cheat Death</unit-skill>',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const cd = cheatDeath(passive.abilities)!;
        expect(cd).toBeDefined();
        expect(cd.target).toBe('self');
        expect(cd.trigger).toBe('on-cast');
        if (cd.config.type === 'buff') {
            expect(cd.config.parsedEffects).toEqual({});
            expect(cd.config.duration).toBe('recurring');
        }
        // The conjoined Everliving Regeneration II grant must still parse with its own duration.
        const elr = passive.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Everliving Regeneration II'
        )!;
        expect(elr).toBeDefined();
        if (elr.config.type === 'buff') expect(elr.config.duration).toBe(9);
    });

    it('Tycho 2nd passive: Cheat Death duration must NOT leak the "for 6 turns" of the conjoined buff', () => {
        const s = ship({
            secondPassiveSkillText:
                'At the start of combat, this Unit gains <unit-skill>Cheat Death</unit-skill> and <unit-skill>Everliving Regeneration I</unit-skill> for 6 turns.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive')!;
        const cd = cheatDeath(passive.abilities)!;
        expect(cd).toBeDefined();
        expect(cd.target).toBe('self');
        if (cd.config.type === 'buff') {
            expect(cd.config.parsedEffects).toEqual({});
            // Regression guard: the shared-duration scan would otherwise stamp 6 here.
            expect(cd.config.duration).toBe('recurring');
        }
        // Everliving Regeneration I keeps its own 6-turn window.
        const elr = passive.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Everliving Regeneration I'
        )!;
        if (elr.config.type === 'buff') expect(elr.config.duration).toBe(6);
    });

    it('Hermes charged: "If the target has less than 40% HP, it grants Cheat Death" → no payload, recurring', () => {
        const s = ship({
            chargeSkillText:
                'This Unit <unit-damage>repairs 37%</unit-damage> of its Max HP and <unit-aid>adds 1 charge</unit-aid> to the Charged Skill.<br /><br />If the target has less than 40% HP, it grants <unit-skill>Cheat Death</unit-skill>.',
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged')!;
        const cd = cheatDeath(charged.abilities)!;
        expect(cd).toBeDefined();
        expect(cd.trigger).toBe('on-cast');
        if (cd.config.type === 'buff') {
            expect(cd.config.parsedEffects).toEqual({});
            expect(cd.config.duration).toBe('recurring');
        }
        // The repair (heal) and charge-add in the same skill must still parse.
        expect(charged.abilities.some((a) => a.type === 'heal')).toBe(true);
        expect(charged.abilities.some((a) => a.type === 'charge')).toBe(true);
    });
});
