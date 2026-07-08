/**
 * SP-F F4 — Wusheng / Isha / Nayra forced-affinity override.
 *
 * Runtime (engine-seam) proof that the forced-affinity surface actually changes the combat
 * OUTCOME at a REAL affinity disadvantage/advantage. Three sources, three seams:
 *   - Wusheng: the firing damage ability's `forceAffinityAdvantage` flag forces ADVANTAGE.
 *   - Isha/Nayra offense: the 'Offensive Affinity Override' self-buff forces the bearer's
 *     outgoing hits to ADVANTAGE.
 *   - Isha/Nayra defense: the 'Defensive Affinity Override' self-buff on the VICTIM forces the
 *     incoming attacker to DISADVANTAGE against that victim.
 * Each is exercised at the three seams (damage mult, crit cap, 'apply' debuff landing), on both
 * the player and enemy side (runPlayerTurn is team-agnostic → the same runner drives both sides).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate, setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { ShipSkills } from '../../../types/abilities';
import { AffinityName } from '../../../types/ship';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ship } from '../../../types/ship';

// ── Affinity scalar presets (as the calculator adapter pre-resolves them) ────────────────────
const ADVANTAGE = { damageModifier: 25, critCap: 100, critPenalty: 0, disadvantage: false };
const DISADVANTAGE = { damageModifier: -25, critCap: 75, critPenalty: 25, disadvantage: true };
const NEUTRAL = { damageModifier: 0, critCap: 100, critPenalty: 0, disadvantage: false };
type Preset = typeof NEUTRAL;

function damageSkill(opts: { forceAffinityAdvantage?: boolean; multiplier?: number }): ShipSkills {
    return {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'dmg',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'damage',
                            multiplier: opts.multiplier ?? 100,
                            hits: 1,
                            ...(opts.forceAffinityAdvantage
                                ? { forceAffinityAdvantage: true }
                                : {}),
                        },
                    },
                ],
            },
        ],
    };
}

/** An 'apply' Defense Down as a scheduled timed-enemy slot (the landing path exercised by the
 *  isApply-vs-disadvantage seam; a castSkills `debuff` ability does not route through it). */
function applyDebuffSlot(): PlayerActorRuntime['timedEnemyBySlot'] {
    return [
        {
            kind: 'timed',
            duration: 3,
            side: 'enemy',
            sourceSlot: 'active',
            conditions: [],
            payload: {
                buffName: 'Defense Down',
                parsedEffects: { defense: -50 },
                application: 'apply',
                stacks: 1,
            },
        },
    ];
}

interface MakeOpts {
    side?: 'player' | 'enemy';
    crit?: number;
    critDamage?: number;
    affinity?: AffinityName;
    selfOverrideBuff?: string;
    withApplyDebuff?: boolean;
}

function makeRuntime(
    skills: ShipSkills,
    preset: Preset,
    opts: MakeOpts = {}
): { runtime: PlayerActorRuntime; statusEngine: ReturnType<typeof createStatusEngine> } {
    const side = opts.side ?? 'player';
    const affinity = opts.affinity ?? 'chemical';
    const actor = createActor({
        id: 'attacker',
        side,
        kind: 'attacker',
        stats: {
            attack: 1000,
            crit: opts.crit ?? 0,
            critDamage: opts.critDamage ?? 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
            hacking: 200,
        },
        chargeCount: 0,
        startCharged: false,
        affinity,
    });
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);
    if (opts.selfOverrideBuff) seedSelfBuff(statusEngine, 1, 'attacker', opts.selfOverrideBuff);
    const runtime: PlayerActorRuntime = {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: opts.withApplyDebuff ? applyDebuffSlot() : [],
        hasChargedSkill: false,
        attack: 1000,
        crit: opts.crit ?? 0,
        critDamage: opts.critDamage ?? 0,
        defensePenetration: 0,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: preset.damageModifier,
        affinityCritCap: preset.critCap,
        affinityCritPenalty: preset.critPenalty,
        affinityDisadvantage: preset.disadvantage,
        attackerAffinity: affinity,
        activeCritGate: makeRateGate(),
        chargedCritGate: makeRateGate(),
        activeHealCritGate: makeRateGate(),
        chargedHealCritGate: makeRateGate(),
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
    return { runtime, statusEngine };
}

/** Seed a named timed SELF-buff onto an owner (mirrors the start-of-round Override grant). */
function seedSelfBuff(
    statusEngine: ReturnType<typeof createStatusEngine>,
    round: number,
    ownerId: string,
    buffName: string
): void {
    const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
        payload: { buffName, stacks: 1, parsedEffects: {} },
        side: 'self',
        sourceSlot: 'passive',
        conditions: [],
        casterId: ownerId,
        recipients: [ownerId],
        kind: 'timed',
        duration: 5,
    };
    statusEngine.applyTimedAbilityStatus(round, status, ownerId);
}

function runTurn(
    made: { runtime: PlayerActorRuntime; statusEngine: ReturnType<typeof createStatusEngine> },
    opts: { enemyAffinity?: AffinityName; enemyDefensiveOverride?: boolean } = {}
): { directDamage: number; roundCrit: boolean; outcomes: string[] } {
    const { runtime, statusEngine } = made;
    const enemySide = runtime.actor.side === 'player' ? 'enemy' : 'player';
    const enemy = createActor({
        id: 'anchor',
        side: enemySide,
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 1e9,
            speed: 50,
            security: 100,
        },
        affinity: opts.enemyAffinity ?? 'thermal',
    });
    if (opts.enemyDefensiveOverride)
        seedSelfBuff(statusEngine, 1, 'anchor', 'Defensive Affinity Override');
    const bus = createEventBus();
    const outcomes: string[] = [];
    bus.on('debuff-applied', () => outcomes.push('applied'));
    bus.on('debuff-resisted', () => outcomes.push('resisted'));
    const args: PlayerTurnArgs = {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: 1e9,
        enemyType: undefined,
        bus,
        round: 1,
        targetId: 'anchor',
        deferAbilityPerformedToEngine: false,
    };
    const result = runPlayerTurn(args);
    return { directDamage: result.directDamage, roundCrit: result.roundCrit, outcomes };
}

describe('SP-F F4 — forced-affinity override', () => {
    afterEach(() => resetRateGateRng());

    // ── Wusheng: forceAffinityAdvantage flag ─────────────────────────────────────────────────
    describe('Wusheng forceAffinityAdvantage flag', () => {
        it('forces ADVANTAGE damage at a real disadvantage (player side)', () => {
            const base = runTurn(runTurnMk(damageSkill({}), NEUTRAL)).directDamage;
            const disNoFlag = runTurn(runTurnMk(damageSkill({}), DISADVANTAGE)).directDamage;
            const disFlag = runTurn(
                runTurnMk(damageSkill({ forceAffinityAdvantage: true }), DISADVANTAGE)
            ).directDamage;
            expect(disNoFlag).toBeCloseTo(base * 0.75, 5);
            expect(disFlag).toBeCloseTo(base * 1.25, 5);
        });

        it('lifts the crit penalty-cap at a real disadvantage', () => {
            // crit 100: advantage cap 100 → always crit; disadvantage cap 75 → rate 0.75.
            setRateGateRng(() => 0.8);
            const noFlag = runTurn(
                runTurnMk(damageSkill({}), DISADVANTAGE, { crit: 100, critDamage: 50 })
            ).roundCrit;
            setRateGateRng(() => 0.8);
            const withFlag = runTurn(
                runTurnMk(damageSkill({ forceAffinityAdvantage: true }), DISADVANTAGE, {
                    crit: 100,
                    critDamage: 50,
                })
            ).roundCrit;
            expect(noFlag).toBe(false);
            expect(withFlag).toBe(true);
        });

        it("lands a paired 'apply' debuff that would resist at a real disadvantage", () => {
            const noFlag = runTurn(
                runTurnMk(damageSkill({}), DISADVANTAGE, { withApplyDebuff: true })
            ).outcomes;
            const withFlag = runTurn(
                runTurnMk(damageSkill({ forceAffinityAdvantage: true }), DISADVANTAGE, {
                    withApplyDebuff: true,
                })
            ).outcomes;
            expect(noFlag).toEqual(['resisted']);
            expect(withFlag).toEqual(['applied']);
        });

        it('forces ADVANTAGE identically on the ENEMY side (team-symmetry)', () => {
            const base = runTurn(
                runTurnMk(damageSkill({}), NEUTRAL, { side: 'enemy' })
            ).directDamage;
            const disFlag = runTurn(
                runTurnMk(damageSkill({ forceAffinityAdvantage: true }), DISADVANTAGE, {
                    side: 'enemy',
                })
            ).directDamage;
            expect(disFlag).toBeCloseTo(base * 1.25, 5);
        });

        it('the real Wusheng charged build carries the flag and forces advantage end-to-end', () => {
            const built = buildShipAbilities(wusheng()).slots.find((s) => s.slot === 'charged');
            const abilities = built?.abilities ?? [];
            // Drive the built charged abilities as an active cast (the flag is slot-agnostic at
            // the seam) so we assert the runtime damage outcome without charge bookkeeping.
            const skills: ShipSkills = { slots: [{ slot: 'active', abilities }] };
            // Baseline: an UNFLAGGED 220% hit at neutral affinity.
            const base = runTurn(runTurnMk(damageSkill({ multiplier: 220 }), NEUTRAL)).directDamage;
            const disFlag = runTurn(runTurnMk(skills, DISADVANTAGE)).directDamage;
            expect(disFlag).toBeCloseTo(base * 1.25, 5);
        });
    });

    // ── Isha/Nayra: Offensive Affinity Override buff ─────────────────────────────────────────
    describe('Offensive Affinity Override buff', () => {
        it('forces the bearer to ADVANTAGE at a real disadvantage (player + enemy side)', () => {
            for (const side of ['player', 'enemy'] as const) {
                const base = runTurn(runTurnMk(damageSkill({}), NEUTRAL, { side })).directDamage;
                const disNoBuff = runTurn(
                    runTurnMk(damageSkill({}), DISADVANTAGE, { side })
                ).directDamage;
                const disBuff = runTurn(
                    runTurnMk(damageSkill({}), DISADVANTAGE, {
                        side,
                        selfOverrideBuff: 'Offensive Affinity Override',
                        withApplyDebuff: true,
                    })
                );
                expect(disNoBuff).toBeCloseTo(base * 0.75, 5);
                expect(disBuff.directDamage).toBeCloseTo(base * 1.25, 5);
                expect(disBuff.outcomes).toEqual(['applied']); // 'apply' debuff also lands
            }
        });
    });

    // ── Isha/Nayra: Defensive Affinity Override buff (victim-side) ────────────────────────────
    describe('Defensive Affinity Override buff (victim-side)', () => {
        it('forces an ADVANTAGED attacker to DISADVANTAGE against the bearer', () => {
            // Attacker thermal vs enemy chemical → thermal beats chemical → real ADVANTAGE.
            const mk = (defensive: boolean, withApplyDebuff = false) =>
                runTurn(
                    makeRuntime(damageSkill({}), ADVANTAGE, {
                        affinity: 'thermal',
                        withApplyDebuff,
                    }),
                    { enemyAffinity: 'chemical', enemyDefensiveOverride: defensive }
                );
            const base = runTurn(makeRuntime(damageSkill({}), NEUTRAL, { affinity: 'thermal' }), {
                enemyAffinity: 'chemical',
            }).directDamage;
            expect(mk(false).directDamage).toBeCloseTo(base * 1.25, 5);
            expect(mk(true).directDamage).toBeCloseTo(base * 0.75, 5);
            // A would-be-landing 'apply' debuff now resists (attacker forced to disadvantage).
            expect(mk(false, true).outcomes).toEqual(['applied']);
            expect(mk(true, true).outcomes).toEqual(['resisted']);
        });
    });
});

// ── helpers ─────────────────────────────────────────────────────────────────────────────────
function runTurnMk(skills: ShipSkills, preset: Preset, opts: MakeOpts = {}) {
    return makeRuntime(skills, preset, opts);
}

function wusheng(): Ship {
    return {
        refits: [{}, {}, {}, {}],
        chargeSkillText:
            'This Unit deals <unit-damage>220% damage</unit-damage> with affinity advantage and inflicts <unit-skill>Stasis</unit-skill> for 2 turns.',
        chargeSkillCharge: 3,
    } as unknown as Ship;
}
