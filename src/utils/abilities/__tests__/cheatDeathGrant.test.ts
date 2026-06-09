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

    // Yazid's REFIT-ACTIVE (R4 / 3rd passive) follow-on: "Once per battle, when Cheat Death
    // activates, this Unit repairs itself for 60% of its Max HP and gains Barrier for 1 turn."
    // → a heal (self, basis hp, pct 60, trigger on-cheat-death-activated, oncePerCombat) +
    // a Barrier buff (no payload, trigger on-cheat-death-activated). The existing Cheat Death
    // grant + Everliving Regeneration II grant in the same passive must NOT regress.
    describe('Yazid 3rd passive: when-Cheat-Death-activates follow-on (Task 8)', () => {
        const yazid = () =>
            ship({
                thirdPassiveSkillText:
                    'At the start of combat, this Unit gains <unit-skill>Everliving Regeneration II</unit-skill> for 9 turns and <unit-skill>Cheat Death</unit-skill><br /><br />Once per battle, when <unit-skill>Cheat Death</unit-skill> activates, this Unit <unit-damage>repairs itself for 60%</unit-damage> of its Max HP and gains <unit-skill>Barrier</unit-skill> for 1 turn.',
            });

        it('emits a self 60%-max-HP repair on on-cheat-death-activated (once per combat)', () => {
            const passive = slot(buildShipAbilities(yazid()).slots, 'passive')!;
            const heal = passive.abilities.find((a) => a.type === 'heal')!;
            expect(heal).toBeDefined();
            expect(heal.target).toBe('self');
            expect(heal.trigger).toBe('on-cheat-death-activated');
            if (heal.config.type === 'heal') {
                expect(heal.config.pct).toBe(60);
                expect(heal.config.basis).toBe('hp');
                expect(heal.config.oncePerCombat).toBe(true);
            }
        });

        it('emits a Barrier buff on on-cheat-death-activated (no payload)', () => {
            const passive = slot(buildShipAbilities(yazid()).slots, 'passive')!;
            const barrier = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Barrier'
            )!;
            expect(barrier).toBeDefined();
            expect(barrier.target).toBe('self');
            expect(barrier.trigger).toBe('on-cheat-death-activated');
            if (barrier.config.type === 'buff') {
                expect(barrier.config.parsedEffects).toEqual({});
            }
        });

        it('does NOT regress the existing Cheat Death + Everliving Regeneration II grants', () => {
            const passive = slot(buildShipAbilities(yazid()).slots, 'passive')!;
            // Cheat Death grant still recurring, self, on-cast (the start-of-combat grant).
            const cd = cheatDeath(passive.abilities)!;
            expect(cd).toBeDefined();
            expect(cd.target).toBe('self');
            expect(cd.trigger).toBe('on-cast');
            if (cd.config.type === 'buff') {
                expect(cd.config.parsedEffects).toEqual({});
                expect(cd.config.duration).toBe('recurring');
            }
            // Everliving Regeneration II keeps its 9-turn window and on-cast trigger.
            const elr = passive.abilities.find(
                (a) =>
                    a.config.type === 'buff' && a.config.buffName === 'Everliving Regeneration II'
            )!;
            expect(elr).toBeDefined();
            expect(elr.trigger).toBe('on-cast');
            if (elr.config.type === 'buff') expect(elr.config.duration).toBe(9);
        });
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
