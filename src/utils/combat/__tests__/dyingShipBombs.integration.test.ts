/**
 * Every Bomb on a dying ship still detonates and splashes, and every reaction to a lethal burst
 * still fires (owner ruling). Two Bombs that go off together where the first is lethal both
 * detonate on the holder and both splash its adjacent allies, once each. An Echoing Burst that is
 * lethal before a later-applied Bomb bursts, then the Bomb detonates and splashes. A Cheat Death
 * is different: it leaves 1 HP and wipes the rest (`echoingBurstIsADebuff.integration`).
 *
 * The board: the holder at M3 (40,000 HP) with one adjacent ally at M2 that nobody hits, so the
 * applier's damage dealt to that ally is exactly the splash it took. The Bombs and the Echoing
 * Burst are seeded onto the holder before anyone acts; their applier has no skills. Each path a
 * Bomb can go off by is covered: its natural expiry, Heliodor's cut of every debuff, Lingshe's
 * cut of every Bomb, and Demolisher's detonation. Real parsed kits (buildTraceShip on
 * docs/ship-skills.csv, refit 4). Every case runs with the holder's team on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { splashDamageForBomb } from '../bombSplash';
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

const bomb = (
    sourceId: string,
    damagePerStack: number,
    appliedSeq: number,
    countdown = 1
): PendingBomb => ({
    countdown,
    damagePerStack,
    stacks: 1,
    tier: 100,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
    appliedSeq,
});

const lethalBurst = (sourceId: string, appliedSeq: number): PendingAccumulator => ({
    roundsRemaining: 1,
    pct: 100,
    accumulated: 1e6,
    sourceId,
    appliedSeq,
});

interface Measured {
    /** The holder's Bomb / Echoing Burst detonations, in order, with their damage. */
    events: string[];
    /** `ship-destroyed` events for the holder. */
    destroyed: number;
    /** The applier's damage dealt to the adjacent ally — the splash it took. */
    splash: number;
}

const run = (
    side: 'player' | 'enemy',
    teams: MirrorTeams,
    seed: (holder: CombatActor, applierId: string) => void,
    listen?: (bus: ReturnType<typeof createEventBus>, idOf: (s: string) => string) => void
): Measured => {
    const { input, idOf } = mirrorBoard(teams, side);
    const bus = createEventBus();
    const out: Measured = { events: [], destroyed: 0, splash: 0 };
    bus.on('bomb-detonated', (e: Extract<CombatEvent, { type: 'bomb-detonated' }>) => {
        if (e.victimId === idOf('holder')) out.events.push(`bomb ${e.damage}`);
    });
    bus.on(
        'accumulator-detonated',
        (e: Extract<CombatEvent, { type: 'accumulator-detonated' }>) => {
            if (e.victimId === idOf('holder')) out.events.push(`burst ${e.damage}`);
        }
    );
    bus.on('ship-destroyed', (e: Extract<CombatEvent, { type: 'ship-destroyed' }>) => {
        if (e.actorId === idOf('holder')) out.destroyed += 1;
    });
    listen?.(bus, idOf);
    let actors: CombatActor[] = [];
    const result = runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            actors = all;
            const holder = actors.find((a) => a.id === idOf('holder'));
            if (!holder) throw new Error('holder missing');
            seed(holder, idOf('applier'));
        },
    });
    out.splash = result.rounds.reduce(
        (sum, r) => sum + (r.perTargetDealt?.[idOf('applier')]?.[idOf('adjacent')] ?? 0),
        0
    );
    return out;
};

const holder: ShipSpec = { id: 'holder', position: 'M3', speed: 1, hp: 40_000 };
const adjacent: ShipSpec = { id: 'adjacent', position: 'M2', speed: 2, hp: 1e9 };
const applier: ShipSpec = { id: 'applier', position: 'M4', speed: 3, skills: NO_SKILLS };
/** Splash of a tier-100 single-stack Bomb: 25% of its damage. */
const splashOf = (damagePerStack: number): number =>
    splashDamageForBomb(bomb('x', damagePerStack, 0));

describe('two Bombs going off together, the first lethal: both detonate and both splash once', () => {
    for (const side of SIDES) {
        for (const containerOrder of ['oldest-first', 'newest-first'] as const) {
            it(`${side}-side, natural expiry (${containerOrder} in the container)`, () => {
                const m = run(side, { caster: [holder, adjacent], other: [applier] }, (h, a) => {
                    const pair = [bomb(a, 60_000, 1), bomb(a, 70_000, 2)];
                    if (containerOrder === 'newest-first') pair.reverse();
                    h.pendingBombs.push(...pair);
                });
                expect(m).toEqual({
                    events: ['bomb 60000', 'bomb 70000'],
                    destroyed: 1,
                    splash: splashOf(60_000) + splashOf(70_000),
                });
            });
        }
        it(`${side}-side control: one Bomb not yet due splashes without detonating`, () => {
            const m = run(side, { caster: [holder, adjacent], other: [applier] }, (h, a) => {
                h.pendingBombs.push(bomb(a, 60_000, 1), bomb(a, 70_000, 2, 5));
            });
            expect(m).toEqual({
                events: ['bomb 60000'],
                destroyed: 1,
                splash: splashOf(60_000) + splashOf(70_000),
            });
        });
    }
});

describe('a lethal Echoing Burst, then a later-applied Bomb: the Bomb detonates and splashes', () => {
    for (const side of SIDES) {
        it(`${side}-side`, () => {
            const m = run(side, { caster: [holder, adjacent], other: [applier] }, (h, a) => {
                h.pendingAccumulators.push(lethalBurst(a, 1));
                h.pendingBombs.push(bomb(a, 1000, 2));
            });
            expect(m).toEqual({
                events: ['burst 1000000', 'bomb 1000'],
                destroyed: 1,
                splash: splashOf(1000),
            });
        });
    }
});

describe("Heliodor's cut of every debuff takes two Bombs to 0, the first lethal", () => {
    // Heliodor at M4 is hit by the hitter; her passive cuts every ally's debuffs by 1 turn.
    const heliodor: ShipSpec = {
        id: 'heliodor',
        position: 'M4',
        speed: 1,
        hp: 1e9,
        skills: {
            slots: [{ slot: 'active', abilities: [] }, ...realSlots('Heliodor', ['passive'])],
        },
    };
    const hitter: ShipSpec = {
        id: 'hitter',
        position: 'M4',
        speed: 100,
        attack: 100,
        skills: {
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
        },
    };
    for (const side of SIDES) {
        it(`${side}-side`, () => {
            const m = run(
                side,
                { caster: [heliodor, holder, adjacent], other: [hitter, applier] },
                (h, a) => h.pendingBombs.push(bomb(a, 60_000, 1), bomb(a, 70_000, 2))
            );
            expect(m).toEqual({
                events: ['bomb 60000', 'bomb 70000'],
                destroyed: 1,
                splash: splashOf(60_000) + splashOf(70_000),
            });
        });
    }
});

describe("Lingshe's cut of every Bomb takes two Bombs to 0, the first lethal", () => {
    // Lingshe's charged skill reduces every Bomb on its target by 1 turn. The holder is the
    // front ship here so she targets it; the adjacent ally sits behind it.
    const front: ShipSpec = { ...holder, position: 'M4' };
    const behind: ShipSpec = { ...adjacent, position: 'M3' };
    const lingshe: ShipSpec = {
        id: 'lingshe',
        position: 'M4',
        speed: 100,
        hacking: 1e6,
        chargeCount: 1,
        startCharged: true,
        skills: { slots: realSlots('Lingshe', ['active', 'charged']) },
    };
    for (const side of SIDES) {
        it(`${side}-side`, () => {
            const m = run(
                side,
                { caster: [front, behind], other: [lingshe, { ...applier, position: 'M3' }] },
                (h, a) => h.pendingBombs.push(bomb(a, 60_000, 1, 2), bomb(a, 70_000, 2, 2))
            );
            expect(m).toEqual({
                events: ['bomb 60000', 'bomb 70000'],
                destroyed: 1,
                splash: splashOf(60_000) + splashOf(70_000),
            });
        });
    }
});

describe("Demolisher's detonation of two Bombs is lethal: both splash once", () => {
    // Demolisher's charged skill detonates every Bomb on its target with 150% of their power, in
    // one burst. 1 attack, so its own hit is a scratch.
    const front: ShipSpec = { ...holder, position: 'M4' };
    const behind: ShipSpec = { ...adjacent, position: 'M3' };
    const demolisher = (skills: ShipSkills): ShipSpec => ({
        id: 'demolisher',
        position: 'M4',
        speed: 100,
        attack: 1,
        chargeCount: 3,
        startCharged: true,
        skills,
    });
    for (const side of SIDES) {
        it(`${side}-side`, () => {
            const m = run(
                side,
                {
                    caster: [front, behind],
                    other: [
                        demolisher({ slots: realSlots('Demolisher', ['active', 'charged']) }),
                        { ...applier, position: 'M3' },
                    ],
                },
                (h, a) => h.pendingBombs.push(bomb(a, 30_000, 1, 5), bomb(a, 30_000, 2, 5))
            );
            expect(m).toEqual({
                events: ['bomb 90000'],
                destroyed: 1,
                splash: 2 * splashOf(30_000),
            });
        });
    }
});

describe('reactions to a lethal burst still fire', () => {
    for (const side of SIDES) {
        it(`${side}-side: Valkyrie repairs on her own lethal Echoing Burst`, () => {
            const valkyrie: ShipSpec = {
                id: 'applier',
                position: 'M4',
                speed: 3,
                skills: {
                    slots: [
                        { slot: 'active', abilities: [] },
                        ...realSlots('Valkyrie', ['passive']),
                    ],
                },
            };
            const repairs: number[] = [];
            const m = run(
                side,
                { caster: [holder, adjacent], other: [valkyrie] },
                (h, a) => h.pendingAccumulators.push(lethalBurst(a, 1)),
                (bus, idOf) =>
                    bus.on(
                        'reactive-heal-performed',
                        (e: Extract<CombatEvent, { type: 'reactive-heal-performed' }>) => {
                            if (e.casterId === idOf('applier')) repairs.push(e.amount);
                        }
                    )
            );
            expect(m.events).toEqual(['burst 1000000']);
            expect(m.destroyed).toBe(1);
            expect(repairs.length).toBeGreaterThan(0);
            expect(repairs[0]).toBeGreaterThan(0);
        });
        it(`${side}-side: Demolisher's Bomb-explodes splash fires for both Bombs on a dying holder`, () => {
            // Its passive deals 100% of each exploding Bomb's damage to the holder's adjacent
            // enemies. The adjacent ally takes that on top of the death splash.
            const demolisher: ShipSpec = {
                id: 'demolisher',
                position: 'M3',
                speed: 4,
                skills: {
                    slots: [
                        { slot: 'active', abilities: [] },
                        ...realSlots('Demolisher', ['passive']),
                    ],
                },
            };
            const reactive: number[] = [];
            run(
                side,
                { caster: [holder, adjacent], other: [applier, demolisher] },
                (h, a) => h.pendingBombs.push(bomb(a, 60_000, 1), bomb(a, 70_000, 2)),
                (bus, idOf) =>
                    bus.on(
                        'reactive-damage-performed',
                        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
                            if (e.sourceId === idOf('demolisher')) reactive.push(e.amount);
                        }
                    )
            );
            expect(reactive).toHaveLength(2);
        });
    }
});
