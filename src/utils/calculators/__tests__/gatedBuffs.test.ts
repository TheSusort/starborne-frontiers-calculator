import { describe, it, expect } from 'vitest';
import { gatedAutoFilledBuffs, GatedBuffsPageState } from '../gatedBuffs';
import type { SelectedGameBuff } from '../../../types/calculator';
import type { ShipSkills } from '../../../types/abilities';

// The page's own default state (fresh visit: no team ships, no enemies added). Used by every
// test that isn't specifically exercising `lowest-speed-ally` or `enemy-debuff` answerability —
// those two subjects are the only ones this state can ever flip from "not met" to "met".
const defaultState: GatedBuffsPageState = {
    selfSpeed: 100,
    allySpeeds: [],
    hasEnemy: false,
    enemyDebuffNames: [],
};

const buff = (over: Partial<SelectedGameBuff> = {}): SelectedGameBuff => ({
    id: 'Defense Up II-passive1-self',
    buffName: 'Defense Up II',
    stacks: 1,
    parsedEffects: { defense: 30 },
    isStackable: false,
    autoFilled: true,
    skillSource: 'passive1',
    ...over,
});

const skills = (abilities: unknown[]): ShipSkills =>
    ({ slots: [{ slot: 'passive', abilities }] }) as unknown as ShipSkills;

const gatedAbility = {
    config: { type: 'buff', buffName: 'Defense Up II' },
    conditions: [
        {
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'below',
            hpPercent: 60,
            hpSubject: 'self',
        },
    ],
};
const ungatedAbility = { config: { type: 'buff', buffName: 'Defense Up II' }, conditions: [] };

describe('gatedAutoFilledBuffs', () => {
    it('reports an auto-filled buff whose ability carries an HP gate, with the reason in words', () => {
        const result = gatedAutoFilledBuffs([buff()], skills([gatedAbility]), defaultState);
        expect(result).toEqual([
            {
                buffId: 'Defense Up II-passive1-self',
                buffName: 'Defense Up II',
                reason: 'below 60% HP',
            },
        ]);
    });

    it('never reports a MANUALLY added buff, gate or no gate', () => {
        expect(
            gatedAutoFilledBuffs(
                [buff({ autoFilled: false })],
                skills([gatedAbility]),
                defaultState
            )
        ).toEqual([]);
        expect(
            gatedAutoFilledBuffs(
                [buff({ autoFilled: undefined })],
                skills([gatedAbility]),
                defaultState
            )
        ).toEqual([]);
    });

    it('does NOT report a buff that also has an UNGATED grant path', () => {
        // Skill.slot has three values against skillSource's five, so all three passives collapse
        // into one slot and a name can match more than one ability. If ANY path is unconditional
        // the buff genuinely can stand always-on and must keep counting.
        expect(
            gatedAutoFilledBuffs([buff()], skills([gatedAbility, ungatedAbility]), defaultState)
        ).toEqual([]);
    });

    it('does NOT report a buff gated in one slot when a DIFFERENT slot grants it unconditionally', () => {
        // Panon's shape: Barrier is gated behind Taunt/Provoke from the CHARGE slot, but granted
        // unconditionally from the PASSIVE slot. The every-match rule must see across ALL slots,
        // not just the one `skillSource` nominally maps to, or it drops a buff the ship also
        // grants for free.
        const multiSlot = {
            slots: [
                { slot: 'charged', abilities: [gatedAbility] },
                { slot: 'passive', abilities: [ungatedAbility] },
            ],
        } as unknown as ShipSkills;
        expect(
            gatedAutoFilledBuffs([buff({ skillSource: 'charge' })], multiSlot, defaultState)
        ).toEqual([]);
    });

    it('ignores a subject:"always" condition — that is not a gate', () => {
        const alwaysAbility = {
            config: { type: 'buff', buffName: 'Defense Up II' },
            conditions: [{ subject: 'always', derivable: true }],
        };
        expect(gatedAutoFilledBuffs([buff()], skills([alwaysAbility]), defaultState)).toEqual([]);
    });

    it('finds a matching ability regardless of which slot it lives in', () => {
        const charged = {
            slots: [{ slot: 'charged', abilities: [gatedAbility] }],
        } as unknown as ShipSkills;
        expect(
            gatedAutoFilledBuffs([buff({ skillSource: 'charge' })], charged, defaultState)
        ).toHaveLength(1);
        expect(
            gatedAutoFilledBuffs(
                [buff({ skillSource: 'passive3' })],
                skills([gatedAbility]),
                defaultState
            )
        ).toHaveLength(1);
    });

    it('reports nothing when the buff has no matching ability at all', () => {
        expect(
            gatedAutoFilledBuffs(
                [buff({ buffName: 'Attack Up II' })],
                skills([gatedAbility]),
                defaultState
            )
        ).toEqual([]);
    });

    it('reports nothing for an absent shipSkills (a manual config with no ship)', () => {
        expect(gatedAutoFilledBuffs([buff()], undefined, defaultState)).toEqual([]);
    });

    it('joins an anyOf OR-run with "or", not ", " — Panon\'s "Provoked or Taunted" shape', () => {
        // The second condition carries anyOf:true, meaning it is an ALTERNATIVE to the first,
        // not an additional AND-ed requirement. ', ' would overclaim the gate as stricter than
        // the game rule ("while Taunt is active, while affected by Provoke" reads as needing
        // BOTH).
        // Matches the real producer's shape (buildShipAbilities.ts's affectedByConditions /
        // statusEffectCondition): BOTH conditions in an OR-alternation carry anyOf:true, not
        // just the second one.
        const orGatedAbility = {
            config: { type: 'buff', buffName: 'Defense Up II' },
            conditions: [
                { subject: 'self-debuff', derivable: true, buffName: 'Provoke', anyOf: true },
                { subject: 'self-buff', derivable: true, buffName: 'Taunt', anyOf: true },
            ],
        };
        const result = gatedAutoFilledBuffs([buff()], skills([orGatedAbility]), defaultState);
        expect(result).toEqual([
            {
                buffId: 'Defense Up II-passive1-self',
                buffName: 'Defense Up II',
                reason: 'while affected by Provoke or while Taunt is active',
            },
        ]);
    });

    it('keeps AND-joining with ", " for non-anyOf conditions on the same ability', () => {
        const andGatedAbility = {
            config: { type: 'buff', buffName: 'Defense Up II' },
            conditions: [
                {
                    subject: 'hp-threshold',
                    derivable: true,
                    hpComparator: 'below',
                    hpPercent: 60,
                    hpSubject: 'self',
                },
                { subject: 'self-buff', derivable: true, buffName: 'Taunt' },
            ],
        };
        const result = gatedAutoFilledBuffs([buff()], skills([andGatedAbility]), defaultState);
        expect(result).toEqual([
            {
                buffId: 'Defense Up II-passive1-self',
                buffName: 'Defense Up II',
                reason: 'below 60% HP, while Taunt is active',
            },
        ]);
    });

    // #391 final review ruling: gates that CAN be true at full health must be evaluated against
    // page state, not dropped on mere presence. Redeemer's below-60%-HP gate above is the case
    // that must stay dropped — these are the three the ruling adds an answer for.
    describe('answerable gates (#391 final review ruling)', () => {
        const hpAboveAbility = {
            config: { type: 'buff', buffName: 'Defense Up II' },
            conditions: [
                {
                    subject: 'hp-threshold',
                    derivable: true,
                    hpComparator: 'above',
                    hpPercent: 50,
                    hpSubject: 'self',
                },
            ],
        };

        it('counts an hp-threshold "above" gate MET at full health, and prints nothing', () => {
            // "above 50% HP" — a ship the page always evaluates at full health satisfies this,
            // unlike Redeemer's "below 60%" case, which stays dropped (see the test above).
            expect(gatedAutoFilledBuffs([buff()], skills([hpAboveAbility]), defaultState)).toEqual(
                []
            );
        });

        it('still drops Redeemer\'s "below 60% HP" gate at full health — the regression this PR exists to prevent', () => {
            const result = gatedAutoFilledBuffs([buff()], skills([gatedAbility]), defaultState);
            expect(result).toEqual([
                {
                    buffId: 'Defense Up II-passive1-self',
                    buffName: 'Defense Up II',
                    reason: 'below 60% HP',
                },
            ]);
        });

        const lowestSpeedAbility = {
            config: { type: 'buff', buffName: 'Defense Up II' },
            conditions: [{ subject: 'lowest-speed-ally', derivable: true }],
        };

        it('Chakara: "lowest Speed among allies" is MET with an EMPTY ally roster, and counts', () => {
            // A lone actor (no allies configured) is trivially the slowest of one — matches the
            // engine's own lowestSpeedIds(), which folds the owner into the same actor set the
            // minimum is taken over.
            expect(
                gatedAutoFilledBuffs([buff()], skills([lowestSpeedAbility]), {
                    selfSpeed: 100,
                    allySpeeds: [],
                    hasEnemy: false,
                    enemyDebuffNames: [],
                })
            ).toEqual([]);
        });

        it('Chakara: NOT MET once a slower ally exists, and drops with the reason', () => {
            const result = gatedAutoFilledBuffs([buff()], skills([lowestSpeedAbility]), {
                selfSpeed: 100,
                allySpeeds: [50], // a real ally SLOWER than the measured ship — self is no longer lowest
                hasEnemy: false,
                enemyDebuffNames: [],
            });
            expect(result).toEqual([
                {
                    buffId: 'Defense Up II-passive1-self',
                    buffName: 'Defense Up II',
                    reason: 'when this unit has the lowest Speed among allies',
                },
            ]);
        });

        const enemyDebuffCountAbility = {
            config: { type: 'buff', buffName: 'Defense Up II' },
            conditions: [
                {
                    subject: 'enemy-debuff',
                    derivable: true,
                    countComparator: 'gte',
                    countThreshold: 3,
                },
            ],
        };

        it('Asphyxiator-shape: MET once the configured roster lands 3+ distinct debuffs on a real enemy', () => {
            expect(
                gatedAutoFilledBuffs([buff()], skills([enemyDebuffCountAbility]), {
                    selfSpeed: 100,
                    allySpeeds: [],
                    hasEnemy: true,
                    enemyDebuffNames: ['Attack Down', 'Defense Down', 'Speed Down'],
                })
            ).toEqual([]);
        });

        it('Asphyxiator-shape: NOT MET with fewer than 3 configured debuffs, and drops with the reason', () => {
            const result = gatedAutoFilledBuffs([buff()], skills([enemyDebuffCountAbility]), {
                selfSpeed: 100,
                allySpeeds: [],
                hasEnemy: true,
                enemyDebuffNames: ['Attack Down'],
            });
            expect(result).toEqual([
                {
                    buffId: 'Defense Up II-passive1-self',
                    buffName: 'Defense Up II',
                    reason: 'while the enemy has at least 3 debuffs',
                },
            ]);
        });

        it('Asphyxiator-shape: unknowable with NO enemy configured — drops rather than assuming met', () => {
            // The crux: this must NOT fall into evaluateCondition's assume-met fallback. With no
            // enemy, enemyDebuffCount is left undefined, which conditionMet treats as NOT MET —
            // never as a match — so the gate stays dropped exactly as it did before this ruling.
            const result = gatedAutoFilledBuffs([buff()], skills([enemyDebuffCountAbility]), {
                selfSpeed: 100,
                allySpeeds: [],
                hasEnemy: false,
                enemyDebuffNames: [],
            });
            expect(result).toEqual([
                {
                    buffId: 'Defense Up II-passive1-self',
                    buffName: 'Defense Up II',
                    reason: 'while the enemy has at least 3 debuffs',
                },
            ]);
        });

        it('an unanswerable subject (self-crit) stays dropped regardless of any page state', () => {
            const selfCritAbility = {
                config: { type: 'buff', buffName: 'Defense Up II' },
                conditions: [{ subject: 'self-crit', derivable: true }],
            };
            const result = gatedAutoFilledBuffs([buff()], skills([selfCritAbility]), defaultState);
            expect(result).toHaveLength(1);
            expect(result[0].buffId).toBe('Defense Up II-passive1-self');
        });

        it('a mixed AND (one answerable-met, one unanswerable) is treated as wholly unanswerable', () => {
            // hp-threshold above 50% is met at full health, but self-crit can never be answered —
            // the whole path must stay dropped, not partially credited.
            const mixedAbility = {
                config: { type: 'buff', buffName: 'Defense Up II' },
                conditions: [
                    {
                        subject: 'hp-threshold',
                        derivable: true,
                        hpComparator: 'above',
                        hpPercent: 50,
                        hpSubject: 'self',
                    },
                    { subject: 'self-crit', derivable: true },
                ],
            };
            const result = gatedAutoFilledBuffs([buff()], skills([mixedAbility]), defaultState);
            expect(result).toHaveLength(1);
        });
    });
});
