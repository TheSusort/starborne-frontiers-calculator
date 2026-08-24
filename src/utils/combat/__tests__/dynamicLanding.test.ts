/**
 * A2 Task 4: per-target debuff landing/resist recomputed LIVE each turn from the
 * acting actor's effective hacking (× affinity) vs the TARGET's effective security.
 *
 *   effHacking = effectiveStatsOf(attacker).hacking * (1 + affinityDamageModifier/100)
 *   effSec     = effectiveStatsOf(defender).security
 *   chance     = clamp(effHacking - effSec, 0, 100) / 100
 *
 * The landing draw is the deterministic RateGate (rateAccumulator): a chance of 1.0
 * lands every call; 0.0 lands never. These tests drive runPlayerTurn DIRECTLY (the
 * targetIdRouting harness) so the attacker/defender/statusEngine are fully controlled,
 * and observe landing via the `debuff-applied` event for an 'inflict' timed enemy debuff.
 *
 * Each test asserts a NON-ZERO baseline THEN the shift (vacuous-test guard).
 */
import { describe, it, expect } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine, RegisteredAbilityStatus, StatusEngine } from '../statusEngine';
import { createEventBus, CombatEvent } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { ShipSkills } from '../../../types/abilities';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** An 'inflict' timed enemy debuff fired on the 'active' slot — its landing is the
 *  hacking-vs-security draw (NOT affinity-only). Re-fires each turn → one
 *  debuff-applied per landed round. */
function inflictEnemyStatus(buffName: string): Extract<RegisteredAbilityStatus, { kind: 'timed' }> {
    return {
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration: 2,
        payload: { buffName, stacks: 1, parsedEffects: { defense: -10 }, application: 'inflict' },
    };
}

/** An 'apply' (affinity-based) timed enemy debuff — lands unless the attacker is at an
 *  affinity disadvantage, NEVER drawing the hacking-vs-security gate. */
function applyEnemyStatus(buffName: string): Extract<RegisteredAbilityStatus, { kind: 'timed' }> {
    return {
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration: 2,
        payload: { buffName, stacks: 1, parsedEffects: { defense: -10 }, application: 'apply' },
    };
}

/** A self ability status carrying a hacking/security delta in its payload (lookup-free —
 *  effectiveStatsOf folds it from timedAbilityStatuses). */
function selfStatStatus(
    buffName: string,
    parsedEffects: { hacking?: number; security?: number }
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> {
    return {
        kind: 'timed',
        side: 'self',
        sourceSlot: 'active',
        conditions: [],
        duration: 10,
        payload: { buffName, stacks: 1, parsedEffects },
    };
}

interface RuntimeOpts {
    hacking?: number;
    affinityDamageModifier?: number;
    affinityDisadvantage?: boolean;
    timedEnemyBySlot?: PlayerActorRuntime['timedEnemyBySlot'];
}

function makeRuntime(opts: RuntimeOpts = {}): PlayerActorRuntime {
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
            hacking: opts.hacking,
        },
        chargeCount: 0,
        startCharged: false,
    });

    const noGate: PlayerActorRuntime['activeCritGate'] = () => false;
    const skills: ShipSkills = {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'dmg1',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
        ],
    };

    const affMod = opts.affinityDamageModifier ?? 0;
    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: opts.timedEnemyBySlot ?? [],
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
        affinityDamageModifier: affMod,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: opts.affinityDisadvantage ?? affMod < 0,
        activeCritGate: noGate,
        chargedCritGate: noGate,
        activeHealCritGate: noGate,
        chargedHealCritGate: noGate,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

function makeEnemy(security?: number) {
    return createActor({
        id: 'enemy-actor',
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
            security,
        },
    });
}

function makeArgs(
    runtime: PlayerActorRuntime,
    statusEngine: StatusEngine,
    enemy: ReturnType<typeof makeEnemy>,
    bus: ReturnType<typeof createEventBus>,
    round: number
): PlayerTurnArgs {
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
        round,
    };
}

/** The SP-4c-2b no-victim turn: `enemy` ABSENT, and with it every enemy-derived arg. Not "a neutral
 *  enemy" — absent means the turn faces nobody, which is what an ally-targeted cast resolves.
 *  Deliberately built by OMISSION rather than by passing a stand-in actor: this shape must stay
 *  buildable after the vestigial dummy actor is deleted, so it may not reference one. */
function makeNoVictimArgs(
    runtime: PlayerActorRuntime,
    statusEngine: StatusEngine,
    bus: ReturnType<typeof createEventBus>,
    round: number
): PlayerTurnArgs {
    return { runtime, statusEngine, bus, round };
}

/** Run `numRounds` turns of one inflict-debuff caster and count the debuff-applied
 *  events (one per landed round). seedSelf/seedEnemy let a test pre-apply a live
 *  hacking/security status active from round 1. */
function countLanded(opts: {
    numRounds: number;
    hacking?: number;
    enemySecurity?: number;
    affinityDamageModifier?: number;
    affinityDisadvantage?: boolean;
    apply?: boolean; // use an 'apply' (affinity) debuff instead of 'inflict'
    seedSelf?: Extract<RegisteredAbilityStatus, { kind: 'timed' }>;
    seedEnemy?: Extract<RegisteredAbilityStatus, { kind: 'timed' }>;
}): number {
    const status = opts.apply ? applyEnemyStatus('Test Debuff') : inflictEnemyStatus('Test Debuff');
    const statuses: RegisteredAbilityStatus[] = [status];
    if (opts.seedSelf) statuses.push(opts.seedSelf);
    if (opts.seedEnemy) statuses.push(opts.seedEnemy);

    const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    eng.registerAbilityStatuses(statuses);

    const events: CombatEvent[] = [];
    const bus = createEventBus();
    bus.on('debuff-applied', (e) => events.push(e));

    const runtime = makeRuntime({
        hacking: opts.hacking,
        affinityDamageModifier: opts.affinityDamageModifier,
        affinityDisadvantage: opts.affinityDisadvantage,
        timedEnemyBySlot: [status],
    });
    const enemy = makeEnemy(opts.enemySecurity);

    for (let r = 1; r <= opts.numRounds; r++) {
        eng.beginRound(r);
        if (r === 1) {
            // Seed live self/enemy stat statuses active from round 1.
            if (opts.seedSelf) eng.applyTimedAbilityStatus(r, opts.seedSelf, 'attacker');
            if (opts.seedEnemy) eng.applyTimedAbilityStatus(r, opts.seedEnemy, 'enemy-actor');
        }
        runPlayerTurn(makeArgs(runtime, eng, enemy, bus, r));
    }
    return events.filter((e) => e.type === 'debuff-applied').length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('A2 Task 4 — dynamic per-target debuff landing/resist', () => {
    const N = 6;

    it('Hacking Down on the attacker lowers landed inflict debuffs vs baseline', () => {
        // Baseline: hacking 200 vs security 100 → chance 1.0 → lands every round.
        const baseline = countLanded({ numRounds: N, hacking: 200, enemySecurity: 100 });
        expect(baseline).toBe(N); // non-zero guard

        // Hacking Down -120: effective hacking 80 vs security 100 → chance 0 → never lands.
        const debuffed = countLanded({
            numRounds: N,
            hacking: 200,
            enemySecurity: 100,
            seedSelf: selfStatStatus('Hacking Down', { hacking: -120 }),
        });
        expect(debuffed).toBeLessThan(baseline);
        expect(debuffed).toBe(0);
    });

    it('Security Up on the defender raises resist (fewer landed) vs baseline', () => {
        const baseline = countLanded({ numRounds: N, hacking: 200, enemySecurity: 100 });
        expect(baseline).toBe(N); // non-zero guard

        // Security Up +100: security 200 vs hacking 200 → chance 0 → never lands.
        const resisted = countLanded({
            numRounds: N,
            hacking: 200,
            enemySecurity: 100,
            seedEnemy: selfStatStatus('Security Up', { security: 100 }),
        });
        expect(resisted).toBeLessThan(baseline);
        expect(resisted).toBe(0);
    });

    it('affinity-disadvantaged attacker still fails to land an apply debuff (rule holds)', () => {
        // Neutral: an 'apply' debuff lands every round.
        const neutral = countLanded({
            numRounds: N,
            hacking: 200,
            enemySecurity: 100,
            apply: true,
        });
        expect(neutral).toBe(N); // non-zero guard

        // Affinity disadvantage: 'apply' debuffs never land.
        const disadvantaged = countLanded({
            numRounds: N,
            hacking: 200,
            enemySecurity: 100,
            apply: true,
            affinityDamageModifier: -25,
            affinityDisadvantage: true,
        });
        expect(disadvantaged).toBe(0);
    });

    it('no-buff / neutral-affinity run lands exactly as the static baseline (parity)', () => {
        // hacking 200, security 100 → chance 1.0 → every round.
        expect(countLanded({ numRounds: N, hacking: 200, enemySecurity: 100 })).toBe(N);
        // Partial chance: hacking 200, security 150 → chance 0.5 → lands on calls 2,4,6 → 3 of 6.
        expect(countLanded({ numRounds: N, hacking: 200, enemySecurity: 150 })).toBe(3);
    });

    it('affinity advantage on the attacker RAISES landing (× hacking) vs neutral', () => {
        // Neutral: hacking 200, security 250 → chance 0 → never lands.
        const neutral = countLanded({ numRounds: N, hacking: 200, enemySecurity: 250 });
        expect(neutral).toBe(0);
        // +25% affinity: effective hacking 250 vs security 250 → chance 0 still (boundary).
        // Bump to a case where affinity flips a resist into a land: hacking 200, security 230.
        const neutral2 = countLanded({ numRounds: N, hacking: 200, enemySecurity: 230 });
        expect(neutral2).toBe(0);
        const advantaged = countLanded({
            numRounds: N,
            hacking: 200,
            enemySecurity: 230,
            affinityDamageModifier: 25, // effHacking 250 vs 230 → chance 0.2 → lands once over 6
        });
        expect(advantaged).toBeGreaterThan(neutral2);
    });
});

/**
 * SP-4c-2d (review wave 2, FIX 2) — THE PUBLICATION GUARD, fenced.
 *
 * `runPlayerTurn` ends its landing-chance derivation with `if (hasVictim)
 * runtime.liveDebuffLandingChance = liveLandingChance` (playerTurn.ts). The conjunct is the whole
 * subject here: on a no-victim turn `liveLandingChance` is correctly 0 ("there is no enemy whose
 * security to beat"), and PUBLISHING that 0 is how the original Flamel defect worked — an
 * ally-targeted supporter published 0 and every later reader of the field auto-resisted forever
 * (measured on Flamel at the time: 138 landings → 0).
 *
 * WHY IT NEEDS A FENCE AT ALL. The guard is CORPUS-INERT: SP-4c-2b gave the reactive path its own
 * per-victim resolver and SP-4c-2d deleted the victimless fallbacks in triggers.ts, so no shape the
 * suite can build now reads a poisoned publication. Measured by mutation: with the `hasVictim`
 * conjunct removed, all 7 pre-existing test files that name `liveDebuffLandingChance` stay green
 * (96 tests). That is precisely the state in which a future "simplification" deletes the conjunct
 * and nothing objects — the defect class this repo has shipped twice. So the guard gets a case whose
 * only subject is the guard.
 *
 * NOT "structurally unreachable": the field still has readers (the `?? owner.liveDebuffLandingChance`
 * tails in triggers.ts), and 24 of 148 shipped ships have an ally-side active target, so the arming
 * shape exists on the board — it is one refactor from being wired to a reader again.
 *
 * THIS GUARD SURVIVES THE EPIC, unlike its sibling. `reactiveLandingChanceFor`'s dummy-sentinel
 * refusal (engine.ts) is dead once the dummy actor is deleted, because refusing that actor's id is
 * all it does. This one never mentions the dummy: its subject is a turn with NO victim, a shape
 * SP-4c-2b created and which outlives the dummy entirely. Hence the fixture builds its no-victim
 * turn by OMITTING `enemy` (see `makeNoVictimArgs`) rather than by handing over a stand-in, so this
 * file keeps compiling and keeps meaning the same thing after the deletion.
 *
 * DRIVEN THROUGH `runPlayerTurn`, and reading the runtime FIELD rather than an event, because the
 * write is the behaviour: there is no observable emission downstream of it (that is exactly what
 * "inert" means). Two turns on ONE runtime is the minimum shape that can tell "kept the real value"
 * apart from "never had one".
 */
describe('SP-4c-2d: a no-victim turn does not publish a landing chance', () => {
    /** hacking 200 vs security 150 → clamp(200 − 150, 0, 100)/100. Exact in binary, so `toBe`. */
    const REAL_CHANCE = 0.5;

    /** One runtime, `turns` sequential turns: turn 1 faces a real victim, every later turn faces
     *  NOBODY. Returns the runtime so the caller can read the published field directly. */
    const runTurns = (turns: number): PlayerActorRuntime => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const bus = createEventBus();
        const runtime = makeRuntime({ hacking: 200 });
        const enemy = makeEnemy(150);
        for (let r = 1; r <= turns; r++) {
            eng.beginRound(r);
            runPlayerTurn(
                r === 1
                    ? makeArgs(runtime, eng, enemy, bus, r)
                    : makeNoVictimArgs(runtime, eng, bus, r)
            );
        }
        return runtime;
    };

    it('NON-VACUOUS BASELINE: a turn WITH a victim publishes that victim-derived chance', () => {
        // Without this half, the case below passes when the field is never written at all — the
        // "correctly kept 0.5" / "never had 0.5 to keep" confusion.
        expect(runTurns(1).liveDebuffLandingChance).toBe(REAL_CHANCE);
    });

    it('THE GUARD: a following NO-VICTIM turn leaves it at the real chance, not 0', () => {
        // Remove the `hasVictim` conjunct at playerTurn.ts's publication site and this reads 0.
        expect(runTurns(2).liveDebuffLandingChance).toBe(REAL_CHANCE);
    });
});
