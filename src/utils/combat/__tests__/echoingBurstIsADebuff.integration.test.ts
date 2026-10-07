/**
 * Echoing Burst accumulators and Bombs are debuffs in every sense (owner ruling R109), and an
 * Echoing Burst is a debuff of the Bomb type, not a damage-over-time effect (R112):
 *
 *  - an Echoing Burst a ship holds is ONE debuff in its debuff count — Lev's "additional 15% for
 *    each debuff on the enemy" counts it next to a Defense Down II;
 *  - a cleanse removes it, and the stored damage is lost — no burst. A Bomb-typed cleanse (Nyxen's
 *    "cleanses 2 Bomb") takes it; a damage-over-time-typed one ("cleanses 2 damage over time
 *    debuffs") does not;
 *  - it gathers only the direct damage dealt to the ship it is on, from its application until it
 *    bursts;
 *  - a duration cut on "all active debuffs" (Heliodor) that brings it to 0 bursts it there and
 *    then (R113), paying everything gathered up to that moment (R115);
 *  - Bombs and Echoing Bursts that go off together — one cut, or one turn-start expiry — detonate
 *    in order of application, and a Cheat Death the first one triggers wipes the rest (R115);
 *  - Cheat Death wipes Bombs and Echoing Burst along with the other DoTs; an unremovable Acidic
 *    Decay survives.
 *
 * The accumulator, Bomb and Acidic Decay are seeded onto the holder before anyone acts. The
 * holder is the slowest ship, so its own turn — where a held accumulator bursts — comes after the
 * cleanse / cut, unless the holder is the cleanser itself. Each case is paired with a control
 * board. Real parsed kits (buildTraceShip on docs/ship-skills.csv, refit 4). Every case runs with
 * the caster team on both sides.
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
): ReturnType<typeof runCombat> => {
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
    return runCombat({
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

describe("Nyxen's typed cleanse: 'cleanses 2 Bomb' takes a Bomb and an Echoing Burst, 'cleanses 2 damage over time debuffs' neither", () => {
    // Nyxen holds one Bomb and one Echoing Burst and acts first; her cleanse is self-targeted.
    // The charged skill's "damage over time debuffs" cleanse is mounted on the active slot so it
    // fires on turn 1.
    const nyxen = (skills: ShipSkills): ShipSpec => ({
        id: 'nyxen',
        position: 'M4',
        speed: 300,
        hp: 1e9,
        skills,
    });
    const valk: ShipSpec = { id: 'valk', position: 'M4', speed: 100, hp: 1e9 };
    const asActive = (slots: ReturnType<typeof realSlots>) =>
        slots.map((sl) => ({ ...sl, slot: 'active' as const }));
    interface Measured {
        bursts: number[];
        held: number;
        bombs: number;
    }
    const measure = (side: 'player' | 'enemy', skills: ShipSkills): Measured => {
        const out: Measured = { bursts: [], held: -1, bombs: -1 };
        runBoard(
            { caster: [nyxen(skills)], other: [valk] },
            side,
            (byId, idOf) => {
                byId('nyxen').pendingAccumulators.push(accumulator(idOf('valk'), 2));
                byId('nyxen').pendingBombs.push(bomb(idOf('valk')));
            },
            (bus, byId, idOf) => {
                burstsOn(bus, idOf, 'nyxen', out.bursts);
                bus.on('turn-ended', (e: Extract<CombatEvent, { type: 'turn-ended' }>) => {
                    if (e.actorId !== idOf('nyxen') || e.round !== 1) return;
                    out.held = byId('nyxen').pendingAccumulators.length;
                    out.bombs = byId('nyxen').pendingBombs.length;
                });
            }
        );
        return out;
    };
    for (const side of SIDES) {
        it(`${side}-side: control — no cleanse, the Echoing Burst is still held after her turn`, () => {
            expect(measure(side, NO_SKILLS)).toEqual({ bursts: [], held: 1, bombs: 1 });
        });
        it(`${side}-side: "cleanses 2 Bomb" removes the Bomb and the Echoing Burst`, () => {
            expect(measure(side, { slots: realSlots('Nyxen', ['active']) })).toEqual({
                bursts: [],
                held: 0,
                bombs: 0,
            });
        });
        it(`${side}-side: "cleanses 2 damage over time debuffs" leaves the Bomb and the Echoing Burst`, () => {
            expect(measure(side, { slots: asActive(realSlots('Nyxen', ['charged'])) })).toEqual({
                bursts: [],
                held: 1,
                bombs: 1,
            });
        });
    }
});

describe("Heliodor's 'reduces the duration of all active debuffs' bursts a 1-round Echoing Burst", () => {
    const heliodor = (skills: ShipSkills): ShipSpec => ({
        id: 'heliodor',
        position: 'M4',
        speed: 200,
        hp: 1e9,
        skills,
    });
    const ally: ShipSpec = { id: 'ally', position: 'M3', speed: 1, hp: 1e9 };
    const hitter: ShipSpec = { id: 'hitter', position: 'M4', speed: 100, attack: 100, skills: HIT };
    const idOfHitter = (side: 'player' | 'enemy'): string =>
        mirrorBoard({ caster: [heliodor(NO_SKILLS), ally], other: [hitter] }, side).idOf('hitter');
    const passive = (): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [] }, ...realSlots('Heliodor', ['passive'])],
    });
    interface Burst {
        round: number;
        damage: number;
        /** The burst came before the holder's own round-1 turn started. */
        beforeHolderTurn: boolean;
    }
    interface Measured {
        bursts: Burst[];
        /** HP the holder had lost when Heliodor's duration cut finished — read before her
         *  passive's repair half lands (-1: no cut reached the holder). */
        hpLostAtCut: number;
        /** What round 1 booked as detonation damage dealt by the Echoing Burst's applier. */
        applierCredit: number | undefined;
    }
    const measure = (side: 'player' | 'enemy', skills: ShipSkills): Measured => {
        const bursts: Burst[] = [];
        let hpLostAtCut = -1;
        let holderTurnStarted = false;
        let hpBefore = 0;
        const result = runBoard(
            { caster: [heliodor(skills), ally], other: [hitter] },
            side,
            (byId, idOf) => {
                byId('ally').pendingAccumulators.push(accumulator(idOf('hitter'), 1));
                hpBefore = byId('ally').currentHp;
            },
            (bus, byId, idOf) => {
                bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
                    if (e.actorId === idOf('ally') && e.round === 1) holderTurnStarted = true;
                });
                bus.on(
                    'reactive-cleanse-performed',
                    (e: Extract<CombatEvent, { type: 'reactive-cleanse-performed' }>) => {
                        if (e.mode !== 'reduce-duration' || hpLostAtCut >= 0) return;
                        if (!e.perTarget.some((t) => t.targetId === idOf('ally'))) return;
                        hpLostAtCut = hpBefore - byId('ally').currentHp;
                    }
                );
                bus.on(
                    'accumulator-detonated',
                    (e: Extract<CombatEvent, { type: 'accumulator-detonated' }>) => {
                        if (e.victimId !== idOf('ally')) return;
                        bursts.push({
                            round: e.round,
                            damage: e.damage,
                            beforeHolderTurn: !holderTurnStarted,
                        });
                    }
                );
            }
        );
        const applierCredit = result.rounds[0].perActorDetonation?.[idOfHitter(side)];
        return { bursts, hpLostAtCut, applierCredit };
    };
    for (const side of SIDES) {
        it(`${side}-side: control — no passive, the Echoing Burst bursts on the ally's turn`, () => {
            // The hitter hit Heliodor, not the ally, so the burst pays only the seeded 50,000.
            const { bursts, hpLostAtCut } = measure(side, NO_SKILLS);
            expect(bursts).toEqual([{ round: 1, damage: 50_000, beforeHolderTurn: false }]);
            expect(hpLostAtCut).toBe(-1);
        });
        it(`${side}-side: Heliodor is hit → the ally's Echoing Burst is cut to 0 and bursts at once`, () => {
            // The cut bursts everything the ally gathered up to that moment: the seeded 50,000.
            // The hit that set off the cut landed on Heliodor, so it is not part of it. It bursts
            // once, and the damage is booked to the Echoing Burst's applier (the hitter), not the
            // cutter.
            expect(measure(side, passive())).toEqual({
                bursts: [{ round: 1, damage: 50_000, beforeHolderTurn: true }],
                hpLostAtCut: 50_000,
                applierCredit: 50_000,
            });
        });
    }
});

/** Which entry is applied first, as its `appliedSeq`. */
type Order = 'bomb-first' | 'burst-first';
const seqs = (order: Order): { bomb: number; burst: number } =>
    order === 'bomb-first' ? { bomb: 1, burst: 2 } : { bomb: 2, burst: 1 };
/** The holder's Bomb / Echoing Burst detonations and Cheat Death, in the order they happened. */
type HolderEvent = 'bomb' | 'burst' | 'cheat-death';
const recordHolderEvents = (
    bus: ReturnType<typeof createEventBus>,
    holderId: () => string,
    into: HolderEvent[]
): void => {
    bus.on(
        'cheat-death-activated',
        (e: Extract<CombatEvent, { type: 'cheat-death-activated' }>) => {
            if (e.actorId === holderId()) into.push('cheat-death');
        }
    );
    bus.on(
        'accumulator-detonated',
        (e: Extract<CombatEvent, { type: 'accumulator-detonated' }>) => {
            if (e.victimId === holderId()) into.push('burst');
        }
    );
    bus.on('bomb-detonated', (e: Extract<CombatEvent, { type: 'bomb-detonated' }>) => {
        if (e.victimId === holderId()) into.push('bomb');
    });
};
const hayyanSpec: ShipSpec = {
    id: 'hayyan',
    position: 'M2',
    speed: 300,
    chargeCount: 4,
    startCharged: true,
    skills: { slots: realSlots('Hayyan', ['active', 'charged']) },
};
/** A Bomb that kills a 40,000-HP holder on its own. */
const lethalBomb = (sourceId: string, appliedSeq: number): PendingBomb => ({
    ...bomb(sourceId),
    countdown: 1,
    damagePerStack: 60_000,
    appliedSeq,
});

describe('a Bomb and an Echoing Burst one duration cut drives to 0 go off in order of application', () => {
    const heliodor: ShipSpec = {
        id: 'heliodor',
        position: 'M4',
        speed: 200,
        hp: 1e9,
        skills: {
            slots: [{ slot: 'active', abilities: [] }, ...realSlots('Heliodor', ['passive'])],
        },
    };
    const holder: ShipSpec = { id: 'holder', position: 'M3', speed: 1, hp: 40_000 };
    const hitter: ShipSpec = { id: 'hitter', position: 'M4', speed: 100, attack: 100, skills: HIT };
    interface Measured {
        events: HolderEvent[];
        hpAtCut: number;
        aliveAtCut: boolean;
        bombsAtCut: number;
        burstsHeldAtCut: number;
    }
    const measure = (
        side: 'player' | 'enemy',
        order: Order,
        withCheatDeath: boolean,
        holderHp = holder.hp
    ): Measured => {
        const out: Measured = {
            events: [],
            hpAtCut: -1,
            aliveAtCut: false,
            bombsAtCut: -1,
            burstsHeldAtCut: -1,
        };
        runBoard(
            {
                caster: [
                    heliodor,
                    { ...holder, hp: holderHp },
                    ...(withCheatDeath ? [hayyanSpec] : []),
                ],
                other: [hitter],
            },
            side,
            (byId, idOf) => {
                const h = byId('holder');
                const seq = seqs(order);
                // Both sit one round from expiry, so the all-debuff cut drives both to 0.
                h.pendingBombs.push(lethalBomb(idOf('hitter'), seq.bomb));
                h.pendingAccumulators.push({
                    ...accumulator(idOf('hitter'), 1),
                    appliedSeq: seq.burst,
                });
            },
            (bus, byId, idOf) => {
                recordHolderEvents(bus, () => idOf('holder'), out.events);
                bus.on(
                    'reactive-cleanse-performed',
                    (e: Extract<CombatEvent, { type: 'reactive-cleanse-performed' }>) => {
                        if (e.mode !== 'reduce-duration' || out.hpAtCut >= 0) return;
                        if (!e.perTarget.some((t) => t.targetId === idOf('holder'))) return;
                        const h = byId('holder');
                        out.hpAtCut = h.currentHp;
                        out.aliveAtCut = h.destroyedRound === undefined;
                        out.bombsAtCut = h.pendingBombs.length;
                        out.burstsHeldAtCut = h.pendingAccumulators.length;
                    }
                );
            }
        );
        return out;
    };
    for (const side of SIDES) {
        it(`${side}-side: Bomb applied first → it detonates, Cheat Death wipes the Echoing Burst`, () => {
            expect(measure(side, 'bomb-first', true)).toEqual({
                events: ['bomb', 'cheat-death'],
                hpAtCut: 1,
                aliveAtCut: true,
                bombsAtCut: 0,
                burstsHeldAtCut: 0,
            });
        });
        it(`${side}-side: Echoing Burst applied first → it bursts, Cheat Death wipes the Bomb`, () => {
            expect(measure(side, 'burst-first', true)).toEqual({
                events: ['burst', 'cheat-death'],
                hpAtCut: 1,
                aliveAtCut: true,
                bombsAtCut: 0,
                burstsHeldAtCut: 0,
            });
        });
        it(`${side}-side control: without Cheat Death the same cut kills the holder`, () => {
            const m = measure(side, 'bomb-first', false);
            expect(m.events).not.toContain('cheat-death');
            expect(m.aliveAtCut).toBe(false);
        });
        for (const order of ['bomb-first', 'burst-first'] as const) {
            it(`${side}-side control (${order}): a survivable pair both go off, in that order`, () => {
                // HP to spare: both the cut drove to 0 detonate, so a missing one under Cheat
                // Death is the wipe, not an entry that could never go off.
                expect(measure(side, order, false, 1e9).events).toEqual(
                    order === 'bomb-first' ? ['bomb', 'burst'] : ['burst', 'bomb']
                );
            });
        }
    }
});

describe('Bombs and Echoing Bursts expiring at the same turn start go off in order of application', () => {
    const anchor: ShipSpec = { id: 'anchor', position: 'M4', speed: 200, hp: 1e9 };
    const holder: ShipSpec = { id: 'holder', position: 'M3', speed: 1, hp: 40_000 };
    const hitter: ShipSpec = { id: 'hitter', position: 'M4', speed: 100, attack: 100, skills: HIT };
    const measure = (
        side: 'player' | 'enemy',
        seed: (h: CombatActor, applier: string) => void,
        opts: { withCheatDeath?: boolean; holderHp?: number } = {}
    ): { events: HolderEvent[]; bombDamages: number[] } => {
        const events: HolderEvent[] = [];
        const bombDamages: number[] = [];
        runBoard(
            {
                caster: [
                    anchor,
                    { ...holder, hp: opts.holderHp ?? 1e9 },
                    ...(opts.withCheatDeath ? [hayyanSpec] : []),
                ],
                other: [hitter],
            },
            side,
            (byId, idOf) => seed(byId('holder'), idOf('hitter')),
            (bus, _byId, idOf) => {
                recordHolderEvents(bus, () => idOf('holder'), events);
                bus.on('bomb-detonated', (e: Extract<CombatEvent, { type: 'bomb-detonated' }>) => {
                    if (e.victimId === idOf('holder')) bombDamages.push(e.damage);
                });
            }
        );
        return { events, bombDamages };
    };
    const seedPair =
        (order: Order, lethal: boolean) =>
        (h: CombatActor, applier: string): void => {
            const seq = seqs(order);
            h.pendingBombs.push(
                lethal
                    ? lethalBomb(applier, seq.bomb)
                    : { ...bomb(applier), countdown: 1, appliedSeq: seq.bomb }
            );
            h.pendingAccumulators.push({ ...accumulator(applier, 1), appliedSeq: seq.burst });
        };
    for (const side of SIDES) {
        it(`${side}-side: Bomb applied first → the Bomb, then the Echoing Burst`, () => {
            expect(measure(side, seedPair('bomb-first', false)).events).toEqual(['bomb', 'burst']);
        });
        it(`${side}-side: Echoing Burst applied first → the Echoing Burst, then the Bomb`, () => {
            expect(measure(side, seedPair('burst-first', false)).events).toEqual(['burst', 'bomb']);
        });
        it(`${side}-side: under Cheat Death the first applied goes off and wipes the other`, () => {
            const opts = { withCheatDeath: true, holderHp: 40_000 };
            expect(measure(side, seedPair('bomb-first', true), opts).events).toEqual([
                'bomb',
                'cheat-death',
            ]);
            expect(measure(side, seedPair('burst-first', true), opts).events).toEqual([
                'burst',
                'cheat-death',
            ]);
        });
        it(`${side}-side: two Bombs expiring together detonate oldest first`, () => {
            // The 1,000 Bomb is applied first and sits first in the container; the 2,000 one is
            // applied second. Then the reverse container order, same application order.
            const one = (applier: string): PendingBomb => ({
                ...bomb(applier),
                countdown: 1,
                appliedSeq: 1,
            });
            const two = (applier: string): PendingBomb => ({
                ...bomb(applier),
                countdown: 1,
                damagePerStack: 2000,
                appliedSeq: 2,
            });
            expect(
                measure(side, (h, a) => h.pendingBombs.push(one(a), two(a))).bombDamages
            ).toEqual([1000, 2000]);
            expect(
                measure(side, (h, a) => h.pendingBombs.push(two(a), one(a))).bombDamages
            ).toEqual([1000, 2000]);
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

    // The holder's own burst is the lethal blow. Cheat Death fires on the first burst and wipes
    // the holder's Bombs / accumulators while the burst loop is still walking them; the wiped
    // second entry must not detonate, so the holder survives the turn at 1 HP.
    describe('a lethal burst of the holder’s own Bomb or Echoing Burst triggers it mid-burst', () => {
        const planter: ShipSpec = { id: 'planter', position: 'M4', speed: 100, hp: 1e9 };
        interface Burst {
            cheatDeath: boolean;
            detonations: number;
            hpAfterTurn: number;
            alive: boolean;
            bombs: number;
            accumulators: number;
        }
        const measureBurst = (side: 'player' | 'enemy', kind: 'bomb' | 'accumulator'): Burst => {
            const out: Burst = {
                cheatDeath: false,
                detonations: 0,
                hpAfterTurn: -1,
                alive: false,
                bombs: -1,
                accumulators: -1,
            };
            runBoard(
                { caster: [planter], other: [x, hayyan] },
                side,
                (byId, idOf) => {
                    const h = byId('x');
                    const src = idOf('planter');
                    for (let i = 0; i < 2; i++) {
                        if (kind === 'bomb')
                            h.pendingBombs.push({
                                ...bomb(src),
                                countdown: 1,
                                damagePerStack: 1e6,
                            });
                        else
                            h.pendingAccumulators.push({
                                ...accumulator(src, 1),
                                accumulated: 1e6,
                            });
                    }
                },
                (bus, byId, idOf) => {
                    bus.on(
                        'cheat-death-activated',
                        (e: Extract<CombatEvent, { type: 'cheat-death-activated' }>) => {
                            if (e.actorId === idOf('x')) out.cheatDeath = true;
                        }
                    );
                    bus.on(
                        'bomb-detonated',
                        (e: Extract<CombatEvent, { type: 'bomb-detonated' }>) => {
                            if (e.victimId === idOf('x')) out.detonations += 1;
                        }
                    );
                    bus.on(
                        'accumulator-detonated',
                        (e: Extract<CombatEvent, { type: 'accumulator-detonated' }>) => {
                            if (e.victimId === idOf('x')) out.detonations += 1;
                        }
                    );
                    bus.on('turn-ended', (e: Extract<CombatEvent, { type: 'turn-ended' }>) => {
                        if (e.actorId !== idOf('x') || e.round !== 1) return;
                        const h = byId('x');
                        out.hpAfterTurn = h.currentHp;
                        out.alive = h.destroyedRound === undefined;
                        out.bombs = h.pendingBombs.length;
                        out.accumulators = h.pendingAccumulators.length;
                    });
                }
            );
            return out;
        };
        for (const side of SIDES) {
            for (const kind of ['bomb', 'accumulator'] as const) {
                it(`${side}-side: two lethal ${kind}s → Cheat Death on the first, the wiped second never detonates, 1 HP`, () => {
                    expect(measureBurst(side, kind)).toEqual({
                        cheatDeath: true,
                        detonations: 1,
                        hpAfterTurn: 1,
                        alive: true,
                        bombs: 0,
                        accumulators: 0,
                    });
                });
            }
        }
    });
});

describe('an Echoing Burst gathers only the direct damage dealt to the ship it is on', () => {
    // Tooltip: "Accumulates direct damage dealt and deals 100% of the damage upon expiration".
    // The holder sits at M3 behind a front ship at M4; a 'back' hitter reaches only the holder and
    // a 'front' hitter only the front ship.
    const front: ShipSpec = { id: 'front', position: 'M4', speed: 1, hp: 1e9 };
    const holder: ShipSpec = { id: 'holder', position: 'M3', speed: 1, hp: 1e9 };
    const hitter = (id: string, target: 'front' | 'back', attack: number, speed: number) =>
        ({
            id,
            position: target === 'front' ? 'M4' : 'M3',
            speed,
            attack,
            target,
            skills: HIT,
        }) as ShipSpec;
    const seeded = (sourceId: string, roundsRemaining: number): PendingAccumulator => ({
        roundsRemaining,
        pct: 100,
        accumulated: 0,
        sourceId,
    });
    interface Measured {
        bursts: { round: number; damage: number }[];
        dealt: Record<string, Record<string, number>>[];
    }
    const measure = (
        side: 'player' | 'enemy',
        teams: MirrorTeams,
        seed: (byId: (s: string) => CombatActor, idOf: (s: string) => string) => void
    ): Measured => {
        const bursts: Measured['bursts'] = [];
        const result = runBoard(teams, side, seed, (bus, _byId, idOf) => {
            bus.on(
                'accumulator-detonated',
                (e: Extract<CombatEvent, { type: 'accumulator-detonated' }>) => {
                    if (e.victimId === idOf('holder')) {
                        bursts.push({ round: e.round, damage: e.damage });
                    }
                }
            );
        });
        return {
            bursts,
            dealt: result.rounds.map((r) => r.perTargetDealt ?? {}),
        };
    };
    for (const side of SIDES) {
        it(`${side}-side: damage to another enemy never counts`, () => {
            // 1,000 lands on the front ship, 100 on the holder; the burst pays the 100 alone.
            const m = measure(
                side,
                {
                    caster: [front, holder],
                    other: [hitter('hf', 'front', 1000, 100), hitter('hb', 'back', 100, 90)],
                },
                (byId, idOf) => byId('holder').pendingAccumulators.push(seeded(idOf('hf'), 1))
            );
            const { idOf } = mirrorBoard(
                { caster: [front, holder], other: [hitter('hf', 'front', 1000, 100)] },
                side
            );
            // Anti-vacuity: each hitter reached only its own ship.
            expect(m.dealt[0][idOf('hf')]?.[idOf('front')]).toBe(1000);
            expect(m.dealt[0][idOf('hb')]?.[idOf('holder')]).toBe(100);
            expect(m.dealt[0][idOf('hb')]?.[idOf('front')]).toBeUndefined();
            expect(m.bursts).toEqual([{ round: 1, damage: 100 }]);
        });
        it(`${side}-side: a hit after the holder's turn counts at its natural expiry`, () => {
            // The holder acts first each round: round 1 its turn takes the duration 2 → 1, then
            // the hitter lands 100 on it; round 2 its turn bursts that 100.
            const m = measure(
                side,
                {
                    caster: [{ ...holder, speed: 150 }],
                    other: [hitter('hb', 'back', 100, 100)],
                    numRounds: 2,
                },
                (byId, idOf) => byId('holder').pendingAccumulators.push(seeded(idOf('hb'), 2))
            );
            expect(m.bursts).toEqual([{ round: 2, damage: 100 }]);
        });
    }
});

describe('an Echoing Burst a cut drives to 0 pays the same holder-only gather as its expiry', () => {
    // Heliodor (front) cuts every ally's debuffs when she is directly damaged. Round 1: the holder
    // acts first (2 → 1), the back hitter lands 100 on the holder, then the front hitter hits
    // Heliodor, and her cut takes the holder's Echoing Burst to 0.
    const heliodor = (skills: ShipSkills): ShipSpec => ({
        id: 'heliodor',
        position: 'M4',
        speed: 1,
        hp: 1e9,
        skills,
    });
    const holder: ShipSpec = { id: 'holder', position: 'M3', speed: 150, hp: 1e9 };
    const others: ShipSpec[] = [
        { id: 'hb', position: 'M3', speed: 100, attack: 100, target: 'back', skills: HIT },
        { id: 'hf', position: 'M4', speed: 50, attack: 100, target: 'front', skills: HIT },
    ];
    const passive = (): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [] }, ...realSlots('Heliodor', ['passive'])],
    });
    const bursts = (side: 'player' | 'enemy', skills: ShipSkills): number[][] => {
        const out: number[][] = [];
        runBoard(
            { caster: [heliodor(skills), holder], other: others, numRounds: 2 },
            side,
            (byId, idOf) =>
                byId('holder').pendingAccumulators.push({
                    roundsRemaining: 2,
                    pct: 100,
                    accumulated: 0,
                    sourceId: idOf('hb'),
                }),
            (bus, _byId, idOf) =>
                bus.on(
                    'accumulator-detonated',
                    (e: Extract<CombatEvent, { type: 'accumulator-detonated' }>) => {
                        if (e.victimId === idOf('holder')) out.push([e.round, e.damage]);
                    }
                )
        );
        return out;
    };
    for (const side of SIDES) {
        it(`${side}-side: the cut pays the hit on the holder after its turn, not the hit on Heliodor`, () => {
            expect(bursts(side, passive())).toEqual([[1, 100]]);
        });
        it(`${side}-side control: without the cut it bursts at round 2 for the same 100`, () => {
            expect(bursts(side, NO_SKILLS)).toEqual([[2, 100]]);
        });
    }
});

describe("damage dealt before Valkyrie's Echoing Burst lands never counts", () => {
    // An early hitter lands 100 on the holder; then Valkyrie (0 attack, so her own hits add
    // nothing) inflicts Echoing Burst for 2 turns with her charged skill. Round 2: the early
    // hitter hits again, then the holder's turn bursts what it gathered since the application.
    const holder: ShipSpec = { id: 'holder', position: 'M4', speed: 1, hp: 1e9 };
    const early: ShipSpec = { id: 'early', position: 'M3', speed: 300, attack: 100, skills: HIT };
    const valkyrie = (attack: number): ShipSpec => ({
        id: 'valkyrie',
        position: 'M4',
        speed: 200,
        attack,
        hacking: 1e6,
        chargeCount: 2,
        startCharged: true,
        skills: { slots: realSlots('Valkyrie', ['active', 'charged']) },
    });
    const measure = (side: 'player' | 'enemy', others: ShipSpec[]) => {
        const bursts: { round: number; damage: number; actorId: string }[] = [];
        const result = runBoard(
            { caster: [holder], other: others, numRounds: 2 },
            side,
            () => undefined,
            (bus, _byId, idOf) =>
                bus.on(
                    'accumulator-detonated',
                    (e: Extract<CombatEvent, { type: 'accumulator-detonated' }>) => {
                        if (e.victimId === idOf('holder')) {
                            bursts.push({ round: e.round, damage: e.damage, actorId: e.actorId });
                        }
                    }
                )
        );
        const { idOf } = mirrorBoard({ caster: [holder], other: others }, side);
        const dealtOn = (round: number, by: string): number =>
            result.rounds[round].perTargetDealt?.[idOf(by)]?.[idOf('holder')] ?? 0;
        return { bursts, dealtOn, idOf };
    };
    for (const side of SIDES) {
        it(`${side}-side: the early round-1 hit is left out; the round-2 hit is gathered`, () => {
            const m = measure(side, [early, valkyrie(0)]);
            expect(m.dealtOn(0, 'early')).toBe(100);
            const round2 = m.dealtOn(1, 'early');
            expect(round2).toBeGreaterThan(0);
            expect(m.bursts).toEqual([{ round: 2, damage: round2, actorId: m.idOf('valkyrie') }]);
        });
        it(`${side}-side: Valkyrie's own applying hit is gathered — the Echoing Burst lands before the cast's damage`, () => {
            // 1,000 attack: her charged hit (240%) applies it in round 1, her active (200%, with
            // Inc. Damage Up II on the holder) lands in round 2, then the holder's turn bursts.
            const m = measure(side, [valkyrie(1000)]);
            const round1 = m.dealtOn(0, 'valkyrie');
            expect(round1).toBe(2400);
            expect(m.bursts).toHaveLength(1);
            // Round 2's dealt holds her hit plus the burst itself.
            const round2Hit = m.dealtOn(1, 'valkyrie') - m.bursts[0].damage;
            expect(round2Hit).toBe(2600);
            expect(m.bursts[0].damage).toBe(round1 + round2Hit);
        });
    }
});
