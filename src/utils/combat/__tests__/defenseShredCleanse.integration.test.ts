/**
 * Defense Shred is cleansable, one stack per cleansed debuff (owner ruling R44, 2026-10-05): an
 * enemy Enforcer has crit your Defender three times, so it carries 3 stacks of Defense Shred; your
 * Hayyan's "cleanses 1 debuff from all allies" takes one off (3 → 2). Each stack is one debuff in
 * the cleanse's newest-first pool (rulings 27/32), dated by when it was inflicted.
 *
 * Real parsed kits (buildTraceShip, refit 4): Enforcer's active ("attacks three times") and
 * passive ("When this Unit critically hits an enemy it inflicts Defense Shred"), Hayyan's active.
 * Enforcer crits every hit and lands every roll (crit 100, hacking 1e6).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { StatusEngine } from '../statusEngine';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(9));

const enforcer = (speed: number): ShipSpec => ({
    id: 'enforcer',
    position: 'M4',
    speed,
    attack: 100,
    crit: 100,
    critDamage: 0,
    hacking: 1e6,
    chargeCount: 99,
    skills: { slots: realSlots('Enforcer', ['active', 'passive']) },
});

const hayyan = (speed: number): ShipSpec => ({
    id: 'hayyan',
    position: 'M3',
    speed,
    chargeCount: 99,
    skills: { slots: realSlots('Hayyan', ['active']) },
});

const defender: ShipSpec = { id: 'x', position: 'M4', speed: 1, role: 'DEFENDER' };

interface Measured {
    /** x's Defense Shred stacks at the end of each round. */
    stacks: number[];
    /** Debuffs Hayyan's cleanses removed from x, per round. */
    cleansed: number[];
}

const measure = (teams: MirrorTeams, side: 'player' | 'enemy'): Measured => {
    const { input, idOf } = mirrorBoard(teams, side);
    const x = idOf('x');
    const healer = idOf('hayyan');
    const rounds = teams.numRounds ?? 1;
    const out: Measured = { stacks: Array(rounds).fill(0), cleansed: Array(rounds).fill(0) };
    let engine: StatusEngine | undefined;
    const bus = createEventBus();
    bus.on('round-ended', (e: Extract<CombatEvent, { type: 'round-ended' }>) => {
        out.stacks[e.round - 1] =
            engine
                ?.timedAbilityStatuses('enemy', undefined, x)
                .find((s) => s.active.buffName === 'Defense Shred')?.active.stacks ?? 0;
    });
    bus.on('cleanse-performed', (e: Extract<CombatEvent, { type: 'cleanse-performed' }>) => {
        if (e.casterId !== healer) return;
        // x is the only ship carrying a debuff, so the cast's count is x's.
        if (e.targets?.includes(x)) out.cleansed[e.round - 1] += e.count;
    });
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (se) => {
            engine = se;
        },
    });
    return out;
};

describe('Defense Shred is cleansed one stack per cleansed debuff (R44)', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: 3 stacks, then "cleanses 1 debuff" → 2`, () => {
            const m = measure(
                { caster: [enforcer(200)], other: [defender, hayyan(100)], numRounds: 1 },
                side
            );
            expect(m.cleansed).toEqual([1]);
            expect(m.stacks).toEqual([2]);
        });
        it(`${side}-side reverse board: the cleanse comes first each round → 3, then 5`, () => {
            // Round 1 Hayyan acts on a clean x; Enforcer then shreds 3. Round 2 Hayyan takes one
            // (3 → 2) before Enforcer adds 3 more.
            const m = measure(
                { caster: [enforcer(50)], other: [defender, hayyan(100)], numRounds: 2 },
                side
            );
            expect(m.cleansed).toEqual([0, 1]);
            expect(m.stacks).toEqual([3, 5]);
        });
        it(`${side}-side: no cleanser → the stacks stay`, () => {
            const m = measure({ caster: [enforcer(200)], other: [defender], numRounds: 2 }, side);
            expect(m.stacks).toEqual([3, 6]);
        });
    }
});
