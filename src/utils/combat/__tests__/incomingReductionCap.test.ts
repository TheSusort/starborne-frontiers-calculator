/**
 * The non-defence incoming factor of a direct hit is floored at a 70% reduction (#658, #672):
 * (1 + buff channel) × (1 − Σ ship passives) × Π(1 − each gear/implant/leader reduction), the
 * whole product floored at 0.30 (`composeIncomingFactor`). The attacker's squad-leader crit
 * penalty multiplies outside the floor.
 *
 * Covered here: the helper, the positional path (`victimHitDamageParts`), the aggregate path
 * (`runPlayerTurn`), both victim sides end to end, and the exclusions (defence, `preMitigation`,
 * DoT ticks).
 */
import { describe, expect, it } from 'vitest';
import {
    NON_DEFENCE_REDUCTION_CAP_PCT,
    capIncomingPct,
    composeIncomingFactor,
    victimHitDamageParts,
    AttackerDamageScalars,
    VictimDefenseProfile,
    type IncomingReductionParts,
} from '../victimDamage';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

// ── Helper ──────────────────────────────────────────────────────────────────────────────

describe('capIncomingPct', () => {
    it('floors at -70 and leaves everything above it alone', () => {
        expect(NON_DEFENCE_REDUCTION_CAP_PCT).toBe(70);
        expect(capIncomingPct(-80)).toBe(-70);
        expect(capIncomingPct(-70)).toBe(-70);
        expect(capIncomingPct(-69)).toBe(-69);
        expect(capIncomingPct(0)).toBe(0);
        expect(capIncomingPct(40)).toBe(40);
    });
});

const parts = (passivePct: number, separatePcts: number[] = []): IncomingReductionParts => ({
    passivePct,
    separatePcts,
});

// ── Positional path: victimHitDamageParts ───────────────────────────────────────────────

const scalars = (over: Partial<AttackerDamageScalars> = {}): AttackerDamageScalars => ({
    effectiveAttack: 10000,
    multiplierPct: 100,
    secondaryStatValue: 0,
    hits: 1,
    effectiveCritDamage: 100,
    outgoingDamageBuffPct: 0,
    incomingDamageModifierPct: 0,
    defensePenetrationPct: 0,
    attackerAffinity: 'antimatter',
    ...over,
});
const victim = (over: Partial<VictimDefenseProfile> = {}): VictimDefenseProfile => ({
    defence: 0,
    defenceModifierPct: 0,
    affinity: 'antimatter',
    ...over,
});

describe('victimHitDamageParts: the non-defence incoming factor is floored at 0.30', () => {
    it('-60 Inc. Damage Down × passive 40 (0.24) lands at 0.30', () => {
        const { damage } = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -60, victimSideIncomingPct: -60 }),
            false,
            1,
            parts(40)
        );
        expect(damage).toBeCloseTo(3000, 8);
    });

    it('-60 Inc. Damage Down × separate gear 20 is 0.32, above the floor', () => {
        const { damage } = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -60, victimSideIncomingPct: -60 }),
            false,
            1,
            parts(0, [20])
        );
        expect(damage).toBeCloseTo(3200, 8);
    });

    it('-69 is unchanged', () => {
        const { damage } = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -69, victimSideIncomingPct: -69 }),
            false,
            1
        );
        expect(damage).toBeCloseTo(3100, 8);
    });

    it('-60 Inc. Damage Down with +25 Exposed (-35) × passive 40 is 0.39, above the floor', () => {
        const { damage } = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -60 + 25, victimSideIncomingPct: -60 }),
            false,
            1,
            parts(40)
        );
        expect(damage).toBeCloseTo(3900, 8);
    });

    it('a floored victim still takes a smaller crit from an attacker with a leader crit penalty', () => {
        // The attacker's crit penalty multiplies OUTSIDE the floor.
        const v = victim({ incomingDamageModifierPct: -70, victimSideIncomingPct: -70 });
        const without = victimHitDamageParts(scalars(), v, true, 1, undefined, 0).damage;
        const withPenalty = victimHitDamageParts(scalars(), v, true, 1, undefined, 10).damage;
        expect(without).toBeCloseTo(6000, 8); // 10000 * (1 + 100/100) * 0.30
        expect(withPenalty).toBeCloseTo(without * 0.9, 8);
    });

    it('crit-conditional gear that pushes a crit past the floor is capped too', () => {
        // buff 0.40 × separate 40 (0.60) = 0.24 → 0.30
        const v = victim({ incomingDamageModifierPct: -60, victimSideIncomingPct: -60 });
        const { damage } = victimHitDamageParts(scalars(), v, true, 1, parts(0, [40]));
        expect(damage).toBeCloseTo(6000, 8);
    });

    it('above the floor the damage is bit-identical to the composed expression', () => {
        const { damage } = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -33.3 }),
            true,
            1,
            parts(12.7),
            4.1
        );
        const incoming = composeIncomingFactor(-33.3, parts(12.7));
        expect(damage).toBe(10000 * 2 * (1 * (1 + 0 / 100) * incoming * (1 - 4.1 / 100) * 1) * 1);
    });

    it('preMitigation never reads the cap: it strips only the victim-side slice', () => {
        // Channel -80 is all victim-side, so as-thrown is the bare attack.
        const { preMitigation } = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -80, victimSideIncomingPct: -80 }),
            false,
            1
        );
        expect(preMitigation).toBeCloseTo(10000, 8);
    });

    it('preMitigation keeps attacker-applied amplification and the attacker crit penalty uncapped', () => {
        // Channel: -90 victim-side + 25 Exposed = -65 net; as thrown = ×1.25, times the
        // attacker's own 10 penalty (×0.90).
        const { preMitigation } = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -65, victimSideIncomingPct: -90 }),
            true,
            1,
            undefined,
            10
        );
        expect(preMitigation).toBeCloseTo(10000 * 2 * 1.25 * 0.9, 8);
    });

    it('defence mitigation is not part of the sum and stays uncapped', () => {
        // Defence 100000 -> a large calculateDamageReduction; the incoming term is -80 -> 0.30.
        const heavy = victimHitDamageParts(
            scalars(),
            victim({ defence: 100000, incomingDamageModifierPct: -80, victimSideIncomingPct: -80 }),
            false,
            1
        ).damage;
        const bare = victimHitDamageParts(scalars(), victim({ defence: 100000 }), false, 1).damage;
        expect(heavy / bare).toBeCloseTo(0.3, 10);
    });
});

// ── Aggregate path: runPlayerTurn ───────────────────────────────────────────────────────

const STATUS_BUFF = 'enemy-damage-taken';
const statusBuff = (pct: number): SelectedGameBuff => ({
    id: 'enemy-damage-taken-1',
    buffName: STATUS_BUFF,
    stacks: 1,
    isStackable: false,
    application: 'apply',
    skillSource: 'passive1',
    parsedEffects: { incomingDamage: pct },
});

function makeRuntime(crit: boolean, buffs: SelectedGameBuff[]): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 10000,
            crit: crit ? 100 : 0,
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
    const gate: PlayerActorRuntime['activeCritGate'] = () => crit;
    const never: PlayerActorRuntime['activeCritGate'] = () => false;
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
        crit: crit ? 100 : 0,
        critDamage: 100,
        defensePenetration: 0,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        activeCritGate: gate,
        chargedCritGate: gate,
        activeHealCritGate: never,
        chargedHealCritGate: never,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        scheduledSelfBuffsBySource: new Map(),
        enemyDebuffLookup: buffs.length ? new Map([[STATUS_BUFF, buffs]]) : new Map(),
    };
}

function aggregate(crit: boolean, statusPct: number, extra: Partial<PlayerTurnArgs> = {}): number {
    const buffs = statusPct === 0 ? [] : [statusBuff(statusPct)];
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
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: buffs });
    statusEngine.beginRound(1);
    return runPlayerTurn({
        runtime: makeRuntime(crit, buffs),
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
    }).directDamage;
}

// attack 10000 x 3 hits = 30000 pre-crit; critDamage 100 doubles a crit.
describe('runPlayerTurn aggregate path: the non-defence incoming factor is floored at 0.30', () => {
    it('non-crit: -60 status × passive 40 (0.24) lands at 0.30', () => {
        expect(aggregate(false, -60, { incomingReductionNonCrit: parts(40) })).toBeCloseTo(9000, 6);
    });

    it('non-crit: -60 status × passive 22.5 (0.31) is unchanged', () => {
        expect(aggregate(false, -60, { incomingReductionNonCrit: parts(22.5) })).toBeCloseTo(
            9300,
            6
        );
    });

    it('non-crit: -35 status × separate gear 20 is 0.52', () => {
        expect(aggregate(false, -35, { incomingReductionNonCrit: parts(0, [20]) })).toBeCloseTo(
            15600,
            6
        );
    });

    it('crit: the crit fraction is floored independently of the non-crit base', () => {
        // Non-crit 0.40 (above the floor); crit 0.40 × passive 40 = 0.24 floors to 0.30. The crit
        // hit lands at 30000 * 2 * 0.30.
        expect(aggregate(true, -60, { incomingReductionCrit: parts(40) })).toBeCloseTo(18000, 6);
    });

    it('crit: a base already below the floor and a crit-conditional term add nothing past it', () => {
        // Non-crit 0.20 floors to 0.30; crit 0.20 × 0.90 floors to 0.30; ratio is exactly 1.
        expect(aggregate(true, -80, { incomingReductionCrit: parts(0, [10]) })).toBeCloseTo(
            18000,
            6
        );
    });

    it('crit: a victim at -70 takes the same crit with or without crit-conditional gear', () => {
        const without = aggregate(true, -70);
        const withGear = aggregate(true, -70, { incomingReductionCrit: parts(0, [35]) });
        expect(withGear).toBeCloseTo(without, 6);
    });

    it('crit: the attacker leader crit penalty multiplies outside the floor', () => {
        const without = aggregate(true, -70);
        const withPenalty = aggregate(true, -70, { attackerCritPenaltyPct: 10 });
        expect(withPenalty).toBeCloseTo(without * 0.9, 6);
    });

    it('crit: -50 base × crit passive 38 (0.31) is unchanged', () => {
        expect(aggregate(true, -50, { incomingReductionCrit: parts(38) })).toBeCloseTo(18600, 6);
    });
});

// ── Engine, both victim sides ───────────────────────────────────────────────────────────

type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** A ship-kit (passive bucket) incoming reduction on every direct hit. */
const gearReduction = (pct: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: `gear-reduction-${pct}`,
            type: 'incoming-reduction',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'incoming-reduction',
                scope: 'direct',
                condition: 'always',
                pct,
                critFamily: false,
            },
        },
    ],
});

const incDamageDownSelfBuff = (id: string, pct: number): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Inc. Damage Down II',
        parsedEffects: { incomingDamage: pct },
        stacks: 1,
        isStackable: false,
        duration: 2,
    },
});

const hit = (id: string, multiplier: number): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** A victim's skill slots: an optional own Inc. Damage Down on its turn, an optional gear passive. */
const victimSlots = (id: string, kit: { status?: number; gear?: number }): ShipSkills['slots'] => [
    {
        slot: 'active',
        abilities: [
            ...(kit.status !== undefined ? [incDamageDownSelfBuff(`${id}-idd`, kit.status)] : []),
            hit(`${id}-noop`, 0),
        ],
    },
    ...(kit.gear !== undefined ? [gearReduction(kit.gear)] : []),
];

const BASE = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    ...over,
});

const destroyed = (input: CombatEngineInput, id: string): boolean => {
    const bus = createEventBus();
    let dead = false;
    bus.on('ship-destroyed', (e) => {
        if (e.actorId === id) dead = true;
    });
    runCombat({ ...input, bus });
    return dead;
};

/** Pin the landed hit to [expected - 0.1, expected + 0.1): dies just below it, survives just above. */
const expectLanded = (build: (hp: number) => CombatEngineInput, id: string, expected: number) => {
    expect(destroyed(build(expected - 0.1), id)).toBe(true);
    expect(destroyed(build(expected + 0.1), id)).toBe(false);
};

const PLAYER_VICTIM_ATTACKER = (position: Position): EnemyAttacker => ({
    id: 'enemy-1',
    stats: { attack: 5000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [hit('enemy-1-hit', 100)] }] },
});

const playerVictim = (hp: number, kit: { status?: number; gear?: number }): TeamActor => ({
    id: 'victim',
    speed: 1000, // acts before the enemy so its own Inc. Damage Down is up
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M4',
    walk: {
        shipSkills: { slots: victimSlots('victim', kit) },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp,
        },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const enemyVictim = (hp: number, kit: { status?: number; gear?: number }): EnemyAttacker => ({
    id: 'enemy-victim',
    stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp, speed: 2000 },
    chargeCount: 0,
    startCharged: false,
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: victimSlots('enemy-victim', kit) },
});

const playerAttacker = (): Partial<CombatEngineInput> => ({
    attack: 5000,
    shipSkills: { slots: [{ slot: 'active', abilities: [hit('focus-hit', 100)] }] },
    speed: 1000,
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
});

describe('positional path end to end: both victim sides compose and land at the floor', () => {
    const playerSide = (kit: { status?: number; gear?: number }) => (hp: number) =>
        BASE({
            teamActors: [playerVictim(hp, kit)],
            enemyAttackers: [PLAYER_VICTIM_ATTACKER('M1')],
        });
    const enemySide = (kit: { status?: number; gear?: number }) => (hp: number) =>
        BASE({ ...playerAttacker(), enemyAttackers: [enemyVictim(hp, kit)] });

    it('player victim: -80 gear lands 5000 at 0.30', () => {
        expectLanded(playerSide({ gear: 80 }), 'victim', 1500);
    });
    it('player victim: -60 Inc. Damage Down × passive 40 (0.24) lands at 0.30', () => {
        expectLanded(playerSide({ status: -60, gear: 40 }), 'victim', 1500);
    });
    it('player victim: -60 Inc. Damage Down × passive 20 is 0.32', () => {
        expectLanded(playerSide({ status: -60, gear: 20 }), 'victim', 1600);
    });
    it('player victim: -69 is unchanged (0.31)', () => {
        expectLanded(playerSide({ gear: 69 }), 'victim', 1550);
    });
    it('enemy victim: -80 gear lands 5000 at 0.30', () => {
        expectLanded(enemySide({ gear: 80 }), 'enemy-victim', 1500);
    });
    it('enemy victim: -60 Inc. Damage Down × passive 40 (0.24) lands at 0.30', () => {
        expectLanded(enemySide({ status: -60, gear: 40 }), 'enemy-victim', 1500);
    });
    it('enemy victim: -60 Inc. Damage Down × passive 20 is 0.32', () => {
        expectLanded(enemySide({ status: -60, gear: 20 }), 'enemy-victim', 1600);
    });
    it('enemy victim: -69 is unchanged (0.31)', () => {
        expectLanded(enemySide({ gear: 69 }), 'enemy-victim', 1550);
    });
});

// ── DoT ticks are outside the cap ───────────────────────────────────────────────────────

describe('DoT ticks are not capped', () => {
    const dotReduction = (id: string, pct: number): Ability => ({
        id,
        type: 'incoming-reduction',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'incoming-reduction',
            scope: 'dot',
            condition: 'dot-inferno-corrosion',
            pct,
            critFamily: false,
        },
    });

    const infernoEnemy = (): EnemyAttacker => ({
        id: 'inferno-enemy',
        stats: { attack: 5000, crit: 0, critDamage: 0, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'inferno-dot',
                            type: 'dot',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 100,
                                stacks: 1,
                                duration: 1,
                            },
                        },
                    ],
                },
            ],
        },
    });

    it('two 40% DoT reductions (80% combined) take a 5000 inferno tick to 1000, not 1500', () => {
        const bus = createEventBus();
        const ticks: number[] = [];
        bus.on('dot-ticked', (e) => {
            const ev = e as { round: number; dotType: string; damage: number };
            if (ev.round >= 2 && ev.dotType === 'inferno') ticks.push(ev.damage);
        });
        runCombat({
            ...BASE({
                numRounds: 2,
                hp: 1_000_000,
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [hit('noop', 0)] },
                        {
                            slot: 'passive',
                            abilities: [dotReduction('dot-a', 40), dotReduction('dot-b', 40)],
                        },
                    ],
                },
                enemyAttackers: [infernoEnemy()],
            }),
            bus,
        });
        expect(ticks.length).toBeGreaterThanOrEqual(1);
        expect(ticks[0]).toBeCloseTo(1000, 6);
    });
});
