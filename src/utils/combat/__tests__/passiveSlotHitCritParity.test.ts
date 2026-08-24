/**
 * SP-4b-2 D6, task-18 finding 4 — THE PASSIVE-SLOT INSTANCE'S CRIT RESULT, IN BOTH CHANNELS.
 *
 * The always-active passive slot's own `damage` ability is carried by TWO channels that must agree:
 *   • the AGGREGATE `passiveDamage` folded into `PlayerTurnResult.directDamage` — the number the
 *     combat log's `ability-performed.damage` basis is built from;
 *   • the POSITIONAL `PassiveSlotHit`, whose `didCrit` the engine's per-victim apply lands with —
 *     the number the enemy's health actually loses.
 *
 * They were decided differently. The aggregate scaled the instance by `damageCritMultiplier`, the
 * FIRING skill's per-hit BLEND (`1 - critFraction + critFraction × critMult`); the positional hit
 * read `hitCrits[0]`, one hit's outcome. For a single-hit cast the blend collapses to that same
 * boolean, which is why nothing caught it — a `hits: 2` cast with one crit and one non-crit valued
 * the instance at 1.5× in the log and landed it at 2.0× on the enemy.
 *
 * A second, latent half: the per-hit loop draws whether or not a damage ability fired, but only
 * PUSHES to `hitCrits` when one did. A cast with no firing-slot damage ability therefore crits the
 * aggregate off a draw that `hitCrits[0] ?? false` reports as no-crit. That instance never reaches
 * the positional path today (its gate needs the firing skill's `positionalScalars`, documented as
 * known gap (b) on `stagePassiveSlotHit`), so the field was wrong without being wrong-in-effect —
 * case 3 pins the value so closing that gap cannot inherit the defect.
 *
 * The fix is ONE `passiveDidCrit` boolean read by both channels. It adds NO draw: it captures the
 * first firing-hit draw the loop already makes. `noCrit` still forces no-crit.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus, CombatEvent } from '../events';
import {
    makeRateGate,
    setKeyedRng,
    makeKeyedRng,
    resetRateGateRng,
} from '../../calculators/rateAccumulator';
import { ShipSkills, Ability, AbilityTarget } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;

let idc = 0;
const damageAbility = (
    multiplier: number,
    target: AbilityTarget = 'enemy',
    hits?: number
): Ability => ({
    id: `pcp${++idc}`,
    type: 'damage',
    target,
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier, ...(hits !== undefined ? { hits } : {}) },
});

/** Active slot = the firing skill (`hits` of them); passive slot = the instance under test, aimed
 *  at the whole opposing board so a victim OUTSIDE the single-cell firing footprint carries the
 *  instance's share and nothing else. */
const kit = (firingHits: number): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [damageAbility(FIRING_PCT, 'enemy', firingHits)] },
        { slot: 'passive', abilities: [damageAbility(PASSIVE_PCT, 'all-enemies')] },
    ],
});

const ATTACK = 1000;
const FIRING_PCT = 100;
const PASSIVE_PCT = 50;
/** critDamage 100 → a critical hit is worth exactly 2×. */
const CRIT_MULT = 2;
/** The instance's non-critical magnitude: ONE hit at the passive's own multiplier. */
const PASSIVE_BASE = (ATTACK * PASSIVE_PCT) / 100; // 500

const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const singleCell = (): ParsedPattern => ({ raw: 'single', shape: 'base', range: 0, modifiers: {} });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
const enemyAt = (id: string, position: 'M4' | 'M3'): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position,
    shipSkills: { slots: [] },
});

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: ATTACK,
    crit: 50,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: kit(2),
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    healModifier: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    speed: 100,
    position: 'M4',
    target: frontTarget(),
    pattern: singleCell(),
    // `e-front` is the anchor (firing hit + instance); `e-mid` is outside the single-cell firing
    // footprint, so whatever it loses is the instance's share alone.
    enemyAttackers: [enemyAt('e-front', 'M4'), enemyAt('e-mid', 'M3')],
    ...overrides,
});

/**
 * Script the FOCUS's active-crit sub-stream so the per-hit outcomes are exact: a draw below the
 * rate (0.5 here) crits. Every other stream keeps a seeded provider, so nothing else is disturbed.
 */
const scriptFocusCrits = (draws: number[]): void => {
    const inner = makeKeyedRng(0x9d61a7);
    let i = 0;
    setKeyedRng((key) => {
        if (key !== 'attacker:active-crit') return inner(key);
        const draw = draws[Math.min(i, draws.length - 1)];
        i += 1;
        return draw;
    });
};

/** One positional run, returning the focus's own damage events plus the per-victim credit. */
const observe = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: AbilityPerformed[] = [];
    bus.on('ability-performed', (e: AbilityPerformed) => {
        if (e.actorId === 'attacker' && e.abilityType === 'damage') events.push(e);
    });
    const result = runCombat({ ...input, bus });
    return { events, dealt: result.rounds[0].perTargetDealt?.['attacker'] ?? {} };
};

describe('the passive-slot instance reports the same crit result to both channels', () => {
    afterEach(() => resetRateGateRng());

    it('a MULTI-HIT cast with mixed crits values the instance identically in log and apply', () => {
        scriptFocusCrits([0, 0.99]); // hit 1 crits, hit 2 does not
        const { events, dealt } = observe(BASE());

        // FIXTURE GUARD: the crits really are MIXED. With both hits the same the blend and the
        // boolean coincide and this case proves nothing.
        expect(events.map((e) => e.didCrit)).toEqual([true, false]);

        // The FIRING hit: two sub-attacks of 1000 each, the first doubled. The two channels already
        // agreed here — the blend IS the per-hit sum for the firing hit — so it is a fixed, known
        // quantity to read the instance's share against, not part of what is under test.
        const firing = ATTACK * (FIRING_PCT / 100) * CRIT_MULT + ATTACK * (FIRING_PCT / 100); // 3000
        // ONE instance, and the round's first firing hit crit → it crits, once.
        const instance = PASSIVE_BASE * CRIT_MULT; // 1000

        // APPLIED: what the enemies actually lost. `e-mid` is the instance alone.
        expect(dealt['e-mid']).toBe(instance);
        expect(dealt['e-front']).toBe(firing + instance);

        // AGGREGATE: the pre-funnel basis the log is built from, split across the sub-attacks.
        // Pre-fix this summed to 3750 — the instance blended at 1.5× — against an applied 4000.
        const logged = events.reduce((sum, e) => sum + (e.damage ?? 0), 0);
        expect(logged).toBe(firing + instance);
    });

    it('CONTROL: a SINGLE-HIT cast already agreed — the blend collapses to the boolean', () => {
        scriptFocusCrits([0]); // the lone hit crits
        const { events, dealt } = observe(BASE({ shipSkills: kit(1) }));

        expect(events.map((e) => e.didCrit)).toEqual([true]);
        const firing = ATTACK * (FIRING_PCT / 100) * CRIT_MULT; // 2000
        const instance = PASSIVE_BASE * CRIT_MULT; // 1000

        expect(dealt['e-mid']).toBe(instance);
        expect(dealt['e-front']).toBe(firing + instance);
        expect(events.reduce((sum, e) => sum + (e.damage ?? 0), 0)).toBe(firing + instance);
    });
});

// ── The empty-`hitCrits` half, at the seam where both channels are produced ──────────────────
// Driven through `runPlayerTurn` rather than `runCombat` because the positional path cannot reach
// this cast at all (known gap (b)): with no firing-slot damage ability there are no
// `positionalScalars`, so the engine never enters its positional branch and `PassiveSlotHit` is
// never consumed. The FIELD is still produced, and it is the field that was wrong.

/** A firing slot with no `damage` ability at all, plus the passive-slot instance. */
const noFiringDamageKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'pcp-charge',
                    type: 'charge',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'charge', amount: 1 },
                },
            ],
        },
        { slot: 'passive', abilities: [damageAbility(PASSIVE_PCT, 'all-enemies')] },
    ],
});

const UNIT_ATTACK = 10_000;

/** Minimal runtime with an ALWAYS-CRIT gate, so no RNG decides the outcome under test. */
const critRuntime = (skills: ShipSkills): PlayerActorRuntime => {
    const alwaysFire: PlayerActorRuntime['activeCritGate'] = () => true;
    const neverFire: PlayerActorRuntime['activeCritGate'] = () => false;
    return {
        actor: createActor({
            id: 'attacker',
            side: 'player',
            kind: 'attacker',
            stats: {
                attack: UNIT_ATTACK,
                crit: 100,
                critDamage: 100,
                defensePenetration: 0,
                shieldPenetration: 0,
                defence: 0,
                hp: 20_000,
                speed: 100,
            },
            chargeCount: 0,
            startCharged: false,
        }),
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: UNIT_ATTACK,
        crit: 100,
        critDamage: 100,
        defensePenetration: 0,
        defence: 0,
        hp: 20_000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        activeCritGate: alwaysFire,
        chargedCritGate: alwaysFire,
        activeHealCritGate: neverFire,
        chargedHealCritGate: neverFire,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
};

const unitArgs = (runtime: PlayerActorRuntime): PlayerTurnArgs => {
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);
    return {
        runtime,
        enemy: createActor({
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
        }),
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
    };
};

describe('a cast with no firing-slot damage ability still reports the instance honestly', () => {
    it('crits the aggregate and the positional field off the SAME draw', () => {
        const result = runPlayerTurn(unitArgs(critRuntime(noFiringDamageKit())));

        // FIXTURE GUARD: this is the empty-`hitCrits` shape. The loop still drew (the gate fired) —
        // the array is empty because nothing was pushed, not because nothing happened.
        expect(result.hitCrits).toEqual([]);

        const passiveBase = (UNIT_ATTACK * PASSIVE_PCT) / 100; // 5000
        // The whole cast is the instance: no firing damage ability, so `directDamage` IS it.
        // The aggregate crit off that draw (10000, not 5000) both before and after the fix …
        expect(result.directDamage).toBe(passiveBase * CRIT_MULT);
        // … while the field handed to the positional apply said no-crit. THE PARITY: whatever the
        // instance is worth in the aggregate, the field must claim the same outcome.
        expect(result.passiveSlotHit?.didCrit).toBe(true);
        expect(result.directDamage).toBe(
            passiveBase * (result.passiveSlotHit?.didCrit ? CRIT_MULT : 1)
        );
    });

    it('a `noCrit` passive stays non-critical in both channels', () => {
        // `noCrit` on the instance's OWN damage ability: the crit gate still fires for the firing
        // draw, and the instance must ignore it — the `? 1` the aggregate always had, and `false`
        // on the field. This is the case a "just use the draw" unification breaks.
        const skills: ShipSkills = {
            slots: [
                noFiringDamageKit().slots[0],
                {
                    slot: 'passive',
                    abilities: [
                        {
                            ...damageAbility(PASSIVE_PCT, 'all-enemies'),
                            config: {
                                type: 'damage',
                                multiplier: PASSIVE_PCT,
                                noCrit: true,
                            },
                        },
                    ],
                },
            ],
        };
        const result = runPlayerTurn(unitArgs(critRuntime(skills)));

        const passiveBase = (UNIT_ATTACK * PASSIVE_PCT) / 100;
        expect(result.passiveSlotHit?.didCrit).toBe(false);
        expect(result.directDamage).toBe(passiveBase);
    });
});
