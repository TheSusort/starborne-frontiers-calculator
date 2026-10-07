/**
 * Crocus's charged skill ("deals 250% damage and detonates Corrosion effects at 180% power")
 * detonates Acidic Decay and removes it (owner ruling): Acidic Decay counts as Corrosion in every
 * check, and unremovable protects it from cleanses and Cheat Death, not from a detonation.
 *
 * The holder carries one Acidic Decay — a Corrosion entry re-tagged by Belladonna's conversion —
 * seeded before anyone acts; Crocus casts her charged skill on her first turn. A control board
 * without the Acidic Decay shows the detonation is the Acidic Decay's. Both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
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

const crocus: ShipSpec = {
    id: 'crocus',
    position: 'M4',
    speed: 100,
    attack: 1000,
    chargeCount: 4,
    startCharged: true,
    skills: { slots: realSlots('Crocus', ['charged']) },
};
const x: ShipSpec = { id: 'x', position: 'M4', speed: 1, hp: 1e9 };

interface Measured {
    detonated: number;
    acidicAfter: number;
    cast: boolean;
}

const measure = (side: 'player' | 'enemy', withAcidic: boolean): Measured => {
    const out: Measured = { detonated: 0, acidicAfter: -1, cast: false };
    const { input, idOf } = mirrorBoard({ caster: [crocus], other: [x], numRounds: 1 }, side);
    const bus = createEventBus();
    let actors: CombatActor[] = [];
    const holder = (): CombatActor => {
        const a = actors.find((y) => y.id === idOf('x'));
        if (!a) throw new Error('x missing');
        return a;
    };
    bus.on('dot-detonated', (e: Extract<CombatEvent, { type: 'dot-detonated' }>) => {
        if (e.targetId === idOf('x')) out.detonated += e.damage;
    });
    bus.on('turn-ended', (e: Extract<CombatEvent, { type: 'turn-ended' }>) => {
        if (e.actorId !== idOf('crocus') || e.round !== 1) return;
        out.cast = true;
        out.acidicAfter = holder().corrosionEntries.filter(
            (c) => c.family === 'Acidic Decay'
        ).length;
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            actors = all;
            if (!withAcidic) return;
            holder().corrosionEntries.push({
                stacks: 1,
                tier: 6,
                remainingRounds: 3,
                sourceId: idOf('x'),
                family: 'Acidic Decay',
                unremovable: true,
            });
        },
    });
    return out;
};

describe("Crocus's charged detonation detonates and removes Acidic Decay", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: the Acidic Decay detonates and is gone after the cast`, () => {
            const control = measure(side, false);
            const m = measure(side, true);
            expect(m.cast).toBe(true);
            expect(control.detonated).toBe(0);
            expect(m.detonated).toBeGreaterThan(0);
            expect(m.acidicAfter).toBe(0);
        });
    }
});
