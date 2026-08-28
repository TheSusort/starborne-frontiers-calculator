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

        // Item 1 (#391 final review): these two used to use `self-crit`, which is `derivable:
        // true` and reads `effectiveCritRate / 100 = 0` in this page's context — NOT MET via an
        // inert context field, never via the allow-list. Flipping `isAnswerableCondition`'s
        // `default:` from `false` to `true` left the whole suite green, because self-crit stayed
        // NOT MET either way. `adjacent-ally` (derivable: false) and `not-hit-this-round`
        // (derivable: true, but its context field is never populated by this page) are the two
        // subjects the reviewer names as genuinely pinning the allow-list: both read as MET the
        // moment the allow-list lets them through, so only the allow-list itself keeps them
        // dropped.
        it("an unanswerable derivable:false subject (adjacent-ally) stays dropped, not silently met via evaluateCondition's own assume-met fallback", () => {
            // `evaluateCondition` returns `Math.max(0, cond.manualCount ?? 1)` — i.e. 1, MET — for
            // ANY `derivable: false` condition before it even looks at `subject`. Only
            // `isAnswerableCondition` refusing this subject up front stops that fallback from
            // ever being consulted.
            const adjacentAllyAbility = {
                config: { type: 'buff', buffName: 'Defense Up II' },
                conditions: [{ subject: 'adjacent-ally', derivable: false }],
            };
            const result = gatedAutoFilledBuffs(
                [buff()],
                skills([adjacentAllyAbility]),
                defaultState
            );
            expect(result).toHaveLength(1);
            expect(result[0].buffId).toBe('Defense Up II-passive1-self');
        });

        it("an unanswerable subject (not-hit-this-round) stays dropped even though this page's context would read it as MET", () => {
            // `wasHitThisRound` is never populated by `buildPageConditionContext`, so
            // `evaluateCondition`'s 'not-hit-this-round' arm (`ctx.wasHitThisRound ? 0 : 1`) reads
            // undefined -> falsy -> 1 -> MET. Only the allow-list refusing this subject keeps the
            // gate dropped.
            const notHitAbility = {
                config: { type: 'buff', buffName: 'Defense Up II' },
                conditions: [{ subject: 'not-hit-this-round', derivable: true }],
            };
            const result = gatedAutoFilledBuffs([buff()], skills([notHitAbility]), defaultState);
            expect(result).toHaveLength(1);
            expect(result[0].buffId).toBe('Defense Up II-passive1-self');
        });

        it('a mixed AND (one answerable-met, one allow-list-unanswerable) is treated as wholly unanswerable', () => {
            // hp-threshold above 50% is met at full health, but adjacent-ally (derivable: false)
            // is never on the allow-list — the whole path must stay dropped, not partially
            // credited.
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
                    { subject: 'adjacent-ally', derivable: false },
                ],
            };
            const result = gatedAutoFilledBuffs([buff()], skills([mixedAbility]), defaultState);
            expect(result).toHaveLength(1);
        });

        // Item 2 (#391 final review): the no-enemy sentinel (`enemyDebuffCount` left `undefined`
        // rather than fabricated to `0`) only does observable work on `eq`/`lte` comparators —
        // `gte 3` against 0 or undefined is NOT MET either way, so the existing `gte`-based tests
        // above cannot tell the sentinel apart from its absence. Deleting the sentinel (making
        // `enemyDebuffCount` unconditionally `state.enemyDebuffNames.length`) makes THIS gate
        // silently COUNT instead of drop, because a real 0 satisfies `eq 0` while `undefined`
        // never does (`conditionMet` returns `false` outright on an `undefined` count).
        it('Asphyxiator-shape (eq 0): stays unknowable with NO enemy configured, not silently satisfied by a fabricated zero', () => {
            const enemyDebuffEqZeroAbility = {
                config: { type: 'buff', buffName: 'Defense Up II' },
                conditions: [
                    {
                        subject: 'enemy-debuff',
                        derivable: true,
                        countComparator: 'eq',
                        countThreshold: 0,
                    },
                ],
            };
            const result = gatedAutoFilledBuffs(
                [buff()],
                skills([enemyDebuffEqZeroAbility]),
                defaultState
            );
            expect(result).toEqual([
                {
                    buffId: 'Defense Up II-passive1-self',
                    buffName: 'Defense Up II',
                    reason: 'while the enemy has exactly 0 debuffs',
                },
            ]);
        });

        // Item 4 (#391 final review): `realGates` strips `subject: 'always'` before the array
        // reaches `conditionsMet`, which groups CONSECUTIVE `anyOf` conditions into one OR-run.
        // Stripping a middle `always` can make two previously-separated `anyOf` groups adjacent,
        // silently turning an AND into an OR. Shape: an anyOf hp-threshold, a non-anyOf `always`,
        // then an anyOf lowest-speed-ally. The engine's own grouping (on the UNFILTERED list) is
        // `A AND true AND B` — two singleton/OR groups — so with A met and B unmet the whole path
        // is NOT MET. Filtering `always` out first merges A and B into one OR-group (`A OR B`),
        // which is MET and would silently count the buff.
        it('stripping "always" does not merge two AND-ed anyOf groups into one OR-group', () => {
            const alwaysBetweenOrGroupsAbility = {
                config: { type: 'buff', buffName: 'Defense Up II' },
                conditions: [
                    {
                        subject: 'hp-threshold',
                        derivable: true,
                        hpComparator: 'above',
                        hpPercent: 50,
                        hpSubject: 'self',
                        anyOf: true,
                    },
                    { subject: 'always', derivable: true },
                    { subject: 'lowest-speed-ally', derivable: true, anyOf: true },
                ],
            };
            const result = gatedAutoFilledBuffs([buff()], skills([alwaysBetweenOrGroupsAbility]), {
                selfSpeed: 100,
                allySpeeds: [50], // a real, slower ally — lowest-speed-ally is NOT MET
                hasEnemy: false,
                enemyDebuffNames: [],
            });
            expect(result).toEqual([
                {
                    buffId: 'Defense Up II-passive1-self',
                    buffName: 'Defense Up II',
                    reason: 'above 50% HP or when this unit has the lowest Speed among allies',
                },
            ]);
        });
    });
});
