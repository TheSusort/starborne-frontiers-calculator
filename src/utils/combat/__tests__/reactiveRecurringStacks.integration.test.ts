/**
 * A REACTIVE stacking grant with no turn timer (`duration: 'recurring'`) adds a stack per trigger
 * and keeps it.
 *
 * Nuqtu R2+ passive: "… when an enemy gains a buff this Unit gains Terran Bolster III for 1 turn
 * and gains 1 stack of Core Charge I." Core Charge I is "+4% Outgoing Direct Damage, +1% Defense
 * Penetration. Stackable up to 10 times." The parser emits the Core Charge grant as
 * `on-enemy-buffed`, `stacks: 1`, `maxStacks: 10`, `duration: 'recurring'`. Each enemy buff gain
 * is a separate gain (re-gaining a held buff included), so four gains before Nuqtu acts are four
 * stacks, and they persist into later rounds until the cap.
 *
 * The fix is keyed on `duration === 'recurring'`, NOT on "has no numeric duration": the Isha/Nayra
 * Affinity Overrides carry no duration at all and take their own no-end window (owner ruling R51,
 * `UNTIL_PURGED_GRANTS` in triggers.ts), not the accumulating store, and Terran Bolster III,
 * granted by the same trigger with `duration: 1`, still expires.
 *
 * Every Nuqtu/Nayra kit here comes from the production parser over `docs/ship-skills.csv`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { selfBuffStacksForOwner } from '../triggers';
import type { StatusEngine } from '../statusEngine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const HUGE_HP = 1_000_000_000;
const ATTACK = 1000;

const requireReferenceData = (): void => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the gitignored reference data into this ' +
                'worktree. These cases read REAL kits and cannot run without it.'
        );
    }
};

const realPassive = (name: string): Ability[] => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} is missing from the reference data in this worktree`);
    return buildShipAbilities(ship).slots.find((s) => s.slot === 'passive')?.abilities ?? [];
};

const front = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const plainHit = (id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

/** Two self-buffs on the active: every cast is two "gains a buff" events for an opposing Nuqtu,
 *  which count as one trigger. */
const twoSelfBuffs = (prefix: string): Ability[] =>
    (['Attack Up', 'Hacking Up'] as const).map((buffName, i) => ({
        id: `${prefix}-buff-${i}`,
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'buff',
            buffName,
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            duration: 2,
        },
    }));

/** Nuqtu's real passive plus a plain 100% hit — his real active would scale with the enemy's buff
 *  count and his defence, burying the Core Charge read. */
const nuqtuSlots = (): ShipSkills['slots'] => [
    { slot: 'active', abilities: [plainHit('nuqtu-hit')] },
    { slot: 'passive', abilities: realPassive('Nuqtu') },
];

/** A fast, harmless ship that casts a two-buff self grant every turn. */
const buffingEnemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 300 },
    chargeCount: 0,
    startCharged: false,
    position,
    affinity: 'antimatter',
    target: front(),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: twoSelfBuffs(id) }] },
});

const BASE: Omit<CombatEngineInput, 'enemyAttackers'> = {
    attack: ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    numRounds: 3,
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
    hp: HUGE_HP,
    speed: 10,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: front(),
    pattern: basePattern(),
};

/** The player focus is Nuqtu (or a plain hitter when `withPassive` is false), slowest on the
 *  board, facing two enemies that each gain two buffs before he moves: 4 gains per round. */
const playerNuqtu = (withPassive = true): CombatEngineInput => ({
    ...BASE,
    shipSkills: {
        slots: withPassive ? nuqtuSlots() : [{ slot: 'active', abilities: [plainHit('x')] }],
    },
    enemyAttackers: [buffingEnemy('e-a', 'M4'), buffingEnemy('e-b', 'M3')],
});

/** A player ship that gains two buffs every turn and is otherwise inert. */
const buffingAlly = (id: string, position: Position): TeamActorEngineInput => ({
    id,
    speed: 300,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    role: 'ATTACKER',
    position,
    target: front(),
    pattern: basePattern(),
    walk: {
        shipSkills: { slots: [{ slot: 'active', abilities: twoSelfBuffs(id) }] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: HUGE_HP,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** The enemy twin: Nuqtu is an enemy, the two buff-gaining ships are the player's (the focus,
 *  with no damage of its own, plus one team ship). */
const enemyNuqtu = (withPassive = true): CombatEngineInput => ({
    ...BASE,
    attack: 0,
    speed: 300,
    shipSkills: { slots: [{ slot: 'active', abilities: twoSelfBuffs('focus') }] },
    teamActors: [buffingAlly('p-b', 'M3')],
    enemyAttackers: [
        {
            id: 'e-nuqtu',
            stats: { attack: ATTACK, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            affinity: 'antimatter',
            target: front(),
            pattern: basePattern(),
            shipSkills: {
                slots: withPassive
                    ? nuqtuSlots()
                    : [{ slot: 'active', abilities: [plainHit('x')] }],
            },
        },
    ],
});

interface Run {
    /** The damage each of the hitter's hits did, in order (one per round here). */
    hits: number[];
    events: CombatEvent[];
    engine: StatusEngine;
}

const run = (input: CombatEngineInput, hitterId: string): Run => {
    const events: CombatEvent[] = [];
    const bus = createEventBus();
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    let engine: StatusEngine | undefined;
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    const hits = events
        .filter(
            (e): e is Extract<CombatEvent, { type: 'attacked' }> =>
                e.type === 'attacked' && e.attackerId === hitterId
        )
        .map((e) => e.damage ?? 0);
    return { hits, events, engine: engine! };
};

describe("Nuqtu's Core Charge I — one stack per enemy buffing cast, kept, capped at 10", () => {
    beforeAll(requireReferenceData);

    it('PRECONDITION: the real grant is on-enemy-buffed, 1 stack, max 10, recurring', () => {
        const grant = realPassive('Nuqtu').find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Core Charge I'
        );
        expect(grant).toMatchObject({
            trigger: 'on-enemy-buffed',
            target: 'self',
            config: { stacks: 1, maxStacks: 10, duration: 'recurring' },
        });
    });

    it('CONTROL: without the passive the same hit is a flat 1000 every round', () => {
        expect(run(playerNuqtu(false), 'attacker').hits).toEqual([ATTACK, ATTACK, ATTACK]);
        expect(run(enemyNuqtu(false), 'e-nuqtu').hits).toEqual([ATTACK, ATTACK, ATTACK]);
    });

    for (const [label, input, nuqtuId] of [
        ['PLAYER Nuqtu', () => playerNuqtu(), 'attacker'],
        ['ENEMY Nuqtu', () => enemyNuqtu(), 'e-nuqtu'],
    ] as const) {
        it(`${label}: 2 buffing casts a round → 2, 4, 6 stacks (+4% each)`, () => {
            const { hits, engine } = run(input(), nuqtuId);

            expect(hits).toHaveLength(3);
            expect(hits[0]).toBeCloseTo(ATTACK * 1.08, 6);
            expect(hits[1]).toBeCloseTo(ATTACK * 1.16, 6);
            expect(hits[2]).toBeCloseTo(ATTACK * 1.24, 6);
            expect(selfBuffStacksForOwner(engine, nuqtuId, 'Core Charge I')).toBe(6);
        });

        it(`${label}: Core Charge I never expires, Terran Bolster III (1 turn) still does`, () => {
            const { events } = run(input(), nuqtuId);
            const expired = (name: string) =>
                events.filter(
                    (e) => e.type === 'buff-expired' && e.actorId === nuqtuId && e.buffName === name
                ).length;

            expect(expired('Core Charge I')).toBe(0);
            expect(expired('Terran Bolster III')).toBeGreaterThan(0);
        });
    }
});

describe("A duration-less reactive grant is NOT a recurring one — Nayra's override has no end", () => {
    beforeAll(requireReferenceData);

    it("PRECONDITION: Nayra's real Defensive Affinity Override has no duration at all", () => {
        const grant = realPassive('Nayra').find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Defensive Affinity Override'
        );
        expect(grant).toMatchObject({ trigger: 'start-of-round', target: 'self' });
        expect(grant?.config.type === 'buff' && grant.config.duration).toBeUndefined();
    });

    it('her override is granted every round start and never expires (R51)', () => {
        const nayra: TeamActorEngineInput = {
            ...buffingAlly('nayra', 'M2'),
            walk: {
                ...buffingAlly('nayra', 'M2').walk!,
                shipSkills: { slots: [{ slot: 'passive', abilities: realPassive('Nayra') }] },
            },
        };
        const { events } = run(
            {
                ...BASE,
                teamActors: [nayra],
                enemyAttackers: [{ ...buffingEnemy('e-a', 'M4'), shipSkills: { slots: [] } }],
            },
            'attacker'
        );
        const applied = events.filter(
            (e) =>
                e.type === 'buff-applied' &&
                e.actorId === 'nayra' &&
                e.buffName === 'Defensive Affinity Override'
        );
        const expired = events.filter(
            (e) =>
                e.type === 'buff-expired' &&
                e.actorId === 'nayra' &&
                e.buffName === 'Defensive Affinity Override'
        );

        expect(applied).toHaveLength(3);
        for (const e of applied) expect(e.type === 'buff-applied' && e.duration).toBe(Infinity);
        expect(expired).toHaveLength(0);
    });
});

// Owner ruling R121: Nuqtu gains ONE Core Charge per enemy skill cast that grants buffs, however
// many allies or buffs that cast grants.
describe("Nuqtu's Core Charge I — one stack per enemy buffing SKILL CAST (R121)", () => {
    beforeAll(requireReferenceData);

    /** A cast granting Attack Up II + Defense Up II to every ally. */
    const teamBuffs = (prefix: string): Ability[] =>
        (['Attack Up II', 'Defense Up II'] as const).map((buffName, i) => ({
            id: `${prefix}-team-${i}`,
            type: 'buff',
            target: 'all-allies',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName,
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                duration: 2,
            },
        }));

    const enemyShip = (id: string, position: Position, abilities: Ability[]): EnemyAttacker => ({
        ...buffingEnemy(id, position),
        shipSkills: { slots: [{ slot: 'active', abilities }] },
    });

    const playerNuqtuVs = (enemies: EnemyAttacker[]): CombatEngineInput => ({
        ...playerNuqtu(),
        numRounds: 1,
        enemyAttackers: enemies,
    });

    const stacksAfter = (input: CombatEngineInput): number => {
        const { engine } = run(input, 'attacker');
        return selfBuffStacksForOwner(engine, 'attacker', 'Core Charge I');
    };

    it('CONTROL: no enemy buffs anything, no stack', () => {
        expect(stacksAfter(playerNuqtuVs([enemyShip('e-a', 'M4', [plainHit('a')])]))).toBe(0);
    });

    it('one cast granting 2 buffs to 3 allies is ONE stack', () => {
        // e-a casts first (speed 300); e-b and e-c are its inert allies who receive both buffs.
        const caster = enemyShip('e-a', 'M4', teamBuffs('e-a'));
        const inert = (id: string, position: Position): EnemyAttacker => ({
            ...enemyShip(id, position, []),
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 5 },
        });
        expect(stacksAfter(playerNuqtuVs([caster, inert('e-b', 'M3'), inert('e-c', 'M2')]))).toBe(
            1
        );
    });

    it('two separate buffing casts are TWO stacks', () => {
        const a = enemyShip('e-a', 'M4', teamBuffs('e-a'));
        const b = enemyShip('e-b', 'M3', teamBuffs('e-b'));
        expect(stacksAfter(playerNuqtuVs([a, b]))).toBe(2);
    });

    it('mirror: an ENEMY Nuqtu reads a player ship casting a team buff as ONE stack', () => {
        const input: CombatEngineInput = {
            ...enemyNuqtu(),
            numRounds: 1,
            shipSkills: { slots: [{ slot: 'active', abilities: teamBuffs('focus') }] },
            teamActors: [buffingAlly('p-b', 'M3'), { ...buffingAlly('p-c', 'M2'), speed: 5 }].map(
                (t) => ({
                    ...t,
                    walk: {
                        ...t.walk!,
                        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                    },
                })
            ),
        };
        const { engine } = run(input, 'e-nuqtu');
        expect(selfBuffStacksForOwner(engine, 'e-nuqtu', 'Core Charge I')).toBe(1);
    });
});
