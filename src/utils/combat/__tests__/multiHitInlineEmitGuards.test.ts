/**
 * Guards on playerTurn.ts's INLINE `ability-performed` emit loop (multi-hit full-walk epic, PR6).
 *
 * Deliberately DIRECT runPlayerTurn tests. The guards under test are unreachable through any
 * production cast today (see playerTurn.ts's R5 derivation at the emit loop), so an integration
 * test would pass whether the guard exists or not. Do NOT "upgrade" these to integration tests —
 * that silently removes the only coverage these guards have.
 *
 * That warning still stands, but it is NOT sufficient on its own. A runCombat-level companion now
 * lives at the bottom of this file BECAUSE the direct tests structurally could not see the R5
 * guard's first cut being wrong: they build their own `enemy` actor, so they never exercise the
 * engine's vestigial sink, whose clamped-to-0 `currentHp` made a `currentHp <= 0` guard latch and
 * silence the focus's entire event stream from mid-run onward. Direct coverage proves the guard
 * FIRES when it should; only the runCombat block proves it stays QUIET when it should.
 */
import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '../events';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import type { CombatActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { runCombat, CombatEngineInput } from '../engine';
import type { Position } from '../../../types/encounters';

/** A damage-only active skill with the given hit count. multiplier=100 → 100 x hits. */
const damageSkill = (hits: number): ShipSkills => {
    const ability: Ability = {
        id: `mheg-dmg-${hits}`,
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100, hits },
    };
    return { slots: [{ slot: 'active', abilities: [ability] }] };
};

/** Minimal runtime: no crits (so `damage` is the plain pre-crit number and easy to divide). */
function makeRuntime(skills: ShipSkills): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 10000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
    });
    const neverFire: PlayerActorRuntime['activeCritGate'] = () => false;
    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: 10000,
        crit: 0,
        critDamage: 0,
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
        activeCritGate: neverFire,
        chargedCritGate: neverFire,
        activeHealCritGate: neverFire,
        chargedHealCritGate: neverFire,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

/** Minimal PlayerTurnArgs bound to a single non-positional enemy.
 *
 *  SP-4c-2b widened `PlayerTurnArgs.enemy` to optional (absent = no victim this turn), but every
 *  test in this file is about the BOUND-VICTIM emit loop, so this fixture keeps it REQUIRED in its
 *  return type. That is what lets the tests below reach into `args.enemy` directly instead of
 *  asserting it non-null at each use. */
function makeArgs(
    runtime: PlayerActorRuntime,
    bus = createEventBus()
): PlayerTurnArgs & { enemy: CombatActor } {
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
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
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
        bus,
        round: 1,
    };
}

describe('R5 whiff guard on the inline ability-performed loop', () => {
    /**
     * Deliberately a DIRECT runPlayerTurn test. The guard is unreachable through any production
     * cast (playerTurn.ts's R5 derivation walks every mid-round HP producer and shows none can
     * decline a non-positional bound target's HP), so an integration test would pass whether the
     * guard exists or not. Do NOT "upgrade" this to an integration test — that silently removes
     * the only coverage this guard has. Its runCombat-level companion (bottom of this file) covers
     * the opposite obligation — that the guard does NOT fire on a live-but-HP-floored sink — which
     * this test cannot see; the two are complements, not substitutes.
     */
    it('emits NO ability-performed for a 3-hit cast whose bound target is already DESTROYED', () => {
        const bus = createEventBus();
        const performed: unknown[] = [];
        bus.on('ability-performed', (e) => performed.push(e));

        const args = makeArgs(makeRuntime(damageSkill(3)), bus);
        // The guard's exact condition. `destroyedRound` is the real death stamp on CombatActor
        // (state.ts:151), written once by `recordDestroyed`; set directly here. HP is left ALONE
        // on purpose — the guard must key on death, not on the HP floor (playerTurn.ts's WHICH
        // SIGNAL note), and a fixture that zeroed `currentHp` too would pass under both readings.
        args.enemy.destroyedRound = 1;
        expect(args.enemy.currentHp).toBeGreaterThan(0);
        // `deferAbilityPerformedToEngine` is intentionally unset so the INLINE loop runs (the
        // engine's deferred path implements R5 separately, at positionalApply.ts's per-sub-attack
        // anchor re-resolution).
        expect(args.deferAbilityPerformedToEngine).toBeUndefined();

        runPlayerTurn(args);

        expect(performed).toHaveLength(0);
    });

    /** Control: the SAME cast against a living target still emits one event per sub-attack (PR5). */
    it('still emits one event per sub-attack when the bound target is alive', () => {
        const bus = createEventBus();
        const performed: unknown[] = [];
        bus.on('ability-performed', (e) => performed.push(e));

        runPlayerTurn(makeArgs(makeRuntime(damageSkill(3)), bus));

        expect(performed).toHaveLength(3);
    });
});

type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;

/**
 * PR5's deliverable, pinned directly on `runPlayerTurn`: the inline emit is once per SUB-ATTACK,
 * each event carrying that sub-attack's share of the cast's damage. It is what makes an outgoing
 * per-sub-attack rider (`on-deal-damage` → Burner's Inferno, `on-crit`, `on-ally-crit`) fire N
 * times instead of once, so anything that folds these events back into one silently reverts it.
 *
 * Damage arithmetic (attack 10000, multiplier 100, hits 3, no crit, 0 defence):
 *   effectiveMultiplier = 100 x 3 = 300 → directDamage = 10000 x 3.0 = 30000, split three ways.
 */
describe('inline emit damage split across sub-attacks', () => {
    it('emits THREE events for a 3-hit cast, each carrying a third of the damage', () => {
        const bus = createEventBus();
        const performed: AbilityPerformed[] = [];
        bus.on('ability-performed', (e) => performed.push(e));

        runPlayerTurn(makeArgs(makeRuntime(damageSkill(3)), bus));

        expect(performed).toHaveLength(3);
        expect(performed.map((e) => e.damage)).toEqual([10000, 10000, 10000]);
        // Sigma is unchanged by the split — it is reporting-only, no damage total moves.
        expect(performed.reduce((sum, e) => sum + (e.damage ?? 0), 0)).toBe(30000);
    });
});

// ── runCombat-level companion to the R5 whiff guard ───────────────────────────────────────────

type EnemyAttackerInput = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A positioned enemy that never attacks and never dies — a stable punching bag, so the guard
 *  below observes the emit shape and not a mid-run death. It was originally introduced to satisfy
 *  the engine's roster-emptiness discriminator so the focus's bound target would be the VESTIGIAL
 *  SINK; SP-4c-2d deleted both, and the bound target is now this actor. */
const inertEnemyAt = (id: string, position: Position): EnemyAttackerInput => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 10_000_000, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position,
    affinity: 'antimatter',
    shipSkills: { slots: [] },
});

/**
 * A NON-POSITIONAL focus (no `position`, no `mode: 'battle'`) firing `hits` sub-attacks per
 * round for `numRounds` rounds. `crit: 100, critDamage: 100` doubles every hit, so attack 100,000
 * against a 100% multiplier delivers 200,000 per round — five rounds to exhaust `enemyHp`.
 */
const nonPositionalFocus = (hits: number, numRounds: number): CombatEngineInput => ({
    attack: 100_000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'mheg-rc-dmg',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100, ...(hits > 1 ? { hits } : {}) },
                    },
                ],
            },
        ],
    },
    numRounds,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    affinity: 'antimatter',
    defence: 0,
    hp: 10_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    enemyAttackers: [inertEnemyAt('inert', 'M4')],
});

/** The distinct rounds in which the focus emitted at least one `ability-performed`. */
const emittingRounds = (input: CombatEngineInput): number[] => {
    const bus = createEventBus();
    const rounds = new Set<number>();
    bus.on('ability-performed', (e) => {
        if (e.actorId === 'attacker') rounds.add(e.round);
    });
    runCombat({ ...input, bus });
    return [...rounds].sort((a, b) => a - b);
};

describe('R5 whiff guard — runCombat-level regression (the sink is clamped, not dead)', () => {
    /**
     * WHY THIS EXISTS. The direct `runPlayerTurn` block above structurally cannot see this class
     * of failure: it constructs its own `enemy` actor, so it never exercises the engine's
     * VESTIGIAL SINK — the huge-HP dummy a non-positional cast binds, whose `currentHp` engine.ts
     * (~9513) CLAMPS to `Math.max(0, enemyHp - cumulativeDamage)` and which is documented as never
     * dying (engine.ts:2909). A guard reading `currentHp <= 0` therefore latches permanently once
     * cumulative damage crosses `enemyHp`, silencing the focus's ENTIRE event stream — every
     * combat-log row and every outgoing rider — for the rest of the run.
     */
    it('keeps emitting ability-performed after cumulative damage clamps the sink to 0 HP', () => {
        // 200,000/round against enemyHp 1,000,000: the sink's clamped currentHp reaches 0 at the
        // end of round 5. Rounds 6-10 must still emit.
        expect(emittingRounds(nonPositionalFocus(3, 10))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    /** The epic's governing invariant: a `hits: 1` cast must be byte-identical to pre-epic
     *  behaviour. A guard that latches on the clamped sink breaks it at N=1 too. */
    it('keeps emitting at hits === 1, where the epic guarantees byte-identical behaviour', () => {
        expect(emittingRounds(nonPositionalFocus(1, 10))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
});
