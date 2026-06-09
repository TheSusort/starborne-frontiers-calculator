/**
 * Self-HP-threshold gate tests (Task 3).
 *
 * Verifies that a self-HP-gated modifier ability fires when the acting actor's
 * HP% is below the configured threshold, and does NOT fire at full HP.
 *
 * Tests use runPlayerTurn directly with explicit selfHpPct so that the gate
 * behavior can be verified independently of whether the engine has a mechanism
 * to reduce the attacker's currentHp (that wiring comes in Task 8).
 */
import { describe, it, expect } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';

// ---------------------------------------------------------------------------
// Minimal fixture builders
// ---------------------------------------------------------------------------

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sg${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/**
 * Build a minimal PlayerActorRuntime for the attacker actor.
 * Only attack/crit/defense stats matter for damage; everything else
 * is zero/false/empty so the test isn't sensitive to side paths.
 */
function makeRuntime(skills: ShipSkills, attackStat = 10000): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: attackStat,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
    });

    const alwaysTrue: PlayerActorRuntime['activeCritGate'] = () => false;

    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: attackStat,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        debuffLandingChance: 1,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        activeCritGate: alwaysTrue,
        chargedCritGate: alwaysTrue,
        activeHealCritGate: alwaysTrue,
        chargedHealCritGate: alwaysTrue,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

/**
 * Minimal PlayerTurnArgs — no DoTs, no accumulation, no bombs.
 * selfHpPct is passed in per-call.
 */
function makeArgs(runtime: PlayerActorRuntime, selfHpPct: number): PlayerTurnArgs {
    const enemy = createActor({
        id: 'enemy',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp: 10_000_000,
            speed: 50,
        },
    });

    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);

    return {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: 10_000_000,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
        enemyHpDecline: 0,
        selfHpPct,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('self-HP-threshold gate in runPlayerTurn', () => {
    /**
     * Skills: active damage (100% multiplier) + passive modifier (+100% attack
     * when selfHpPct < 40).  At attack=10000, defense=0:
     *   - no modifier:   directDamage = 10000 * 1.00 = 10000
     *   - +100% attack:  effectiveAttack = 10000 * 2.00 = 20000 → directDamage = 20000
     */
    it('gate fires when actor HP is below the threshold (30%) and not when above (100%)', () => {
        idCounter = 0;

        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                        // Modifier: +100% attack, gated on self HP < 40%.
                        ab({
                            type: 'modifier',
                            target: 'self',
                            conditions: [
                                {
                                    subject: 'hp-threshold',
                                    derivable: true,
                                    hpSubject: 'self',
                                    hpComparator: 'below',
                                    hpPercent: 40,
                                },
                            ],
                            config: {
                                type: 'modifier',
                                channel: 'attack',
                                value: 100,
                                isMultiplicative: false,
                            },
                        }),
                    ],
                },
            ],
        };

        const runtime = makeRuntime(skills);

        // --- Case 1: HP at 100% → gate does NOT fire ---
        const atFull = runPlayerTurn(makeArgs(runtime, 100));
        expect(atFull.directDamage).toBe(10000);

        // --- Case 2: HP at 30% (below 40 threshold) → gate FIRES, +100% attack ---
        const atLow = runPlayerTurn(makeArgs(runtime, 30));
        expect(atLow.directDamage).toBe(20000);
    });

    it('gate does not fire when HP is exactly at the threshold (40%)', () => {
        idCounter = 0;

        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        ab({
                            type: 'modifier',
                            target: 'self',
                            conditions: [
                                {
                                    subject: 'hp-threshold',
                                    derivable: true,
                                    hpSubject: 'self',
                                    hpComparator: 'below',
                                    hpPercent: 40,
                                },
                            ],
                            config: {
                                type: 'modifier',
                                channel: 'attack',
                                value: 100,
                                isMultiplicative: false,
                            },
                        }),
                    ],
                },
            ],
        };

        const runtime = makeRuntime(skills);

        // Exactly at threshold: 40 < 40 is false → gate does not fire.
        const atThreshold = runPlayerTurn(makeArgs(runtime, 40));
        expect(atThreshold.directDamage).toBe(10000);
    });

    it('default selfHpPct (omitted) behaves as 100% — gate does not fire', () => {
        idCounter = 0;

        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        ab({
                            type: 'modifier',
                            target: 'self',
                            conditions: [
                                {
                                    subject: 'hp-threshold',
                                    derivable: true,
                                    hpSubject: 'self',
                                    hpComparator: 'below',
                                    hpPercent: 40,
                                },
                            ],
                            config: {
                                type: 'modifier',
                                channel: 'attack',
                                value: 100,
                                isMultiplicative: false,
                            },
                        }),
                    ],
                },
            ],
        };

        const runtime = makeRuntime(skills);

        // Omit selfHpPct — PlayerTurnArgs interface will not include it; should default to 100.
        const args = makeArgs(runtime, 100);
        // Remove selfHpPct to simulate an omitted caller
        const { selfHpPct: _ignored, ...argsWithoutHpPct } = args as typeof args & {
            selfHpPct?: number;
        };

        const turn = runPlayerTurn(argsWithoutHpPct as PlayerTurnArgs);
        expect(turn.directDamage).toBe(10000);
    });
});
