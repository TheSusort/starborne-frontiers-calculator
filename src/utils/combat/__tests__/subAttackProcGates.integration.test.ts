/**
 * Multi-hit full-walk attacks, PR4 — OUTGOING proc gates at sub-attack scope.
 *
 * A multi-hit skill is N consecutive full-walk attacks (locked game rule R1), and effects based on
 * OUTGOING hits resolve per attack — i.e. per sub-attack (R2). PR1 threaded a `subAttackIndex`
 * through every per-victim callback and PR2 made the engine emit one `ability-performed` per
 * sub-attack; PR4 makes the *gates* consume that identity.
 *
 * Task 1 pins a PR2 deliverable that nothing else covers. Enforcer's Defense Shred is a PASSIVE
 * `on-crit` reactive debuff, not a slot clause, so PR2's per-sub-attack emission is what gives her
 * N stacks — and Enforcer is `Pattern-Base`, so no fingerprint golden can see a regression here.
 * Measured against 7829f531: hits=1 → 1 application, hits=3 → 3.
 *
 * Fixtures are copied from `perSubAttackEvents.integration.test.ts` rather than imported: that
 * file exports nothing and PR2 deliberately kept its fixtures local.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setRateGateRng, setKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pg${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

/** An N-hit damage active. `hits` is omitted at N=1 so the fixture matches a normal ship. */
const attackSkill = (hits: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            config: { type: 'damage', multiplier: 100, ...(hits > 1 ? { hits } : {}) },
        }),
    ],
});

/** Enforcer's real shred shape: passive-slot `on-crit` debuff, inflict application. */
const onCritShred = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-crit',
            config: {
                type: 'debuff',
                buffName: 'Defense Shred',
                parsedEffects: { defense: -2 },
                stacks: 1,
                isStackable: true,
                maxStacks: 20,
                duration: 3,
                application: 'inflict',
            },
        }),
    ],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
/** Single-cell footprint: the anchor only. */
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
/** Whole-roster footprint: every occupied cell is struck by each sub-attack. */
const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

/** A positioned enemy that never fires back. */
const passiveEnemyAt = (id: string, position: Position) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        shipSkills: { slots: [] },
    }) as NonNullable<CombatEngineInput['enemyAttackers']>[number];

/**
 * The focus player at M1 fires `slots`. `crit: 100` with a neutral-affinity roster makes every
 * (sub-attack, victim) pair crit; `hacking` is high so debuff landing rolls never resist.
 */
const focusCast = (slots: ShipSkills['slots'], pattern: ParsedPattern): CombatEngineInput => ({
    attack: 5000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    affinity: 'antimatter',
    defence: 0,
    hp: 1_000_000_000,
    hacking: 100_000,
    healTargetId: 'attacker',
    position: 'M1',
    target: parsedTarget('front'),
    pattern,
    enemyAttackers: [passiveEnemyAt('anchor', 'M4'), passiveEnemyAt('covered', 'M3')],
});

/** Everything fires: crit gates, landing gates, proc gates. */
const alwaysFire = (): void => {
    setRateGateRng(() => 0);
    setKeyedRng(() => 0);
};

const countOf = (input: CombatEngineInput, type: CombatEvent['type']): number => {
    const bus = createEventBus();
    let n = 0;
    bus.on(type, () => {
        n++;
    });
    runCombat({ ...input, bus });
    return n;
};

describe('PR4 Task 1 — the on-crit reactive debuff path is already per-sub-attack (PR2)', () => {
    afterEach(() => resetRateGateRng());

    it.each([
        [1, 1],
        [3, 3],
    ])('hits=%i inflicts the debuff %i time(s)', (hits, expected) => {
        idc = 0;
        alwaysFire();
        expect(
            countOf(focusCast([attackSkill(hits), onCritShred()], basePattern()), 'debuff-applied')
        ).toBe(expected);
    });
});

/** Menace's shape: passive-slot outgoing-amplification, crit-conditional, 50% proc. */
const menacePassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'MENACE',
            type: 'outgoing-amplification',
            target: 'self',
            trigger: 'passive',
            conditions: [],
            config: {
                type: 'outgoing-amplification',
                condition: 'amplify-on-crit',
                ampPct: 50,
                procChance: 0.5,
            },
        } as unknown as Ability,
    ],
});

/**
 * Counts draws on the amplification proc's own RNG sub-stream. `rollRateGate` keys amp draws
 * `${actorId}:${abilityId}`, and `setKeyedRng` gives every key its own stream — so this counts
 * exactly the amplification rolls and nothing else.
 */
const ampDrawsFor = (input: CombatEngineInput): number => {
    let draws = 0;
    setRateGateRng(() => 0);
    setKeyedRng((key) => {
        if (key === 'attacker:MENACE') draws++;
        return 0;
    });
    runCombat({ ...input, bus: createEventBus() });
    return draws;
};

describe('PR4 Task 2 — the amplification proc rolls once per sub-attack', () => {
    afterEach(() => resetRateGateRng());

    // Pre-fix draw counts were `hits × (1 + victims)` — 2 / 6 / 3 / 9 — because runPlayerTurn's
    // per-hit loop drew once per hit AND the positional per-victim apply drew again per
    // (hit, victim), both against the same `procChanceGates` key (spec §4.3 + the §4.6
    // double-advance, confirmed by measurement). The correct count is `hits`, independent of
    // footprint size: an AoE footprint is ONE attack and shares one roll (R3), while each
    // multi-hit sub-attack draws its own (R1).
    it.each([
        ['base', 1, 1],
        ['base', 3, 3],
        ['all', 1, 1],
        ['all', 3, 3],
    ] as const)('%s pattern, hits=%i draws exactly %i time(s)', (shape, hits, expected) => {
        idc = 0;
        const pattern = shape === 'base' ? basePattern() : allPattern();
        expect(ampDrawsFor(focusCast([attackSkill(hits), menacePassive()], pattern))).toBe(
            expected
        );
    });

    /** Per-victim booked damage for one cast, under a caller-supplied MENACE draw sequence. */
    const perVictimDamage = (
        slots: ShipSkills['slots'],
        menaceDraw: (n: number) => number
    ): number[] => {
        let n = 0;
        setRateGateRng(() => 0);
        setKeyedRng((key) => (key === 'attacker:MENACE' ? menaceDraw(n++) : 0));
        const bus = createEventBus();
        const perVictim = new Map<string, number>();
        bus.on('attacked', (e) => {
            perVictim.set(e.targetId, (perVictim.get(e.targetId) ?? 0) + (e.damage ?? 0));
        });
        runCombat({ ...focusCast(slots, allPattern()), bus });
        return [...perVictim.values()];
    };

    it('every victim of one sub-attack shares that sub-attack’s single verdict', () => {
        idc = 0;
        // Fire draw #1 and fail every later one, then check BOTH victims came out amplified.
        //
        // The equality of the two victims alone would be a VACUOUS assertion: pre-fix, draw #1 was
        // runPlayerTurn's discarded aggregate roll, so both victims saw a FAILING draw and were
        // equal-but-unamplified. Comparing against a no-amplification baseline is what makes this
        // discriminate — post-fix the single fired verdict is the one both victims resolve off, so
        // both take strictly more than baseline.
        const baseline = perVictimDamage([attackSkill(1)], () => 0);
        idc = 0;
        const amplified = perVictimDamage([attackSkill(1), menacePassive()], (n) =>
            n === 0 ? 0 : 1
        );
        expect(baseline).toHaveLength(2);
        expect(amplified).toHaveLength(2);
        expect(baseline[0]).toBeGreaterThan(0);
        // Shared verdict: the two victims of the one sub-attack agree...
        expect(amplified[0]).toBeCloseTo(amplified[1], 6);
        // ...and they agree on the AMPLIFIED value, not on having both missed the proc.
        expect(amplified[0]).toBeGreaterThan(baseline[0]);
    });
});

/**
 * Insidiousness's shape: a `procScope:'per-attack'` reactive damage rider on on-crit.
 * `procChance` is optional here because the two gates it must clear are independent:
 *  - with NO procChance, `passesProcChanceGate` returns early and only the per-victim
 *    `reactionFiredThisAttack` suppression is in play;
 *  - with one, the verdict MEMO is consulted too.
 * Both were per-TURN before PR4 and both had to be re-keyed, so both are exercised below.
 */
const procScopedRider = (procChance?: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            trigger: 'on-crit',
            procScope: 'per-attack',
            ...(procChance !== undefined ? { procChance } : {}),
            config: { type: 'damage', multiplier: 40 },
        }),
    ],
});

describe('PR4 Task 3 — procScope:"per-attack" is per SUB-attack, not per turn', () => {
    afterEach(() => resetRateGateRng());

    // Pre-fix: 1 fire for hits=3. The verdict was memoized on `${owner}:${ability}` and cleared
    // only at actor turn-start, so "ThisAttack" was really a per-TURN cache and sub-attacks
    // #2..#N replayed #1's verdict (spec §4.4 — the misnomer IS the bug's hiding place).
    it.each([
        [1, 1],
        [3, 3],
    ])('hits=%i fires the rider %i time(s)', (hits, expected) => {
        idc = 0;
        alwaysFire();
        expect(
            countOf(
                focusCast([attackSkill(hits), procScopedRider()], basePattern()),
                'reactive-damage-performed'
            )
        ).toBe(expected);
    });

    it('within ONE sub-attack the verdict is still shared across victims', () => {
        idc = 0;
        alwaysFire();
        // The whole point of procScope: an AoE footprint is one attack, so its victims share one
        // roll and the rider hits once (R3). Re-keying by sub-attack must not break that — this is
        // the guard against "fixed" meaning "now fires per victim".
        expect(
            countOf(
                focusCast([attackSkill(1), procScopedRider()], allPattern()),
                'reactive-damage-performed'
            )
        ).toBe(1);
    });

    it('each sub-attack draws its OWN verdict — the memo is not replayed', () => {
        idc = 0;
        // This is the case that pins the verdict MEMO specifically (the test above pins the
        // per-victim suppression instead: with no procChance, passesProcChanceGate returns early
        // and never touches the memo).
        //
        // A 3-hit cast with a 50% rider under the draw sequence FAIL, FIRE, FIRE. Pre-PR4 the
        // verdict was memoized on `${owner}:${ability}` and cleared only at actor turn-start, so
        // sub-attack #1's FAIL was replayed for #2 and #3 → 0 fires. Keyed by sub-attack, each
        // draws its own → 2 fires. A count of 3 would mean the memo stopped memoizing at all.
        let n = 0;
        setRateGateRng(() => 0);
        setKeyedRng((key) => (key.startsWith('attacker:proc') ? (n++ === 0 ? 1 : 0) : 0));
        const bus = createEventBus();
        let fires = 0;
        bus.on('reactive-damage-performed', () => {
            fires++;
        });
        runCombat({
            ...focusCast([attackSkill(3), procScopedRider(0.5)], basePattern()),
            bus,
        });
        expect(n).toBe(3);
        expect(fires).toBe(2);
    });
});
