/**
 * Toxic Overflow's end-of-round spread is an infliction (owner ruling): "At the end of the round
 * if a unit has Toxic Overflow and at least 1 stack of Corrosion, inflict Corrosion I for 3 turns
 * to all adjacent allies and remove Toxic Overflow." Each spread Corrosion is inflicted by the
 * ship that applied the Toxic Overflow (Hemlock): it rolls Hemlock's hacking against the
 * recipient's security, a resisted one lands nothing, and a landed one is heard by every reaction
 * to an inflicted debuff or Corrosion — Belladonna converts it, Provider strikes. Hemlock's "When
 * Corrosion spreads this Unit repairs 5% of its max HP per enemy affected" counts the enemies it
 * landed on.
 *
 * Board: Hemlock (M4, hacking 1000) lands Toxic Overflow on A (M4) with her active; A holds a
 * seeded Corrosion. A's neighbours B (M3, security 0) and C (T3, security 1e9) are the spread's
 * recipients. Provider and Belladonna (hacking 1000 → 100% conversion) ride on Hemlock's side.
 * Both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { TOXIC_OVERFLOW, SPREAD_CORROSION_TIER } from '../../../constants/toxicOverflow';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import { mirrorBoard, realSlots, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(11));

const HEMLOCK_HP = 1_000_000;

const noop: Ability = {
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
};

const toxicOverflow = (): Ability => {
    const found = realSlots('Hemlock', ['charged'])[0].abilities.find(
        (a) => a.config.type === 'debuff' && a.config.buffName.startsWith(TOXIC_OVERFLOW)
    );
    if (!found) throw new Error('Hemlock charged carries no Toxic Overflow');
    return found;
};

interface Measured {
    spreadAffected: string[];
    spreadOnB: { sourceId: string; tier: number; family?: string }[];
    corrosionCountOnB: number;
    spreadOnC: number;
    resistedOnC: boolean;
    /** Hemlock's resists on B at the round end: whether each drew a landing roll. */
    resistsOnB: boolean[];
    providerOnB: number;
    hemlockRepair: number;
}

/** A recurring `Block Debuff` self-buff, active before the round ends. */
const blockDebuffSkills = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'block-debuff-self',
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Block Debuff',
                        stacks: 1,
                        isStackable: false,
                        duration: 'recurring',
                        parsedEffects: {},
                    },
                },
            ],
        },
    ],
});

interface BoardOpts {
    withProvider?: boolean;
    /** B carries Block Debuff and C's security drops to 0. */
    blockOnB?: boolean;
}

const measure = (side: 'player' | 'enemy', board: boolean | BoardOpts): Measured => {
    const opts: BoardOpts = typeof board === 'boolean' ? { withProvider: board } : board;
    const withProvider = opts.withProvider === true;
    const blockOnB = opts.blockOnB === true;
    const hemlock: ShipSpec = {
        id: 'hemlock',
        position: 'M4',
        speed: 1000,
        hp: HEMLOCK_HP,
        hacking: 1000,
        skills: {
            slots: [
                { slot: 'active', abilities: [noop, toxicOverflow()] },
                ...realSlots('Hemlock', ['passive']),
            ],
        },
    };
    const provider: ShipSpec = {
        id: 'provider',
        position: 'M3',
        speed: 2,
        attack: 1000,
        skills: {
            slots: [{ slot: 'active', abilities: [] }, ...realSlots('Provider', ['passive'])],
        },
    };
    const belladonna: ShipSpec = {
        id: 'belladonna',
        position: 'T3',
        speed: 2,
        hacking: 1000,
        skills: {
            slots: [{ slot: 'active', abilities: [] }, ...realSlots('Belladonna', ['passive'])],
        },
    };
    const a: ShipSpec = { id: 'a', position: 'M4', speed: 1, hp: 1e9, security: 0 };
    const b: ShipSpec = {
        id: 'b',
        position: 'M3',
        speed: 1,
        hp: 1e9,
        security: 0,
        ...(blockOnB ? { skills: blockDebuffSkills() } : {}),
    };
    const c: ShipSpec = {
        id: 'c',
        position: 'T3',
        speed: 1,
        hp: 1e9,
        security: blockOnB ? 0 : 1e9,
    };
    const teams = {
        caster: withProvider ? [hemlock, belladonna, provider] : [hemlock, belladonna],
        other: [a, b, c],
        numRounds: 1,
    };
    const { input, idOf } = mirrorBoard(teams, side);
    const bus = createEventBus();
    const out: Measured = {
        spreadAffected: [],
        spreadOnB: [],
        corrosionCountOnB: 0,
        spreadOnC: 0,
        resistedOnC: false,
        resistsOnB: [],
        providerOnB: 0,
        hemlockRepair: 0,
    };
    let actors: CombatActor[] = [];
    let roundEnding = false;
    bus.on('corrosion-spread', (e: Extract<CombatEvent, { type: 'corrosion-spread' }>) => {
        if (e.sourceId === idOf('a')) out.spreadAffected = [...e.affectedIds].sort();
    });
    bus.on('turn-ended', (e: Extract<CombatEvent, { type: 'turn-ended' }>) => {
        // Every ship has acted once A's (the last) turn ends: what lands after is the spread.
        if (e.actorId === idOf('a')) roundEnding = true;
    });
    bus.on('debuff-resisted', (e: Extract<CombatEvent, { type: 'debuff-resisted' }>) => {
        if (roundEnding && e.targetId === idOf('c') && e.sourceId === idOf('hemlock'))
            out.resistedOnC = true;
        if (roundEnding && e.targetId === idOf('b') && e.sourceId === idOf('hemlock'))
            out.resistsOnB.push(e.viaLandingRoll === true);
    });
    bus.on('reactive-heal-performed', (e) => {
        if (e.casterId === idOf('hemlock')) out.hemlockRepair += e.amount;
    });
    const result = runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            actors = all;
            actors
                .find((x) => x.id === idOf('a'))!
                .corrosionEntries.push({
                    stacks: 1,
                    tier: 6,
                    remainingRounds: 9,
                    sourceId: idOf('a'),
                });
        },
    });
    // Read after the fight (one round): the end-of-round reactions have drained.
    const byId = (spec: string) => actors.find((x) => x.id === idOf(spec))!;
    out.spreadOnB = byId('b')
        .corrosionEntries.filter((x) => x.tier === SPREAD_CORROSION_TIER)
        .map((x) => ({ sourceId: x.sourceId, tier: x.tier, family: x.family }));
    out.corrosionCountOnB = byId('b').corrosionEntries.length;
    out.spreadOnC = byId('c').corrosionEntries.length;
    out.providerOnB = withProvider
        ? (result.rounds[0].perTargetDealt?.[idOf('provider')]?.[idOf('b')] ?? 0)
        : 0;
    out.spreadAffected = out.spreadAffected.map((id) =>
        id === idOf('b') ? 'b' : id === idOf('c') ? 'c' : id
    );
    out.spreadOnB = out.spreadOnB.map((x) => ({
        ...x,
        sourceId: x.sourceId === idOf('hemlock') ? 'hemlock' : x.sourceId,
    }));
    return out;
};

describe("Toxic Overflow's spread is Hemlock's infliction", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: B takes Hemlock's Corrosion I; high-security C resists it`, () => {
            const m = measure(side, false);
            expect(m.spreadOnC).toBe(0);
            expect(m.resistedOnC).toBe(true);
            expect(m.spreadAffected).toEqual(['b']);
            expect(m.spreadOnB).toHaveLength(1);
            expect(m.spreadOnB[0].sourceId).toBe('hemlock');
        });

        it(`${side}-side: Belladonna converts the spread Corrosion into Acidic Decay`, () => {
            const m = measure(side, false);
            expect(m.spreadOnB[0]?.family).toBe('Acidic Decay');
        });

        it(`${side}-side: Provider strikes B when the spread lands`, () => {
            expect(measure(side, true).providerOnB).toBeGreaterThan(0);
        });

        it(`${side}-side: Hemlock repairs 5% for the one enemy the spread landed on`, () => {
            expect(measure(side, false).hemlockRepair).toBeCloseTo(HEMLOCK_HP * 0.05, 4);
        });

        it(`${side}-side: Block Debuff on B blocks the spread; B is not counted as affected`, () => {
            const m = measure(side, { blockOnB: true });
            expect(m.corrosionCountOnB).toBe(0);
            // A Block Debuff resist draws no landing roll.
            expect(m.resistsOnB).toEqual([false]);
            expect(m.spreadAffected).toEqual(['c']);
            expect(m.hemlockRepair).toBeCloseTo(HEMLOCK_HP * 0.05, 4);
        });
    }
});

/**
 * The end-of-round spread is a root cast of its own, not part of Hemlock's skill cast that round.
 * Hemlock's active lands Toxic Overflow on A: Oleander gains one charge and APEX one shield for
 * that cast. At the round end the spread lands Corrosion I on B and C: one more charge and one
 * more shield for the spread, however many enemies it reached.
 */
const measureRoot = (side: 'player' | 'enemy') => {
    const hemlock: ShipSpec = {
        id: 'hemlock',
        position: 'M4',
        speed: 1000,
        hp: HEMLOCK_HP,
        hacking: 1000,
        skills: { slots: [{ slot: 'active', abilities: [noop, toxicOverflow()] }] },
    };
    const oleander: ShipSpec = {
        id: 'oleander',
        position: 'M3',
        speed: 2,
        // A charge cap far above the grants under test, so no charged cast muddies the count.
        chargeCount: 99,
        skills: {
            slots: [{ slot: 'active', abilities: [] }, ...realSlots('Oleander', ['passive'])],
        },
    };
    const apex: ShipSpec = {
        id: 'apex',
        position: 'T3',
        speed: 2,
        hp: 1_000_000,
        skills: {
            slots: [{ slot: 'active', abilities: [] }, ...realSlots('APEX', ['passive'])],
        },
    };
    const a: ShipSpec = { id: 'a', position: 'M4', speed: 1, hp: 1e9, security: 0 };
    const b: ShipSpec = { id: 'b', position: 'M3', speed: 1, hp: 1e9, security: 0 };
    const c: ShipSpec = { id: 'c', position: 'T3', speed: 1, hp: 1e9, security: 0 };
    const { input, idOf } = mirrorBoard(
        { caster: [hemlock, oleander, apex], other: [a, b, c], numRounds: 1 },
        side
    );
    const bus = createEventBus();
    let charges = 0;
    let shields = 0;
    let spreadLanded = 0;
    let roundEnding = false;
    bus.on('turn-ended', (e: Extract<CombatEvent, { type: 'turn-ended' }>) => {
        if (e.actorId === idOf('a')) roundEnding = true;
    });
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (e.actorId === idOf('oleander') && e.reason === 'manip')
            charges += e.newCharge - e.oldCharge;
    });
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        if (e.granterId === idOf('apex')) shields++;
    });
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        if (roundEnding && e.sourceId === idOf('hemlock')) spreadLanded++;
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            all.find((x) => x.id === idOf('a'))!.corrosionEntries.push({
                stacks: 1,
                tier: 6,
                remainingRounds: 9,
                sourceId: idOf('a'),
            });
        },
    });
    return { charges, shields, spreadLanded };
};

describe("Toxic Overflow's spread is its own root cast", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: Oleander and APEX answer Hemlock's cast and then the spread`, () => {
            const m = measureRoot(side);
            // Instrument: the spread landed on both of A's neighbours.
            expect(m.spreadLanded).toBe(2);
            expect(m.charges).toBe(2);
            expect(m.shields).toBe(2);
        });
    }
});
