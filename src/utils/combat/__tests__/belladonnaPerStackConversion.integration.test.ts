/**
 * Belladonna's "When an ally inflicts Corrosion, this Unit converts the Corrosion into Acidic
 * Decay of the same level, with the chance scaling at 1% per 10 Hacking" converts only the NEW
 * Corrosion, one roll per stack inflicted (owner ruling): Corrosion an enemy already holds is
 * never re-converted by a later infliction, and a 2-stack infliction rolls twice.
 *
 * Belladonna carries her real passive; her conversion chance is set by her hacking (1000 → 100%,
 * 500 → 50%, drawn from her own `${id}:convert` stream, read directly with `makeKeyedRng` to pick
 * a seed). A seeder ally inflicts Corrosion I on B. Run with Belladonna on both sides.
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
import type { ActiveDoTStack, CombatActor } from '../state';
import { realSlots } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});

const seederKit = (stacks: number): ShipSkills => ({
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
                    config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks, duration: 3 },
                },
            ],
        },
    ],
});

const plain = (sourceId: string, stacks = 1): ActiveDoTStack => ({
    stacks,
    tier: 3,
    remainingRounds: 5,
    sourceId,
});

interface Outcome {
    acidicDecay: number;
    corrosion: number;
    landed: string[];
}

const run = (
    placement: Placement,
    belladonna: BoardUnit,
    allies: BoardUnit[],
    seed: (id: (u: BoardUnit) => string) => number,
    seedOnB: (id: (u: BoardUnit) => string) => ActiveDoTStack[]
): Outcome => {
    const b: BoardUnit = { id: 'b', kit: NO_KIT, position: 'M4', speed: 1 };
    const { input, id } = boardInput(placement, belladonna, allies, [b], 1);
    setupKeyedRng(seed(id));
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
            victim?.corrosionEntries.push(...seedOnB(id));
        },
    });
    const stacks = (family: string | undefined) =>
        (victim?.corrosionEntries ?? [])
            .filter((e) => e.family === family)
            .reduce((n, e) => n + e.stacks, 0);
    return { acidicDecay: stacks('Acidic Decay'), corrosion: stacks(undefined), landed };
};

const passiveOnly = (hacking: number): BoardUnit => ({
    id: 'belladonna',
    kit: { slots: [{ slot: 'active', abilities: [] }, ...realSlots('Belladonna', ['passive'])] },
    position: 'M3',
    speed: 100,
    hacking,
});
const seeder = (stacks: number): BoardUnit => ({
    id: 'seeder',
    kit: seederKit(stacks),
    position: 'M4',
    speed: 300,
    attack: 1000,
    hacking: 1e6,
});

/** The first seed whose two draws on `belladonnaId`'s convert stream are `first`, `second`. */
const seedFor = (belladonnaId: string, first: boolean, second: boolean): number => {
    for (let seed = 1; seed < 10_000; seed++) {
        const draw = makeKeyedRng(seed);
        const key = `${belladonnaId}:convert`;
        if (draw(key) < 0.5 === first && draw(key) < 0.5 === second) return seed;
    }
    throw new Error('no seed found');
};

describe.each<Placement>(['player', 'enemy'])('Belladonna on the %s side', (placement) => {
    it('B holds 2 Corrosion from the seeder; its 3rd converts alone', () => {
        const r = run(
            placement,
            passiveOnly(1000),
            [seeder(1)],
            () => 1,
            (id) => [plain(id(seeder(1)), 2)]
        );
        expect(r.acidicDecay).toBe(1);
        expect(r.corrosion).toBe(2);
    });

    for (const [first, second] of [
        [true, false],
        [false, true],
    ] as const) {
        it(`a 2-stack Corrosion rolls once per stack: ${first ? 'hit' : 'miss'}, ${second ? 'hit' : 'miss'} → 1 Acidic Decay, 1 Corrosion`, () => {
            const belladonna = passiveOnly(500);
            const r = run(
                placement,
                belladonna,
                [seeder(2)],
                (id) => seedFor(id(belladonna), first, second),
                () => []
            );
            expect(r.acidicDecay).toBe(1);
            expect(r.corrosion).toBe(1);
        });
    }

    it("her charged's Acidic Decay count reads only the new stack, not held Corrosion", () => {
        // Charged: "inflicts Corrosion II for 2 turns. If the enemy has 3 or more Acidic Decay,
        // inflict Stasis for 1 turn." B holds 1 Acidic Decay and 2 of her own plain Corrosion; her
        // Corrosion II converts (100%) → 2 Acidic Decay, so no Stasis.
        const belladonna: BoardUnit = {
            id: 'belladonna',
            kit: realKit('Belladonna'),
            position: 'M3',
            speed: 100,
            attack: 1000,
            hacking: 1000,
            chargeCount: 3,
            startCharged: true,
        };
        const r = run(
            placement,
            belladonna,
            [],
            () => 1,
            (id) => [
                { ...plain(id(belladonna)), family: 'Acidic Decay', unremovable: true },
                plain(id(belladonna), 2),
            ]
        );
        expect(r.acidicDecay).toBe(2);
        expect(r.corrosion).toBe(2);
        expect(r.landed).not.toContain('Stasis');
    });
});
