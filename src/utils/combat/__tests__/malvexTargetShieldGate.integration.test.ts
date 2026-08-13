/**
 * `enemy-shield` — "If the target has a Shield, it gains Barrier for 1 hit" (Malvex, charged).
 *
 * The ONLY test that can prove the whole five-layer wiring of a new ConditionSubject is complete,
 * because it drives the real engine end to end: the parser's condition survives
 * `liveGateConditions` (LIVE_SUBJECTS), reaches `conditionsMet` against a round context that
 * playerTurn.ts actually populated from the resolved victim's live `shieldPool`, and decides
 * whether the Barrier — full damage immunity — lands at all. Remove the `'enemy-shield'` entry from
 * LIVE_SUBJECTS and the first case below fails: the gate neutralizes to 'always' and the Barrier
 * blocks the incoming hit that should have landed in full.
 *
 * Fixtures are POSITIONAL (position + parsed target + a real enemy attacker). The legacy
 * non-positional path folds a multi-hit attack into one damage multiplier and never resolves a
 * positioned victim, so neither the gate's input (`enemy.shieldPool`) nor its observable effect
 * (a per-hit Barrier absorb) exists there. Harness (`BASE_PLAYER_SIDE`, `collectFor`,
 * `simHpLossFor`, `barrierAbsorbedFor`) is modelled on hitCountedBarrier.integration.test.ts, the
 * sibling suite for the same grant's hit-counted lifecycle.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { Ship } from '../../../types/ship';
import type { CombatActor } from '../state';

const DIRECT_HIT = 5000; // attack 5000 × 100% × 1 hit vs defence 0.
const HP = 10_000_000; // large enough nothing ever dies.
const TARGET_SHIELD = 1000; // any positive pool — the gate is a boolean, not a threshold.

/** Malvex's charged Barrier as the parser now builds it: a hit-counted self-buff gated on the
 *  resolved target carrying a shield. `hits` (no duration) is what routes it into the per-slot
 *  timed-self store `postDebuffGateCtx` gates — an aura would be re-evaluated per round instead. */
const gatedBarrier = (): Ability => ({
    id: 'barrier-target-shield',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [{ subject: 'enemy-shield', derivable: true }],
    config: {
        type: 'buff',
        buffName: 'Barrier',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        hits: 1,
    },
});

const noopDamage = (): Ability => ({
    id: 'noop-dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

const basicAttack = (): Ability => ({
    id: 'basic',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 1 },
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const enemyActor = (
    id: string,
    position: Position,
    abilities: Ability[],
    speed: number,
    attack = DIRECT_HIT
): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: HP, speed },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities }] } as ShipSkills,
    }) as EnemyAttacker;

/** The focus player actor is the Barrier holder: fast (so the grant resolves before any hit lands),
 *  positioned, and aimed at the single enemy — whose `shieldPool` is what the gate reads. */
const BASE_PLAYER_SIDE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    speed: 1000,
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [gatedBarrier(), noopDamage()] }] },
    enemyDefense: 0,
    enemyHp: HP,
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
    hp: HP,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

function collectFor(input: CombatEngineInput) {
    const bus = createEventBus();
    const applied: { actorId: string; buffName: string }[] = [];
    bus.on('buff-applied', (e) => applied.push({ actorId: e.actorId, buffName: e.buffName }));
    const result = runCombat({ ...input, bus });
    return { applied, result };
}

/** battleSimulator's `incomingHpThisRound` derivation, verbatim, for one round/target. */
function simHpLossFor(
    result: ReturnType<typeof runCombat>,
    round: number,
    targetId: string
): number {
    const entry = result.rounds.find((r) => r.round === round)!;
    const taken = entry.perTargetDamage?.[targetId] ?? 0;
    const inc = entry.perActorIncoming?.[targetId];
    return inc ? Math.max(0, inc.incoming - inc.shieldAbsorbed - inc.barrierAbsorbed) : taken;
}

function barrierAbsorbedFor(
    result: ReturnType<typeof runCombat>,
    round: number,
    targetId: string
): number {
    const entry = result.rounds.find((r) => r.round === round)!;
    return entry.perActorIncoming?.[targetId]?.barrierAbsorbed ?? 0;
}

/** Seeds a shield pool on one actor before round 1 — the gate's sole input. */
const seedShield = (actorId: string, pool: number) => (actors: CombatActor[]) => {
    const a = actors.find((x) => x.id === actorId);
    if (a) a.shieldPool = pool;
};

describe('enemy-shield gate — player-side holder (Malvex shape)', () => {
    it('does NOT grant Barrier when the target has no shield: the incoming hit lands in full', () => {
        // The mutation canary for the whole five-layer sweep. With 'enemy-shield' missing from
        // LIVE_SUBJECTS the condition is rewritten to 'always', the Barrier lands anyway, and both
        // amounts below invert (barrierAbsorbed DIRECT_HIT / hp loss 0).
        const input = BASE_PLAYER_SIDE({
            enemyAttackers: [enemyActor('enemy-1', 'M1', [basicAttack()], 1)],
        });
        const { applied, result } = collectFor(input);

        expect(applied).not.toContainEqual({ actorId: 'attacker', buffName: 'Barrier' });
        expect(barrierAbsorbedFor(result, 1, 'attacker')).toBe(0);
        expect(simHpLossFor(result, 1, 'attacker')).toBeCloseTo(DIRECT_HIT, 6);
    });

    it('DOES grant Barrier when the target has a shield: the incoming hit is nullified', () => {
        // Same fixture, one difference — the resolved victim carries a shield pool, which is
        // exactly what playerTurn.ts reads into postDebuffGateCtx.enemyShielded.
        const input = BASE_PLAYER_SIDE({
            enemyAttackers: [enemyActor('enemy-1', 'M1', [basicAttack()], 1)],
            __testTapActors: seedShield('enemy-1', TARGET_SHIELD),
        });
        const { applied, result } = collectFor(input);

        expect(applied).toContainEqual({ actorId: 'attacker', buffName: 'Barrier' });
        expect(barrierAbsorbedFor(result, 1, 'attacker')).toBeCloseTo(DIRECT_HIT, 6);
        expect(simHpLossFor(result, 1, 'attacker')).toBe(0);
    });
});

describe('enemy-shield gate — Malvex ACTIVE self-shield, built from the real skill row', () => {
    // The charged-slot cases above drive a HAND-BUILT ability, so they prove the engine honours an
    // `enemy-shield` condition but say nothing about whether the parser attaches one. These two
    // drive the verbatim docs/ship-skills.csv active row through buildShipAbilities into the engine
    // — the only shape that fails when the heal/shield builder drops the gate on the floor.
    const MALVEX_ACTIVE =
        'This Unit deals <unit-damage>100% damage</unit-damage> with an additional damage equal to ' +
        '<unit-damage>5%</unit-damage> of its current Shield. If the target has a Shield this Unit ' +
        'gains <unit-damage>Shield equal to 15%</unit-damage> of its Max HP.';

    const MALVEX_SKILLS: ShipSkills = buildShipAbilities({
        refits: [],
        activeSkillText: MALVEX_ACTIVE,
    } as unknown as Ship);

    /** Total pool granted to `actorId` across the run, from the engine's own shield-applied event. */
    function shieldGrantedTo(input: CombatEngineInput, actorId: string): number {
        const bus = createEventBus();
        let granted = 0;
        bus.on('shield-applied', (e) => {
            if (e.recipientIds.includes(actorId)) granted += e.amount;
        });
        runCombat({ ...input, bus });
        return granted;
    }

    // 15% of the caster's max HP. HP is the engine input `hp`, so keep it small enough to read.
    const MALVEX_HP = 100_000;
    const EXPECTED_POOL = MALVEX_HP * 0.15;

    const malvexInput = (overrides: Partial<CombatEngineInput>): CombatEngineInput =>
        BASE_PLAYER_SIDE({
            attack: 1000,
            hp: MALVEX_HP,
            shipSkills: MALVEX_SKILLS,
            enemyHp: HP,
            enemyAttackers: [enemyActor('enemy-1', 'M1', [], 1, 0)],
            ...overrides,
        });

    it('banks NO shield when the target it hits has no shield', () => {
        expect(shieldGrantedTo(malvexInput({}), 'attacker')).toBe(0);
    });

    it('banks 15% of its max HP when the target it hits has a shield', () => {
        const granted = shieldGrantedTo(
            malvexInput({ __testTapActors: seedShield('enemy-1', TARGET_SHIELD) }),
            'attacker'
        );
        expect(granted).toBeCloseTo(EXPECTED_POOL, 6);
    });
});

describe('enemy-shield gate — team symmetry (enemy-side holder)', () => {
    // The gate lives in runPlayerTurn, which both sides walk, and reads `enemy` = the turn's
    // resolved victim — so an enemy-side Malvex must gate identically. No amount is compared
    // ACROSS sides (the rate RNG is keyed by ownerId); each side is checked against its own
    // DIRECT_HIT. Roles are swapped: the enemy holds the gated Barrier and the player focus is the
    // attacker, so the shield the gate reads is seeded on the PLAYER actor.
    const enemySideInput = (overrides: Partial<CombatEngineInput>): CombatEngineInput =>
        BASE_PLAYER_SIDE({
            attack: DIRECT_HIT, // the player focus deals the hits
            speed: 1, // ...and acts after the holder, so the Barrier is up when they land
            shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
            enemyAttackers: [enemyActor('holder', 'M1', [gatedBarrier(), noopDamage()], 1000, 0)],
            ...overrides,
        });

    it("does NOT grant Barrier when the enemy holder's target has no shield", () => {
        const { applied, result } = collectFor(enemySideInput({}));

        expect(applied).not.toContainEqual({ actorId: 'holder', buffName: 'Barrier' });
        expect(barrierAbsorbedFor(result, 1, 'holder')).toBe(0);
        expect(simHpLossFor(result, 1, 'holder')).toBeCloseTo(DIRECT_HIT, 6);
    });

    it("DOES grant Barrier when the enemy holder's target has a shield", () => {
        const { applied, result } = collectFor(
            enemySideInput({ __testTapActors: seedShield('attacker', TARGET_SHIELD) })
        );

        expect(applied).toContainEqual({ actorId: 'holder', buffName: 'Barrier' });
        expect(barrierAbsorbedFor(result, 1, 'holder')).toBeCloseTo(DIRECT_HIT, 6);
        expect(simHpLossFor(result, 1, 'holder')).toBe(0);
    });
});
