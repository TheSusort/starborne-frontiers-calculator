/**
 * The non-defence incoming term of a direct hit is floored at -70 (#658): the victim's `Inc.
 * Damage Down/Up` family, pre-fight incoming, gear/kit incoming-reduction (crit family on crits),
 * attacker-applied amplification (`Exposed`) and the attacker's squad-leader crit penalty sum
 * into ONE signed percentage applied once as `(1 + total/100)`.
 *
 * Covered here: the helper, the positional path (`victimHitDamageParts`), the aggregate path
 * (`runPlayerTurn`), both victim sides end to end, and the exclusions (defence, `preMitigation`,
 * DoT ticks).
 */
import { describe, expect, it } from 'vitest';
import {
    NON_DEFENCE_REDUCTION_CAP_PCT,
    capIncomingPct,
    victimHitDamageParts,
    AttackerDamageScalars,
    VictimDefenseProfile,
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

describe('victimHitDamageParts: the non-defence incoming term is floored at -70', () => {
    it('-60 Inc. Damage Down and -20 gear (-80) lands at 0.30', () => {
        const { damage } = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -60, victimSideIncomingPct: -60 }),
            false,
            1,
            20
        );
        expect(damage).toBeCloseTo(3000, 8);
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

    it('the same -80 with +25 Exposed is -55, below the cap, and lands at 0.45', () => {
        const { damage } = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -60 + 25, victimSideIncomingPct: -60 }),
            false,
            1,
            20
        );
        expect(damage).toBeCloseTo(4500, 8);
    });

    it('a victim at -70 takes the same crit with or without the attacker leader crit penalty', () => {
        const v = victim({ incomingDamageModifierPct: -70, victimSideIncomingPct: -70 });
        const without = victimHitDamageParts(scalars(), v, true, 1, 0, 0).damage;
        const withPenalty = victimHitDamageParts(scalars(), v, true, 1, 0, 10).damage;
        expect(without).toBeCloseTo(6000, 8); // 10000 * (1 + 100/100) * 0.30
        expect(withPenalty).toBe(without);
    });

    it('crit-family gear that pushes a crit past -70 is capped too', () => {
        const v = victim({ incomingDamageModifierPct: -60, victimSideIncomingPct: -60 });
        const { damage } = victimHitDamageParts(scalars(), v, true, 1, 20);
        expect(damage).toBeCloseTo(6000, 8);
    });

    it('above the cap the damage is bit-identical to the unfloored expression', () => {
        const { damage } = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -33.3 }),
            true,
            1,
            12.7,
            4.1
        );
        const incoming = -33.3 - (12.7 + 4.1);
        expect(damage).toBe(10000 * 2 * (1 * (1 + 0 / 100) * (1 + incoming / 100) * 1) * 1);
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
        // Channel: -90 victim-side + 25 Exposed = -65 net; as thrown = +25, minus the attacker's
        // own 10 penalty = +15.
        const { preMitigation } = victimHitDamageParts(
            scalars(),
            victim({ incomingDamageModifierPct: -65, victimSideIncomingPct: -90 }),
            true,
            1,
            0,
            10
        );
        expect(preMitigation).toBeCloseTo(10000 * 2 * 1.15, 8);
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
describe('runPlayerTurn aggregate path: the non-defence incoming term is floored at -70', () => {
    it('non-crit: -60 status and 20 gear (-80) lands at 0.30', () => {
        expect(aggregate(false, -60, { incomingReductionNonCritPct: 20 })).toBeCloseTo(9000, 6);
    });

    it('non-crit: -69 is unchanged', () => {
        expect(aggregate(false, -60, { incomingReductionNonCritPct: 9 })).toBeCloseTo(9300, 6);
    });

    it('non-crit: -35 status and 20 gear (-55) is below the cap and lands at 0.45', () => {
        expect(aggregate(false, -35, { incomingReductionNonCritPct: 20 })).toBeCloseTo(13500, 6);
    });

    it('crit: the crit fraction is floored independently of the non-crit base', () => {
        // incBase = -60 (above the cap); incBase - R = -80 floors to -70. The crit hit lands at
        // 30000 * 2 * 0.30. Flooring only incBase would leave it at 30000 * 2 * 0.20.
        expect(aggregate(true, -60, { incomingReductionCritFamilyPct: 20 })).toBeCloseTo(18000, 6);
    });

    it('crit: a base already below the cap and a crit-family term add nothing past -70', () => {
        // incBase = -80 floors to -70; incBase - R = -90 floors to -70; ratio is exactly 1.
        // Flooring only incBase would give a crit ratio of (1 - 0.90) / 0.30.
        expect(aggregate(true, -80, { incomingReductionCritFamilyPct: 10 })).toBeCloseTo(18000, 6);
    });

    it('crit: a victim at -70 takes the same crit with or without crit-family gear', () => {
        const without = aggregate(true, -70);
        const withGear = aggregate(true, -70, { incomingReductionCritFamilyPct: 35 });
        expect(withGear).toBeCloseTo(without, 6);
    });

    it('crit: -69 base with a crit-family term that stays above -70 is unchanged', () => {
        // incBase = -50, R = 19 -> -69 (above the cap): 30000 * 2 * 0.31.
        expect(aggregate(true, -50, { incomingReductionCritFamilyPct: 19 })).toBeCloseTo(18600, 6);
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

/** Gear/kit incoming reduction on every non-crit direct hit. */
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

describe('positional path end to end: both victim sides land at the floor', () => {
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
    it('player victim: -60 Inc. Damage Down and -20 gear lands at 0.30', () => {
        expectLanded(playerSide({ status: -60, gear: 20 }), 'victim', 1500);
    });
    it('player victim: -69 is unchanged (0.31)', () => {
        expectLanded(playerSide({ gear: 69 }), 'victim', 1550);
    });
    it('enemy victim: -80 gear lands 5000 at 0.30', () => {
        expectLanded(enemySide({ gear: 80 }), 'enemy-victim', 1500);
    });
    it('enemy victim: -60 Inc. Damage Down and -20 gear lands at 0.30', () => {
        expectLanded(enemySide({ status: -60, gear: 20 }), 'enemy-victim', 1500);
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
