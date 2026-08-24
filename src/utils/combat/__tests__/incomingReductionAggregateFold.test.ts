/**
 * D-PR3 Task 9 — aggregate-path victim-side incoming %-reduction fold.
 *
 * Pins the new `incomingReductionNonCritPct` / `incomingReductionCritFamilyPct`
 * inputs to `runPlayerTurn` at the unit level (mirrors perHitCrit.test.ts harness).
 *
 * Baseline math (attack=10000, multiplier=100, hits=3, 0 defence/buffs):
 *   effectiveMultiplier = 300 → preCritDamage = 10000 × 3.0 = 30000.
 *   critDamage = 100 → at 100% crit damageCritMultiplier = 1 + 1×(100/100) = 2.0.
 *
 * Crit-family reduction (R) applies to the crit FRACTION only:
 *   damageCritMultiplier = (1 - cf) + cf × (1 + cd/100) × (1 - R/100).
 *   100% crit, R=35: (0) + 1×2.0×0.65 = 1.3 → directDamage = 30000 × 1.3 = 39000.
 *   0%  crit, R=35: 1.0 → directDamage = 30000 (unchanged — no crit portion).
 *
 * Non-crit reduction applies to ALL hits via the incoming modifier term:
 *   nonCritFactor ×= (1 + (incomingMod - equipNonCrit)/100).
 *   0% crit, nonCrit=20: 30000 × 0.8 = 24000.
 */
import { describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';

// An always-active, guaranteed-landing ('apply') enemy "+N% damage taken" debuff on the
// victim. Drives `incomingDamageModifier` non-zero through the status-engine path so the
// aggregate fold's incoming channel is exercised together with a crit-family reduction.
const DMG_TAKEN_BUFF = 'enemy-damage-taken';
function damageTakenBuff(pct: number): SelectedGameBuff {
    return {
        id: 'enemy-damage-taken-1',
        buffName: DMG_TAKEN_BUFF,
        stacks: 1,
        isStackable: false,
        application: 'apply', // affinity-based → lands unless affinity-disadvantaged (it isn't)
        skillSource: 'passive1', // always-active → snapshots as 'recurring'
        parsedEffects: { incomingDamage: pct },
    };
}

function makeRuntime(
    critAlwaysFires: boolean,
    enemyDebuffLookup?: Map<string, SelectedGameBuff[]>
): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 10000,
            crit: critAlwaysFires ? 100 : 0,
            critDamage: 100,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
    });
    const alwaysFire: PlayerActorRuntime['activeCritGate'] = () => true;
    const neverFire: PlayerActorRuntime['activeCritGate'] = () => false;
    const gate = critAlwaysFires ? alwaysFire : neverFire;
    const skills: ShipSkills = {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'dmg-agg1',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100, hits: 3 },
                    },
                ],
            },
        ],
    };
    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: 10000,
        crit: critAlwaysFires ? 100 : 0,
        critDamage: 100,
        defensePenetration: 0,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        activeCritGate: gate,
        chargedCritGate: gate,
        activeHealCritGate: neverFire,
        chargedHealCritGate: neverFire,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: enemyDebuffLookup ?? new Map(),
    };
}

function makeArgs(
    runtime: PlayerActorRuntime,
    extra?: Partial<PlayerTurnArgs>,
    enemyDebuffs: SelectedGameBuff[] = []
): PlayerTurnArgs {
    const enemy = createActor({
        id: 'enemy',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 10_000_000,
            speed: 50,
        },
    });
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs });
    statusEngine.beginRound(1);
    return {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: 10_000_000,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
        ...extra,
    };
}

describe('aggregate-path incoming %-reduction fold', () => {
    it('crit-family R=35 on a 100% crit reduces the crit portion (60000 → 39000)', () => {
        const baseline = runPlayerTurn(makeArgs(makeRuntime(true)));
        expect(baseline.directDamage).toBe(60000);
        const reduced = runPlayerTurn(
            makeArgs(makeRuntime(true), { incomingReductionCritFamilyPct: 35 })
        );
        // (1-1) + 1×2.0×0.65 = 1.3 → 30000 × 1.3 = 39000.
        expect(reduced.directDamage).toBe(39000);
    });

    it('crit-family R=35 on a NON-crit hit leaves damage unchanged', () => {
        const baseline = runPlayerTurn(makeArgs(makeRuntime(false)));
        expect(baseline.directDamage).toBe(30000);
        const reduced = runPlayerTurn(
            makeArgs(makeRuntime(false), { incomingReductionCritFamilyPct: 35 })
        );
        expect(reduced.directDamage).toBe(30000);
    });

    it('non-crit reduction 20% reduces ALL hits (30000 → 24000) on a non-crit', () => {
        const reduced = runPlayerTurn(
            makeArgs(makeRuntime(false), { incomingReductionNonCritPct: 20 })
        );
        expect(reduced.directDamage).toBe(24000);
    });

    it('non-crit reduction 20% reduces a 100% crit too (60000 → 48000)', () => {
        // crit multiplier 2.0 unaffected; nonCritFactor ×0.8 → 60000 × 0.8 = 48000.
        const reduced = runPlayerTurn(
            makeArgs(makeRuntime(true), { incomingReductionNonCritPct: 20 })
        );
        expect(reduced.directDamage).toBe(48000);
    });

    it('both inputs omitted → byte-identical to baseline (crit and non-crit)', () => {
        expect(runPlayerTurn(makeArgs(makeRuntime(true))).directDamage).toBe(60000);
        expect(runPlayerTurn(makeArgs(makeRuntime(false))).directDamage).toBe(30000);
    });

    // PARITY (D-PR3): crit-family reduction must fold ADDITIVELY into the incoming channel —
    // matching the positional path (victimHitDamage) — when an enemy "+N% damage taken" debuff
    // (incomingDamageModifier != 0) co-occurs with a crit-family reduction R on the SAME victim.
    // The crit hit's incoming channel = (incomingDamageModifier - R), NOT a multiplicative split.
    describe('parity with positional path when incomingDamageModifier != 0', () => {
        const lookup = new Map<string, SelectedGameBuff[]>([
            [DMG_TAKEN_BUFF, [damageTakenBuff(30)]],
        ]);

        it('control: +30% damage-taken alone (no reduction) → 60000 × 1.30 = 78000', () => {
            const out = runPlayerTurn(
                makeArgs(makeRuntime(true, lookup), undefined, [damageTakenBuff(30)])
            );
            expect(out.directDamage).toBe(78000);
        });

        it('+30% damage-taken AND crit-family R=35, all hits crit → ADDITIVE channel (30-35)', () => {
            // ADDITIVE (canonical, positional): crit incoming channel = (30 - 35) = -5
            //   crit factor = (1 + (30-35)/100) = 0.95 → 60000 × 0.95 = 57000.
            // OLD multiplicative deviation would give: 60000 × (1.30 × 0.65) = 50700 (WRONG).
            const out = runPlayerTurn(
                makeArgs(makeRuntime(true, lookup), { incomingReductionCritFamilyPct: 35 }, [
                    damageTakenBuff(30),
                ])
            );
            expect(out.directDamage).toBe(57000);
            expect(out.directDamage).not.toBe(50700);
        });
    });
});
