/**
 * SP-4d Task 9 — closes the last no-victim phantom-zero gap: `enemy-debuff`, `enemy-dot-count`,
 * and `enemy-shield` all used to answer a fabricated value (0/false) when a cast resolved no
 * opposing victim (an ally-targeted repair), which an `eq`/`lte` gate can be satisfied by even
 * though the question ("does the enemy have N debuffs/DoTs/a shield?") has no subject to ask it
 * about. `enemyDebuffEqLteReachability.test.ts` pins that the parser really does emit `eq`/`lte`
 * on these subjects from real skill text, so this is not a theoretical gap.
 *
 * Every subject gets TWO halves:
 *   - NEGATIVE (no victim): the `noVictimAbsentSubject.integration.test.ts` harness shape — a
 *     Hermes-shaped repair (heals the hurt ally) with a self-shield gated on `eq 0`. Before this
 *     fix the gate read a fabricated 0 and fired against nobody; after, it must not fire, and the
 *     repair itself must still land (proof this isn't blanket-suppressing the turn).
 *   - POSITIVE (resolvable): the SAME subject, on a turn that DOES resolve a real victim, must
 *     still answer honestly — a real "0" (nothing landed yet) satisfies the gate, and a real
 *     nonzero value stops satisfying it. This is what proves the fix is a precise no-victim
 *     distinction, not "always unresolvable now" — a test that only blocks everything proves
 *     nothing about correctness.
 *
 * A side-wide non-regression case (constraint 4) proves `enemy-buff` keeps answering on a
 * no-victim turn — it must NOT read through the same no-opposing-victim gate, because a real
 * enemy roster always exists even when a specific cast resolves no single victim.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareInput, bareAlly, bareEnemy, BARE_ALLY_ID } from '../__testutils__/bareRosterFixture';
import type { Ability, Condition, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

const HURT_PCT = 0.4;

// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE half: no-victim harness, mirrors noVictimAbsentSubject.integration.test.ts's shape.
// ─────────────────────────────────────────────────────────────────────────────

/** A Hermes-shaped repair, plus one self-shield carrying the gate under test. */
const repairKitWithGatedShield = (gate: Condition): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'repair1',
                    type: 'heal',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 27, basis: 'hp' },
                },
                {
                    id: 'gatedShield',
                    type: 'shield',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [gate],
                    config: { type: 'shield', pct: 50, basis: 'hp' },
                },
            ],
        },
    ],
});

const noVictimRun = (gate: Condition) => {
    const bus = createEventBus();
    const shieldsOnFocus: number[] = [];
    const allyRepairs: number[] = [];
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        const forFocus = e.perTarget?.find((t) => t.targetId === 'attacker');
        if (forFocus && forFocus.amount > 0) shieldsOnFocus.push(forFocus.amount);
    });
    bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
        const forAlly = e.perTarget?.find((t) => t.targetId === BARE_ALLY_ID);
        if (forAlly && forAlly.amount > 0) allyRepairs.push(forAlly.amount);
    });
    runCombat({
        ...bareInput(),
        mode: 'battle',
        position: 'M4',
        target: { raw: 'ally-team', side: 'ally', selection: 'team' },
        pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
        shipSkills: repairKitWithGatedShield(gate),
        teamActors: [bareAlly()],
        enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
        bus,
        __testTapActors: (actors) => {
            const ally = actors.find((a) => a.id === BARE_ALLY_ID);
            if (ally) ally.currentHp = ally.stats.hp * HURT_PCT;
        },
    });
    return { shieldsOnFocus, allyRepairs };
};

// ─────────────────────────────────────────────────────────────────────────────
// POSITIVE half (enemy-debuff / enemy-dot-count): a real single-enemy target, 2 rounds, modelled
// on enemyDebuffNameSpecificGate.integration.test.ts. Round 1 has no pre-existing debuff/DoT on
// the resolved victim (a REAL 0) → the eq-0 gate fires; round 1's own infliction is live by round
// 2 (a REAL nonzero) → the same gate no longer fires.
// ─────────────────────────────────────────────────────────────────────────────

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `nvc${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const passiveEnemyAt = (position: Position): EnemyAttacker => ({
    id: 'enemy-front',
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 1,
        security: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const healingEngineBase = (shipSkills: ShipSkills): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills,
    numRounds: 2,
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
    // hacking 200 vs enemy security 0 → inflict landing chance clamp((200-0)/100) = 1.0.
    hacking: 200,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: [passiveEnemyAt('M4')],
});

/** Runs a 2-round positional cast and returns, per round, whether the gated self-shield fired. */
function shieldFiredPerRound(shipSkills: ShipSkills): boolean[] {
    const fired: boolean[] = [false, false];
    const bus = createEventBus();
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        const forFocus = e.perTarget?.find((t) => t.targetId === 'attacker');
        if (forFocus && forFocus.amount > 0) fired[e.round - 1] = true;
    });
    runCombat({ ...healingEngineBase(shipSkills), bus });
    return fired;
}

const eqZeroShield = (gate: Condition): Ability =>
    ab({
        id: 'gatedShield',
        target: 'self',
        type: 'shield',
        conditions: [gate],
        config: { type: 'shield', pct: 50, basis: 'hp' },
    });

// ─────────────────────────────────────────────────────────────────────────────
// POSITIVE half (enemy-shield): Malvex-shaped — the resolved victim's shieldPool, seeded before
// round 1 via __testTapActors, is the gate's sole input. Modelled on
// malvexTargetShieldGate.integration.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

const DIRECT_HIT = 5000;
const SHIELD_HP = 10_000_000;
const TARGET_SHIELD = 1000;

const basicAttack = (): Ability => ({
    id: 'basic',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 1 },
});

const shieldGatedBuff = (gate: Condition): Ability => ({
    id: 'gated-buff',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [gate],
    config: {
        type: 'buff',
        buffName: 'TestBuff',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        hits: 1,
    },
});

const enemyActorAt = (id: string, position: Position, speed: number): EnemyAttacker => ({
    id,
    stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: SHIELD_HP, speed },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
});

const seedShield = (actorId: string, pool: number) => (actors: CombatActor[]) => {
    const a = actors.find((x) => x.id === actorId);
    if (a) a.shieldPool = pool;
};

function buffGrantedFor(gate: Condition, shieldPool: number): boolean {
    const bus = createEventBus();
    let granted = false;
    bus.on('buff-applied', (e) => {
        if (e.actorId === 'attacker' && e.buffName === 'TestBuff') granted = true;
    });
    runCombat({
        enemyAttackers: [enemyActorAt('enemy-1', 'M1', 1)],
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        speed: 1000,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [shieldGatedBuff(gate)] }] },
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
        hp: SHIELD_HP,
        healTargetId: 'attacker',
        mode: 'healing',
        __testTapActors: shieldPool > 0 ? seedShield('enemy-1', shieldPool) : undefined,
        bus,
    });
    return granted;
}

// Do NOT call resetRateGateRng() after setupKeyedTestRng() — reset un-seeds the test.
describe('SP-4d Task 9: enemy-debuff/enemy-dot-count/enemy-shield close on a no-victim turn', () => {
    beforeEach(() => setupKeyedTestRng(12345));

    describe('enemy-debuff', () => {
        const gate = (): Condition => ({
            subject: 'enemy-debuff',
            countComparator: 'eq',
            countThreshold: 0,
            derivable: true,
        });

        it('NEGATIVE: does not grant the shield on a no-victim turn (the repair still lands)', () => {
            setupKeyedTestRng(12345);
            const { shieldsOnFocus, allyRepairs } = noVictimRun(gate());
            expect(shieldsOnFocus).toEqual([]);
            expect(allyRepairs.length).toBeGreaterThan(0);
        });

        it('POSITIVE: fires against a real victim with 0 debuffs, stops once it carries one', () => {
            idc = 0;
            const skills: ShipSkills = {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                            ab({
                                type: 'debuff',
                                config: {
                                    type: 'debuff',
                                    buffName: 'Security Down',
                                    application: 'inflict',
                                    duration: 5,
                                    stacks: 1,
                                    isStackable: false,
                                    parsedEffects: {},
                                },
                            }),
                            eqZeroShield(gate()),
                        ],
                    },
                ],
            };
            const fired = shieldFiredPerRound(skills);
            // Round 1: the resolved victim carries a REAL 0 debuffs before this cast → eq 0 fires.
            expect(fired[0]).toBe(true);
            // Round 2: round 1's own infliction is now live on the victim (a REAL nonzero) → eq 0
            // no longer fires. This is what proves round 1's `true` was a real 0, not the phantom.
            expect(fired[1]).toBe(false);
        });
    });

    describe('enemy-dot-count', () => {
        const gate = (): Condition => ({
            subject: 'enemy-dot-count',
            countComparator: 'eq',
            countThreshold: 0,
            derivable: true,
        });

        it('NEGATIVE: does not grant the shield on a no-victim turn (the repair still lands)', () => {
            setupKeyedTestRng(12345);
            const { shieldsOnFocus, allyRepairs } = noVictimRun(gate());
            expect(shieldsOnFocus).toEqual([]);
            expect(allyRepairs.length).toBeGreaterThan(0);
        });

        it('POSITIVE: fires against a real victim with 0 DoTs, stops once it carries one', () => {
            idc = 0;
            const skills: ShipSkills = {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                            ab({
                                type: 'dot',
                                config: {
                                    type: 'dot',
                                    dotType: 'corrosion',
                                    tier: 10,
                                    stacks: 1,
                                    duration: 5,
                                },
                            }),
                            eqZeroShield(gate()),
                        ],
                    },
                ],
            };
            const fired = shieldFiredPerRound(skills);
            // Round 1: the resolved victim carries a REAL 0 DoT entries before this cast → fires.
            expect(fired[0]).toBe(true);
            // Round 2: round 1's own Corrosion is now live (a REAL nonzero) → no longer fires.
            expect(fired[1]).toBe(false);
        });
    });

    describe('enemy-shield', () => {
        const gate = (): Condition => ({
            subject: 'enemy-shield',
            countComparator: 'eq',
            countThreshold: 0,
            derivable: true,
        });

        it('NEGATIVE: does not grant the shield on a no-victim turn (the repair still lands)', () => {
            setupKeyedTestRng(12345);
            const { shieldsOnFocus, allyRepairs } = noVictimRun(gate());
            expect(shieldsOnFocus).toEqual([]);
            expect(allyRepairs.length).toBeGreaterThan(0);
        });

        it('POSITIVE: fires against a real victim with no shield, stops once it has one', () => {
            expect(buffGrantedFor(gate(), 0)).toBe(true);
            expect(buffGrantedFor(gate(), TARGET_SHIELD)).toBe(false);
        });
    });

    describe('side-wide non-regression (constraint 4): enemy-buff keeps answering with no victim', () => {
        it("a no-victim turn's self-shield still gates correctly on the enemy roster's self-buff", () => {
            setupKeyedTestRng(12345);
            // The enemy attacker gets a PASSIVE self-buff, seeded at combat start by
            // seedPassiveTimedStatuses — live from round 1 regardless of whether any cast this
            // round resolves a victim. `enemy-buff` reads the UNION of enemy self-buffs
            // (enemyBuffNamesUnion in engine.ts), which is roster-wide, not per-victim — it must
            // keep answering even on the ally-repair (no-victim) turn under test.
            const enemyWithPassiveBuff = bareEnemy({
                stats: { hp: 10_000_000 },
                shipSkills: {
                    slots: [
                        {
                            slot: 'passive',
                            abilities: [
                                {
                                    id: 'seeded-buff',
                                    type: 'buff',
                                    target: 'self',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: {
                                        type: 'buff',
                                        buffName: 'Attack Up',
                                        parsedEffects: {},
                                        stacks: 1,
                                        isStackable: false,
                                        duration: 99,
                                    },
                                },
                            ],
                        },
                    ],
                },
            });
            const gate: Condition = {
                subject: 'enemy-buff',
                countComparator: 'gte',
                countThreshold: 1,
                derivable: true,
            };
            const bus = createEventBus();
            const shieldsOnFocus: number[] = [];
            bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
                const forFocus = e.perTarget?.find((t) => t.targetId === 'attacker');
                if (forFocus && forFocus.amount > 0) shieldsOnFocus.push(forFocus.amount);
            });
            runCombat({
                ...bareInput(),
                mode: 'battle',
                position: 'M4',
                target: { raw: 'ally-team', side: 'ally', selection: 'team' },
                pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
                shipSkills: repairKitWithGatedShield(gate),
                teamActors: [bareAlly()],
                enemyAttackers: enemyWithPassiveBuff,
                bus,
                __testTapActors: (actors) => {
                    const ally = actors.find((a) => a.id === BARE_ALLY_ID);
                    if (ally) ally.currentHp = ally.stats.hp * HURT_PCT;
                },
            });
            // The gate fires DESPITE no opposing victim resolving this turn — enemy-buff is
            // side-wide and does not read through the no-opposing-victim signal at all.
            expect(shieldsOnFocus.length).toBeGreaterThan(0);
        });
    });
});
