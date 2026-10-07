/**
 * Belladonna's own Corrosion, converted in the same cast, counts for her charged skill's Acidic
 * Decay check (owner ruling R76, 2026-10-05 — the R47 shape applied to her).
 *
 * Charged: "This Unit deals 180% damage and inflicts Corrosion II for 2 turns. If the enemy has 3
 * or more Acidic Decay, inflict Stasis for 1 turn." Passive: "When an ally inflicts Corrosion, this
 * Unit converts the Corrosion into Acidic Decay of the same level, with the chance scaling at 1%
 * per 10 Hacking." The conversion happens as the Corrosion lands, before the Stasis clause reads
 * the count, and keeps its chance roll.
 *
 * Board: a seeder ally inflicts 2 Corrosion I stacks on B (one conversion roll per stack), then
 * Belladonna casts her charged on B (one Corrosion II stack, one more roll). Belladonna's hacking
 * is 500, so each roll is a 50% draw from her own `${id}:convert` stream. The seed is chosen by
 * reading that stream directly (`makeKeyedRng`), so each case names the draws it relies on: both
 * seeding rolls succeed (B at 2 Acidic Decay), and the cast's roll succeeds or fails.
 *
 * Run with Belladonna on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { makeKeyedRng, setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});

const RATE = 0.5;

/** The seeder's active: 2 stacks of Corrosion I (3 turns) on the front enemy. */
const seederKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'seed-corrosion',
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 2, duration: 3 },
                },
            ],
        },
    ],
});

const units = () => {
    const belladonna: BoardUnit = {
        id: 'belladonna',
        kit: realKit('Belladonna'),
        position: 'M3',
        speed: 100,
        attack: 1000,
        hacking: 500,
        chargeCount: 3,
        startCharged: true,
    };
    const seeder: BoardUnit = {
        id: 'seeder',
        kit: seederKit(),
        position: 'M4',
        speed: 300,
        attack: 1000,
        hacking: 1e6,
    };
    const b: BoardUnit = { id: 'b', kit: NO_KIT, position: 'M4', speed: 1 };
    return { belladonna, seeder, b };
};

/**
 * The first seed whose convert stream for `belladonnaId` gives the wanted outcomes: both seeding
 * rolls succeed, the cast's roll is `castConverts`, and the NEXT draw would say the opposite — so
 * a cast whose conversion drew twice (once for the gate, again when the reaction drains) ends with
 * a family count that disagrees with its Stasis.
 */
const seedFor = (belladonnaId: string, castConverts: boolean): number => {
    for (let seed = 1; seed < 10_000; seed++) {
        const draw = makeKeyedRng(seed);
        const key = `${belladonnaId}:convert`;
        const seeding = draw(key) < RATE && draw(key) < RATE;
        const cast = draw(key) < RATE;
        const next = draw(key) < RATE;
        if (seeding && cast === castConverts && next !== castConverts) return seed;
    }
    throw new Error('no seed found');
};

const run = (
    placement: Placement,
    castConverts: boolean
): { landed: string[]; acidicDecay: number; corrosion: number } => {
    const { belladonna, seeder, b } = units();
    const { input, id } = boardInput(placement, belladonna, [seeder], [b], 1);
    setupKeyedRng(seedFor(id(belladonna), castConverts));
    const bus = createEventBus();
    const landed: string[] = [];
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.targetId === id(b)) landed.push(e.buffName);
    });
    let victim: CombatActor | undefined;
    runCombat({
        ...input,
        bus,
        __testTapActors: (actors) => {
            victim = actors.find((x) => x.id === id(b));
        },
    });
    const stacks = (family: string | undefined) =>
        (victim?.corrosionEntries ?? [])
            .filter((e) => e.family === family)
            .reduce((n, e) => n + e.stacks, 0);
    return { landed, acidicDecay: stacks('Acidic Decay'), corrosion: stacks(undefined) };
};

describe.each<Placement>(['player', 'enemy'])('Belladonna on the %s side', (placement) => {
    it('B at 2 Acidic Decay, her Corrosion II lands and converts → 3 → Stasis', () => {
        const r = run(placement, true);
        expect(r.landed).toContain('Stasis');
        // The roll the gate read is the one the conversion spent: B ends at 3 Acidic Decay.
        expect(r.acidicDecay).toBe(3);
        expect(r.corrosion).toBe(0);
    });

    it('negative: the same cast with the conversion roll failing → B stays at 2, no Stasis', () => {
        const r = run(placement, false);
        expect(r.landed).not.toContain('Stasis');
        expect(r.acidicDecay).toBe(2);
        expect(r.corrosion).toBe(1);
    });
});

/**
 * A converter that cannot act does not convert, so its conversion cannot count for a same-cast
 * gate either. Board: Belladonna (100% conversion, hacking 1000) is the converter; an ally caster
 * inflicts one Corrosion I on B, then "inflict Stasis if B has 1 or more Acidic Decay". B, faster
 * than everyone, opens with Disable on Belladonna, or with nothing in the control.
 */
describe.each<Placement>(['player', 'enemy'])(
    'a disabled Belladonna on the %s side converts nothing',
    (placement) => {
        const casterKit: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'cast-corrosion',
                            type: 'dot',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 3,
                                stacks: 1,
                                duration: 3,
                            },
                        },
                        {
                            id: 'cast-stasis',
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [
                                {
                                    subject: 'enemy-dot-count',
                                    derivable: true,
                                    countComparator: 'gte',
                                    countThreshold: 1,
                                    buffName: 'Acidic Decay',
                                },
                            ],
                            config: {
                                type: 'debuff',
                                buffName: 'Stasis',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                duration: 1,
                                application: 'inflict',
                            },
                        },
                    ],
                },
            ],
        };
        const disableKit: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'open-disable',
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'debuff',
                                buffName: 'Disable',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                duration: 2,
                                application: 'apply',
                            },
                        },
                    ],
                },
            ],
        };
        const board = (bKit: ShipSkills) => {
            const belladonna: BoardUnit = {
                id: 'belladonna',
                kit: realKit('Belladonna'),
                position: 'M4',
                speed: 50,
                hacking: 1000,
            };
            const caster: BoardUnit = {
                id: 'caster',
                kit: casterKit,
                position: 'M3',
                speed: 100,
                attack: 1000,
                hacking: 1e6,
            };
            const b: BoardUnit = { id: 'b', kit: bKit, position: 'M4', speed: 500, hacking: 1e6 };
            const { input, id } = boardInput(placement, belladonna, [caster], [b], 1);
            setupKeyedRng(1);
            const bus = createEventBus();
            const landed: { on: string; name: string }[] = [];
            bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
                landed.push({ on: e.targetId, name: e.buffName });
            });
            let victim: CombatActor | undefined;
            runCombat({
                ...input,
                bus,
                __testTapActors: (actors) => {
                    victim = actors.find((x) => x.id === id(b));
                },
            });
            const acidicDecay = (victim?.corrosionEntries ?? [])
                .filter((e) => e.family === 'Acidic Decay')
                .reduce((n, e) => n + e.stacks, 0);
            return {
                disabledBelladonna: landed.some(
                    (l) => l.on === id(belladonna) && l.name === 'Disable'
                ),
                stasisOnB: landed.some((l) => l.on === id(b) && l.name === 'Stasis'),
                acidicDecay,
            };
        };

        it('control: Belladonna free → the Corrosion converts and the Stasis gate opens', () => {
            const r = board(NO_KIT);
            expect(r.acidicDecay).toBeGreaterThanOrEqual(1);
            expect(r.stasisOnB).toBe(true);
        });

        it('Belladonna disabled → no conversion, and the Stasis gate stays shut', () => {
            const r = board(disableKit);
            expect(r.disabledBelladonna).toBe(true);
            expect(r.acidicDecay).toBe(0);
            expect(r.stasisOnB).toBe(false);
        });
    }
);
