/**
 * A hit an incoming-block proc shaves (Ironclad's 50%, Shadowguard's full block) is logged at what
 * the victim took, and a "% of damage dealt" leech on the attacker pays on that same number — the
 * locked rule: "% of damage dealt" is the final on-screen number, per attack.
 *
 * Board: the victim stands alone on its side (so the enemies' targeting falls back onto it while
 * it is stealthed) and casts Stealth on itself first. Two attackers then hit it for 1,000 each,
 * A1 before A2, and each carries a 15% standing Damage Leech. The block abilities are forced to
 * proc (chance 1) — the shipped chances never fire on the deterministic rate gate within one
 * round. Mounted both ways.
 *
 *   Shadowguard (self-stealth, full, once per round): A1's hit is blocked → row 0, no leech;
 *                A2's hit lands → row 1,000, leech 150.
 *   Ironclad (2nd+ hit in a round, 50%): A1 → 1,000 / 150; A2 → 500 / 75.
 *   No block: 1,000 / 150 both.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { LOG_EVENT_TYPES } from '../../calculators/battleSimulator';
import { buildCombatLog } from '../log/buildCombatLog';
import type { CombatLogEntry } from '../log/types';
import type { CombatActor } from '../state';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { mirrorBoard, ShipSpec } from './__fixtures__/mirrorBoard';

beforeEach(() => setupKeyedRng(7));

const stealthSelf: Ability = {
    id: 'victim-stealth',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Stealth',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
};

type Block = {
    condition: 'nth-hit-2plus' | 'self-stealth';
    blockPct: number;
    oncePerRound: boolean;
};
const SHADOWGUARD: Block = { condition: 'self-stealth', blockPct: 1, oncePerRound: true };
const IRONCLAD: Block = { condition: 'nth-hit-2plus', blockPct: 0.5, oncePerRound: false };

const blockAbility = (block: Block): Ability => ({
    id: 'victim-block',
    type: 'incoming-block',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'incoming-block', procChance: 1, ...block },
    autoFilled: true,
});

const leech: Ability = {
    id: 'equip-set-LEECH',
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: 15, basis: 'damage-dealt', leechScope: 'all', noCrit: true },
    autoFilled: true,
};

const hitter = (id: string): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `${id}-hit`,
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
        { slot: 'passive', abilities: [leech] },
    ],
});

const run = (side: 'player' | 'enemy', block?: Block) => {
    const victim: ShipSpec = {
        id: 'victim',
        position: 'M4',
        speed: 1000,
        hp: 1e9,
        skills: {
            slots: [
                { slot: 'active', abilities: [stealthSelf] },
                ...(block ? [{ slot: 'passive' as const, abilities: [blockAbility(block)] }] : []),
            ],
        },
    };
    const a1: ShipSpec = {
        id: 'a1',
        position: 'M4',
        speed: 20,
        attack: 1000,
        hp: 1e9,
        skills: hitter('a1'),
    };
    const a2: ShipSpec = {
        id: 'a2',
        position: 'T4',
        speed: 10,
        attack: 1000,
        hp: 1e9,
        skills: hitter('a2'),
    };
    const { input, idOf } = mirrorBoard({ caster: [victim], other: [a1, a2], numRounds: 1 }, side);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const t of LOG_EVENT_TYPES) bus.on(t, (e) => events.push(e as CombatEvent));
    const leechBy: Record<string, number> = {};
    const onHeal = (casterId: string, amount: number) => {
        const spec = ['a1', 'a2'].find((s) => idOf(s) === casterId);
        if (spec) leechBy[spec] = (leechBy[spec] ?? 0) + amount;
    };
    bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) =>
        onHeal(
            e.casterId,
            (e.perTarget ?? []).reduce((s, t) => s + t.amount, 0)
        )
    );
    bus.on(
        'reactive-heal-performed',
        (e: Extract<CombatEvent, { type: 'reactive-heal-performed' }>) =>
            onHeal(
                e.casterId,
                e.perTarget.reduce((s, t) => s + t.amount, 0)
            )
    );
    let victimActor: CombatActor | undefined;
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            victimActor = all.find((a) => a.id === idOf('victim'));
        },
    });
    const roster = ['victim', 'a1', 'a2'].map((s) => ({
        actorId: idOf(s),
        side: (s === 'victim') === (side === 'player') ? ('player' as const) : ('enemy' as const),
        name: s,
    }));
    const log = buildCombatLog(events, roster, new Map());
    const entries: CombatLogEntry[] = log.flatMap((r) => r.turns.flatMap((t) => t.entries));
    const rowOf = (spec: string) =>
        entries
            .filter((e) => e.kind === 'attack' && e.actorId === idOf(spec))
            .flatMap((e) => e.targets)
            .filter((t) => t.targetId === idOf('victim'))
            .map((t) => t.amount);
    const hpLost = 1e9 - (victimActor?.currentHp ?? Number.NaN);
    return { rows: { a1: rowOf('a1'), a2: rowOf('a2') }, leechBy, hpLost };
};

describe('a blocked hit logs, and leeches on, what the victim took', () => {
    for (const side of ['player', 'enemy'] as const) {
        describe(`victim on the ${side} side`, () => {
            it('no block: both hits log 1,000 and leech 150', () => {
                const { rows, leechBy, hpLost } = run(side);
                expect(hpLost).toBeCloseTo(2000, 6);
                expect(rows).toEqual({ a1: [1000], a2: [1000] });
                expect(leechBy.a1).toBeCloseTo(150, 6);
                expect(leechBy.a2).toBeCloseTo(150, 6);
            });
            it('Shadowguard: the blocked hit logs 0 and leeches nothing', () => {
                const { rows, leechBy, hpLost } = run(side, SHADOWGUARD);
                expect(hpLost).toBeCloseTo(1000, 6);
                expect(rows).toEqual({ a1: [0], a2: [1000] });
                expect(leechBy.a1 ?? 0).toBe(0);
                expect(leechBy.a2).toBeCloseTo(150, 6);
            });
            it('Ironclad: the second hit logs 500 and leeches 75', () => {
                const { rows, leechBy, hpLost } = run(side, IRONCLAD);
                expect(hpLost).toBeCloseTo(1500, 6);
                expect(rows).toEqual({ a1: [1000], a2: [500] });
                expect(leechBy.a1).toBeCloseTo(150, 6);
                expect(leechBy.a2).toBeCloseTo(75, 6);
            });
        });
    }
});

/**
 * The same for a reaction's row: a counter that strikes a stealthed Shadowguard carrier.
 * The carrier casts Stealth, then hits the counter owner for 1,000; the owner counters for its
 * own 1,000 attack and carries the 15% leech. The counter is the carrier's first direct intake of
 * the round, so the block eats it whole: row 0, carrier HP unchanged, no leech.
 */
const counterRun = (side: 'player' | 'enemy', block: boolean) => {
    const owner: ShipSpec = {
        id: 'owner',
        position: 'M4',
        speed: 10,
        attack: 1000,
        hp: 1e9,
        skills: {
            slots: [
                { slot: 'active', abilities: [] },
                {
                    slot: 'passive',
                    abilities: [
                        leech,
                        {
                            id: 'owner-counter',
                            type: 'counter',
                            target: 'enemy',
                            trigger: 'on-attacked',
                            conditions: [],
                            config: { type: 'counter', multiplier: 100 },
                        },
                    ],
                },
            ],
        },
    };
    const carrier: ShipSpec = {
        id: 'carrier',
        position: 'M4',
        speed: 1000,
        attack: 1000,
        hp: 1e9,
        skills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [stealthSelf, ...hitter('carrier').slots[0].abilities],
                },
                ...(block
                    ? [{ slot: 'passive' as const, abilities: [blockAbility(SHADOWGUARD)] }]
                    : []),
            ],
        },
    };
    const { input, idOf } = mirrorBoard({ caster: [owner], other: [carrier], numRounds: 1 }, side);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const t of LOG_EVENT_TYPES) bus.on(t, (e) => events.push(e as CombatEvent));
    let ownerLeech = 0;
    const onHeal = (casterId: string, amount: number) => {
        if (casterId === idOf('owner')) ownerLeech += amount;
    };
    bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) =>
        onHeal(
            e.casterId,
            (e.perTarget ?? []).reduce((s, t) => s + t.amount, 0)
        )
    );
    bus.on(
        'reactive-heal-performed',
        (e: Extract<CombatEvent, { type: 'reactive-heal-performed' }>) =>
            onHeal(
                e.casterId,
                e.perTarget.reduce((s, t) => s + t.amount, 0)
            )
    );
    let carrierActor: CombatActor | undefined;
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            carrierActor = all.find((a) => a.id === idOf('carrier'));
        },
    });
    const roster = ['owner', 'carrier'].map((s) => ({
        actorId: idOf(s),
        side: (s === 'owner') === (side === 'player') ? ('player' as const) : ('enemy' as const),
        name: s,
    }));
    const flatten = (es: CombatLogEntry[]): CombatLogEntry[] =>
        es.flatMap((e) => [e, ...flatten(e.reactions)]);
    const entries = flatten(
        buildCombatLog(events, roster, new Map()).flatMap((r) => [
            ...r.startOfRound,
            ...r.turns.flatMap((t) => t.entries),
            ...r.endOfRound,
        ])
    );
    const counterRows = entries
        .filter((e) => e.kind === 'attack' && e.actorId === idOf('owner'))
        .flatMap((e) => e.targets)
        .filter((t) => t.targetId === idOf('carrier'))
        .map((t) => t.amount);
    return {
        counterRows,
        ownerLeech,
        carrierHpLost: 1e9 - (carrierActor?.currentHp ?? Number.NaN),
    };
};

describe('a blocked counter logs, and leeches on, what its victim took', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`counter owner on the ${side} side: no block → row 1,000, leech 150`, () => {
            const got = counterRun(side, false);
            expect(got.carrierHpLost).toBeCloseTo(1000, 6);
            expect(got.counterRows).toEqual([1000]);
            expect(got.ownerLeech).toBeCloseTo(150, 6);
        });
        it(`counter owner on the ${side} side: Shadowguard → row 0, no leech`, () => {
            const got = counterRun(side, true);
            expect(got.carrierHpLost).toBe(0);
            expect(got.counterRows).toEqual([0]);
            expect(got.ownerLeech).toBe(0);
        });
    }
});
