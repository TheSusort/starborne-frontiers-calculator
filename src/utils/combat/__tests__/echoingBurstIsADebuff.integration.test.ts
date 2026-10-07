/**
 * Echoing Burst accumulators and Bombs are debuffs in every sense (owner ruling R109):
 *
 *  - an Echoing Burst a ship holds is ONE debuff in its debuff count — Lev's "additional 15% for
 *    each debuff on the enemy" counts it next to a Defense Down II;
 *  - a cleanse removes it, and the stored damage is lost — no burst;
 *  - a duration cut on "all active debuffs" (Heliodor) that brings it to 0 removes it without a
 *    burst;
 *  - Cheat Death wipes Bombs and Echoing Burst along with the other DoTs; an unremovable Acidic
 *    Decay survives.
 *
 * The accumulator, Bomb and Acidic Decay are seeded onto the holder before anyone acts. The
 * holder is the slowest ship, so its own turn — where a held accumulator bursts — comes after the
 * cleanse / cut. Each "no burst" case is paired with a control board that shows the burst firing.
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv, refit 4). Every case runs with the
 * caster team on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { StatusEngine } from '../statusEngine';
import { actorDebuffCount, ownerDebuffCount } from '../triggers';
import type { CombatActor, PendingAccumulator, PendingBomb } from '../state';
import type { ShipSkills } from '../../../types/abilities';
import {
    mirrorBoard,
    realSlots,
    NO_SKILLS,
    ShipSpec,
    MirrorTeams,
} from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(11));

const SIDES = ['player', 'enemy'] as const;

const accumulator = (sourceId: string, roundsRemaining: number): PendingAccumulator => ({
    roundsRemaining,
    pct: 100,
    accumulated: 50_000,
    sourceId,
});

const bomb = (sourceId: string): PendingBomb => ({
    countdown: 9,
    damagePerStack: 1000,
    stacks: 1,
    tier: 1,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

const HIT: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'hit',
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

/** Runs the board; `seed` runs against the live actors (ids already mounted) before round 1. */
const runBoard = (
    teams: MirrorTeams,
    side: 'player' | 'enemy',
    seed: (byId: (specId: string) => CombatActor, idOf: (specId: string) => string) => void,
    listen: (
        bus: ReturnType<typeof createEventBus>,
        byId: (specId: string) => CombatActor,
        idOf: (specId: string) => string,
        engine: () => StatusEngine | undefined
    ) => void
): void => {
    const { input, idOf } = mirrorBoard(teams, side);
    const bus = createEventBus();
    let engine: StatusEngine | undefined;
    let actors: CombatActor[] = [];
    const byId = (specId: string): CombatActor => {
        const a = actors.find((x) => x.id === idOf(specId));
        if (!a) throw new Error(`${specId} missing`);
        return a;
    };
    listen(bus, byId, idOf, () => engine);
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (se) => {
            engine = se;
        },
        __testTapActors: (all: CombatActor[]) => {
            actors = all;
            seed(byId, idOf);
        },
    });
};

describe("Lev's 'additional 15% for each debuff on the enemy' counts a held Echoing Burst", () => {
    const lev: ShipSpec = {
        id: 'lev',
        position: 'M4',
        speed: 100,
        attack: 10_000,
        hacking: 1e6,
        chargeCount: 99,
        skills: { slots: realSlots('Lev', ['active']) },
    };
    const x: ShipSpec = { id: 'x', position: 'M4', speed: 1, defence: 0, hp: 1e12 };
    interface Measured {
        dealt: number;
        debuffsAtLevTurn: number;
        namedAtLevTurn: number;
    }
    const measure = (side: 'player' | 'enemy', withBurst: boolean): Measured => {
        const out: Measured = { dealt: 0, debuffsAtLevTurn: -1, namedAtLevTurn: -1 };
        runBoard(
            { caster: [lev], other: [x] },
            side,
            (byId, idOf) => {
                if (withBurst) byId('x').pendingAccumulators.push(accumulator(idOf('lev'), 5));
            },
            (bus, byId, idOf, engine) => {
                // Seeded once round 1 has begun (the store refuses an application for a round it
                // is not at).
                bus.on('round-started', (e: Extract<CombatEvent, { type: 'round-started' }>) => {
                    if (e.round !== 1) return;
                    engine()?.applyTimedAbilityStatus(
                        1,
                        {
                            payload: { buffName: 'Defense Down II', stacks: 1, parsedEffects: {} },
                            side: 'enemy',
                            sourceSlot: 'active',
                            conditions: [],
                            casterId: idOf('lev'),
                            kind: 'timed',
                            duration: 9,
                        },
                        undefined,
                        idOf('x')
                    );
                });
                bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
                    if (e.actorId !== idOf('lev') || e.round !== 1) return;
                    const se = engine();
                    if (!se) return;
                    out.namedAtLevTurn = ownerDebuffCount(se, idOf('x'));
                    out.debuffsAtLevTurn = actorDebuffCount(se, byId('x'));
                });
                bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
                    if (e.attackerId === idOf('lev') && e.round === 1) out.dealt += e.damage ?? 0;
                });
            }
        );
        return out;
    };
    for (const side of SIDES) {
        it(`${side}-side: Defense Down II + one Echoing Burst = 2 debuffs → 210% vs 195%`, () => {
            const dd = measure(side, false);
            const both = measure(side, true);
            // Non-vacuity: the seeded named debuff is on the board when Lev acts.
            expect(dd.namedAtLevTurn).toBe(1);
            expect(dd.debuffsAtLevTurn).toBe(1);
            expect(both.debuffsAtLevTurn).toBe(2);
            expect(dd.dealt).toBeGreaterThan(0);
            expect(both.dealt / dd.dealt).toBeCloseTo(210 / 195, 6);
        });
    }
});

/** Collects `accumulator-detonated` events whose holder is `holderSpec`. */
const burstsOn = (
    bus: ReturnType<typeof createEventBus>,
    idOf: (specId: string) => string,
    holderSpec: string,
    into: number[]
): void => {
    bus.on(
        'accumulator-detonated',
        (e: Extract<CombatEvent, { type: 'accumulator-detonated' }>) => {
            if (e.victimId === idOf(holderSpec)) into.push(e.round);
        }
    );
};

describe('a cleanse of 1 debuff removes an Echoing Burst without a burst', () => {
    const x: ShipSpec = { id: 'x', position: 'M4', speed: 1, hp: 1e9 };
    const hayyan = (skills: ShipSkills): ShipSpec => ({
        id: 'hayyan',
        position: 'M3',
        speed: 300,
        hp: 1e9,
        skills,
    });
    const valk: ShipSpec = { id: 'valk', position: 'M4', speed: 100, hp: 1e9 };
    interface Measured {
        bursts: number[];
        held: number;
    }
    const measure = (side: 'player' | 'enemy', skills: ShipSkills): Measured => {
        const out: Measured = { bursts: [], held: -1 };
        runBoard(
            { caster: [x, hayyan(skills)], other: [valk] },
            side,
            (byId, idOf) => byId('x').pendingAccumulators.push(accumulator(idOf('valk'), 1)),
            (bus, byId, idOf) => {
                burstsOn(bus, idOf, 'x', out.bursts);
                bus.on('round-ended', (e: Extract<CombatEvent, { type: 'round-ended' }>) => {
                    if (e.round === 1) out.held = byId('x').pendingAccumulators.length;
                });
            }
        );
        return out;
    };
    for (const side of SIDES) {
        it(`${side}-side: control — no cleanser, the Echoing Burst bursts on the holder's turn`, () => {
            expect(measure(side, NO_SKILLS)).toEqual({ bursts: [1], held: 0 });
        });
        it(`${side}-side: Hayyan cleanses 1 debuff → the Echoing Burst is gone, no burst`, () => {
            expect(measure(side, { slots: realSlots('Hayyan', ['active']) })).toEqual({
                bursts: [],
                held: 0,
            });
        });
    }
});

describe("Heliodor's 'reduces the duration of all active debuffs' removes a 1-round Echoing Burst", () => {
    const heliodor = (skills: ShipSkills): ShipSpec => ({
        id: 'heliodor',
        position: 'M4',
        speed: 200,
        hp: 1e9,
        skills,
    });
    const ally: ShipSpec = { id: 'ally', position: 'M3', speed: 1, hp: 1e9 };
    const hitter: ShipSpec = { id: 'hitter', position: 'M4', speed: 100, attack: 100, skills: HIT };
    const passive = (): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [] }, ...realSlots('Heliodor', ['passive'])],
    });
    const measure = (side: 'player' | 'enemy', skills: ShipSkills): number[] => {
        const bursts: number[] = [];
        runBoard(
            { caster: [heliodor(skills), ally], other: [hitter] },
            side,
            (byId, idOf) => byId('ally').pendingAccumulators.push(accumulator(idOf('hitter'), 1)),
            (bus, _byId, idOf) => burstsOn(bus, idOf, 'ally', bursts)
        );
        return bursts;
    };
    for (const side of SIDES) {
        it(`${side}-side: control — no passive, the Echoing Burst bursts on the ally's turn`, () => {
            expect(measure(side, NO_SKILLS)).toEqual([1]);
        });
        it(`${side}-side: Heliodor is hit → the ally's Echoing Burst is cut to 0, no burst`, () => {
            expect(measure(side, passive())).toEqual([]);
        });
    }
});

describe('Cheat Death wipes Bombs and Echoing Burst; Acidic Decay survives', () => {
    const hayyan: ShipSpec = {
        id: 'hayyan',
        position: 'M3',
        speed: 300,
        chargeCount: 4,
        startCharged: true,
        skills: { slots: realSlots('Hayyan', ['active', 'charged']) },
    };
    const killer = (attack: number): ShipSpec => ({
        id: 'killer',
        position: 'M3',
        speed: 150,
        attack,
        skills: HIT,
    });
    const x: ShipSpec = { id: 'x', position: 'M4', speed: 1, hp: 100_000, role: 'DEFENDER' };
    interface Measured {
        cheatDeath: boolean;
        bombs: number;
        accumulators: number;
        acidic: number;
    }
    const measure = (side: 'player' | 'enemy', attack: number): Measured => {
        const out: Measured = { cheatDeath: false, bombs: -1, accumulators: -1, acidic: -1 };
        const read = (h: CombatActor): void => {
            out.bombs = h.pendingBombs.length;
            out.accumulators = h.pendingAccumulators.length;
            out.acidic = h.genericDoTEntries.filter((e) => e.family === 'Acidic Decay').length;
        };
        runBoard(
            { caster: [killer(attack)], other: [x, hayyan] },
            side,
            (byId, idOf) => {
                const h = byId('x');
                const src = idOf('killer');
                h.pendingBombs.push(bomb(src));
                h.pendingAccumulators.push(accumulator(src, 5));
                h.genericDoTEntries.push({
                    stacks: 1,
                    tier: 1,
                    remainingRounds: 5,
                    sourceId: src,
                    perTickAmount: 1,
                    family: 'Acidic Decay',
                    unremovable: true,
                });
            },
            (bus, byId, idOf) => {
                bus.on(
                    'cheat-death-activated',
                    (e: Extract<CombatEvent, { type: 'cheat-death-activated' }>) => {
                        if (e.actorId !== idOf('x')) return;
                        out.cheatDeath = true;
                        read(byId('x'));
                    }
                );
                bus.on('round-ended', (e: Extract<CombatEvent, { type: 'round-ended' }>) => {
                    if (e.round === 1 && !out.cheatDeath) read(byId('x'));
                });
            }
        );
        return out;
    };
    for (const side of SIDES) {
        it(`${side}-side: a lethal hit triggers Cheat Death → Bomb and Echoing Burst gone`, () => {
            expect(measure(side, 1e9)).toEqual({
                cheatDeath: true,
                bombs: 0,
                accumulators: 0,
                acidic: 1,
            });
        });
        it(`${side}-side control: the hit is not lethal → everything stays`, () => {
            expect(measure(side, 1)).toEqual({
                cheatDeath: false,
                bombs: 1,
                accumulators: 1,
                acidic: 1,
            });
        });
    }
});
