/**
 * Defense Shred stacks are debuffs everywhere (owner rulings 2026-10-05):
 *
 *  - R73: each stack counts as ONE debuff in every debuff count. An enemy with 3 Defense Shred
 *    stacks has 3 debuffs, so Crocus's "If an enemy has 3 or more debuffs, this Unit inflicts
 *    Stasis" fires on it — the count and the cleanse (R44, one stack per cleansed debuff) agree.
 *  - R74: Cheat Death wipes Defense Shred like any other removable debuff.
 *
 * Real parsed kits (buildTraceShip, refit 4): Enforcer's active + passive (3 hits, each crit
 * inflicts Defense Shred), Crocus's active (its own Corrosion II counts too — R29), Hayyan's charged
 * ("grants Cheat Death to all allies"). Every roll lands (hacking 1e6) and Enforcer always crits.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    createStatusEngine,
    type RegisteredAbilityStatus,
    type StatusEngine,
} from '../statusEngine';
import { namedDebuffCount, ownerDebuffCount, ownerDebuffNamesFor } from '../triggers';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(9));

const SIDES = ['player', 'enemy'] as const;

const enforcer = (id: string, position: 'M4' | 'M3', speed: number): ShipSpec => ({
    id,
    position,
    speed,
    attack: 100,
    crit: 100,
    critDamage: 0,
    hacking: 1e6,
    chargeCount: 99,
    skills: { slots: realSlots('Enforcer', ['active', 'passive']) },
});

describe("R73: Crocus's '3 or more debuffs' counts each Defense Shred stack", () => {
    const crocus = (speed: number): ShipSpec => ({
        id: 'crocus',
        position: 'M4',
        speed,
        attack: 100,
        hacking: 1e6,
        chargeCount: 99,
        skills: { slots: realSlots('Crocus', ['active']) },
    });
    /** Targets Crocus inflicted Stasis on in round 1. */
    const stasis = (teams: MirrorTeams, side: 'player' | 'enemy'): string[] => {
        const { input, idOf } = mirrorBoard(teams, side);
        const id = idOf('crocus');
        const bus = createEventBus();
        const out: string[] = [];
        bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
            if (e.sourceId === id && e.buffName === 'Stasis' && e.round === 1)
                out.push(teams.other.find((s) => idOf(s.id) === e.targetId)?.id ?? e.targetId);
        });
        runCombat({ ...input, bus });
        return out;
    };
    const x: ShipSpec = { id: 'x', position: 'M4', speed: 1, role: 'DEFENDER' };
    for (const side of SIDES) {
        it(`${side}-side: 3 Defense Shred stacks + Crocus's Corrosion II → Stasis`, () => {
            expect(
                stasis({ caster: [crocus(10), enforcer('enforcer', 'M3', 200)], other: [x] }, side)
            ).toEqual(['x']);
        });
        it(`${side}-side reverse board: Crocus acts before the shred lands → no Stasis`, () => {
            expect(
                stasis({ caster: [crocus(300), enforcer('enforcer', 'M3', 200)], other: [x] }, side)
            ).toEqual([]);
        });
        it(`${side}-side: no Defense Shred, Corrosion II alone → no Stasis`, () => {
            expect(stasis({ caster: [crocus(10)], other: [x] }, side)).toEqual([]);
        });
    }
});

describe("R88: Crocus's '3 or more debuffs' counts each of Amartya's Exposed stacks", () => {
    /** Gains Taunt on its own turn, before anyone else acts. */
    const taunter: ShipSpec = {
        id: 'x',
        position: 'M4',
        speed: 300,
        role: 'DEFENDER',
        skills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'x-taunt',
                            type: 'buff',
                            target: 'self',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'buff',
                                buffName: 'Taunt',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                duration: 2,
                            },
                        },
                    ],
                },
            ],
        },
    };
    /** Amartya R4's passive alone: "When an enemy defender gains Taunt, this Unit inflicts 2
     *  stacks of Exposed on that defender". */
    const amartya: ShipSpec = {
        id: 'amartya',
        position: 'M3',
        speed: 1,
        hacking: 1e6,
        skills: {
            slots: [{ slot: 'active', abilities: [] }, ...realSlots('Amartya', ['passive'])],
        },
    };
    const crocus: ShipSpec = {
        id: 'crocus',
        position: 'M4',
        speed: 10,
        attack: 100,
        hacking: 1e6,
        chargeCount: 99,
        skills: { slots: realSlots('Crocus', ['active']) },
    };
    /** Targets Crocus inflicted Stasis on in round 1, and how many Exposed stacks x held when
     *  Crocus's turn started. */
    const measure = (
        teams: MirrorTeams,
        side: 'player' | 'enemy'
    ): { stasis: string[]; exposedAtCrocusTurn: number } => {
        const { input, idOf } = mirrorBoard(teams, side);
        const crocusId = idOf('crocus');
        const xId = idOf('x');
        let engine: StatusEngine | undefined;
        let exposedAtCrocusTurn = 0;
        const stasis: string[] = [];
        const bus = createEventBus();
        bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
            if (e.actorId !== crocusId || e.round !== 1) return;
            exposedAtCrocusTurn =
                engine
                    ?.timedAbilityStatuses('enemy', undefined, xId)
                    .filter((st) => st.active.buffName === 'Exposed')
                    .reduce((n, st) => n + (st.payload.stacks ?? 1), 0) ?? 0;
        });
        bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
            if (e.sourceId === crocusId && e.buffName === 'Stasis' && e.round === 1)
                stasis.push(e.targetId === xId ? 'x' : e.targetId);
        });
        runCombat({
            ...input,
            bus,
            __testTapStatusEngine: (se) => {
                engine = se;
            },
        });
        return { stasis, exposedAtCrocusTurn };
    };
    for (const side of SIDES) {
        it(`${side}-side: 2 Exposed stacks + Crocus's Corrosion II = 3 debuffs → Stasis`, () => {
            const m = measure({ caster: [crocus, amartya], other: [taunter] }, side);
            expect(m.exposedAtCrocusTurn).toBe(2);
            expect(m.stasis).toEqual(['x']);
        });
        it(`${side}-side control: no Amartya, Corrosion II alone → no Stasis`, () => {
            const m = measure({ caster: [crocus], other: [taunter] }, side);
            expect(m.exposedAtCrocusTurn).toBe(0);
            expect(m.stasis).toEqual([]);
        });
    }
});

describe('R74: Cheat Death wipes Defense Shred', () => {
    /** Grants every ally Cheat Death on its first turn. */
    const hayyan: ShipSpec = {
        id: 'hayyan',
        position: 'M3',
        speed: 300,
        chargeCount: 4,
        startCharged: true,
        skills: { slots: realSlots('Hayyan', ['active', 'charged']) },
    };
    /** One lethal single hit, after Enforcer's shreds. */
    const killer = (attack: number): ShipSpec => ({
        id: 'killer',
        position: 'M3',
        speed: 150,
        attack,
        skills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'killer-hit',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100 },
                        },
                    ],
                },
            ],
        },
    });
    /** Repairs every ally to full between the killer's hit and Enforcer's turn (reverse board),
     *  so x survives Enforcer's hits after Cheat Death left it at 1 HP. */
    const medic: ShipSpec = {
        id: 'medic',
        position: 'B4',
        speed: 120,
        hp: 1e9,
        skills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'medic-repair',
                            type: 'heal',
                            target: 'all-allies',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'heal', pct: 10, basis: 'hp' },
                        },
                    ],
                },
            ],
        },
    };
    const x = (cheatDeath: boolean, withMedic = false): ShipSpec[] => [
        { id: 'x', position: 'M4', speed: 1, hp: 100_000, role: 'DEFENDER' },
        ...(cheatDeath ? [hayyan] : []),
        ...(withMedic ? [medic] : []),
    ];
    interface Measured {
        shred: number;
        alive: boolean;
        cheatDeath: boolean;
    }
    const measure = (teams: MirrorTeams, side: 'player' | 'enemy'): Measured => {
        const { input, idOf } = mirrorBoard(teams, side);
        const xId = idOf('x');
        let engine: StatusEngine | undefined;
        let shred = -1;
        let alive = true;
        let cheatDeath = false;
        const bus = createEventBus();
        bus.on('round-ended', (e: Extract<CombatEvent, { type: 'round-ended' }>) => {
            if (e.round !== 1) return;
            shred =
                engine
                    ?.timedAbilityStatuses('enemy', undefined, xId)
                    .find((s) => s.active.buffName === 'Defense Shred')?.active.stacks ?? 0;
        });
        bus.on('ship-destroyed', (e: Extract<CombatEvent, { type: 'ship-destroyed' }>) => {
            if (e.actorId === xId) alive = false;
        });
        bus.on(
            'cheat-death-activated',
            (e: Extract<CombatEvent, { type: 'cheat-death-activated' }>) => {
                if (e.actorId === xId) cheatDeath = true;
            }
        );
        runCombat({
            ...input,
            bus,
            __testTapStatusEngine: (se) => {
                engine = se;
            },
        });
        return { shred, alive, cheatDeath };
    };
    for (const side of SIDES) {
        it(`${side}-side: 3 stacks, then a lethal hit triggers Cheat Death → 0 stacks`, () => {
            const m = measure(
                { caster: [enforcer('enforcer', 'M4', 200), killer(1e9)], other: x(true) },
                side
            );
            expect(m.cheatDeath).toBe(true);
            expect(m.alive).toBe(true);
            expect(m.shred).toBe(0);
        });
        it(`${side}-side: Cheat Death held but the hit is not lethal → the 3 stacks stay`, () => {
            const m = measure(
                { caster: [enforcer('enforcer', 'M4', 200), killer(1)], other: x(true) },
                side
            );
            expect(m.cheatDeath).toBe(false);
            expect(m.alive).toBe(true);
            expect(m.shred).toBe(3);
        });
        it(`${side}-side reverse board: Cheat Death fires before the shred → 3 stacks after it`, () => {
            // The killer acts first: Cheat Death fires on a clean ship, the medic repairs it, then
            // Enforcer shreds it.
            const m = measure(
                {
                    caster: [enforcer('enforcer', 'M4', 100), killer(1e9)],
                    other: x(true, true),
                },
                side
            );
            expect(m.cheatDeath).toBe(true);
            expect(m.alive).toBe(true);
            expect(m.shred).toBe(3);
        });
    }
});

describe('R73: the named-debuff count primitive', () => {
    const timed = (
        buffName: string,
        stacks = 1
    ): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration: 3,
        payload: { buffName, stacks, parsedEffects: {} },
    });
    it('3 Defense Shred stacks + Attack Down → 4 debuffs over 2 names; a cleanse of 1 → 3', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        for (let i = 0; i < 3; i++)
            eng.applyTimedAbilityStatus(1, timed('Defense Shred'), undefined, 'v');
        eng.applyTimedAbilityStatus(1, timed('Attack Down'), undefined, 'v');
        expect(ownerDebuffNamesFor(eng, 'v')).toHaveLength(2);
        expect(ownerDebuffCount(eng, 'v')).toBe(4);
        eng.cleanse('v', 1);
        expect(ownerDebuffCount(eng, 'v')).toBe(3);
    });
    it('R88: a stackable non-persistent debuff counts per stack too (Exposed ×2 → 2)', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed('Exposed', 2), undefined, 'v');
        eng.applyTimedAbilityStatus(1, timed('Attack Down'), undefined, 'v');
        expect(ownerDebuffNamesFor(eng, 'v')).toHaveLength(2);
        expect(ownerDebuffCount(eng, 'v')).toBe(3);
        // A hit spends one Exposed stack: the count follows the live stacks.
        eng.consumeTimedEnemyStatusStack('v', 'Exposed');
        expect(ownerDebuffCount(eng, 'v')).toBe(2);
    });
    it('namedDebuffCount reads a timed status’s declared stacks the same way', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed('Exposed', 2), undefined, 'v');
        expect(namedDebuffCount(eng.timedAbilityStatuses('enemy', undefined, 'v'))).toBe(2);
    });
});
