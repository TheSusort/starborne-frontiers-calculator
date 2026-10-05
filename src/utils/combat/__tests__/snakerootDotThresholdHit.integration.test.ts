/**
 * Snakeroot's passive (refit 2+): "This Unit deals 120% damage for every 4 stacks of damage over
 * time inflicted onto a single enemy. This attack does not reduce Stasis." Owner rulings R43/R43b
 * (2026-10-05): a SEPARATE 120% hit, fired each time one enemy's TOTAL DoT stack count crosses a
 * multiple of 4. Stacks from any source count (an ally's 4th stack fires it), each enemy is
 * counted on its own, and one hit fires per multiple crossed (3 → 9 crosses 4 and 8: two hits).
 *
 * Board: Snakeroot and the "seeder" allies stand on one side, enemies A (front, M4) and B (M3)
 * on the other. Seeders act first, each inflicting a fixed number of Corrosion I stacks; their
 * hacking dwarfs every security, so every stack lands. The passive's hits are read off
 * `reactive-damage-performed` from Snakeroot.
 *
 * Run with Snakeroot on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern } from '../../targetingParser';
import {
    boardInput,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(43));

/** A seeder's active: `stacks` stacks of Corrosion I (3 turns), after a 2-turn Stasis when
 *  `stasis` is set. */
const corrosionKit = (stacks: number, stasis = false): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ...(stasis
                    ? [
                          {
                              id: 'seed-stasis',
                              type: 'debuff' as const,
                              target: 'enemy' as const,
                              trigger: 'on-cast' as const,
                              conditions: [],
                              config: {
                                  type: 'debuff' as const,
                                  buffName: 'Stasis',
                                  parsedEffects: {},
                                  stacks: 1,
                                  isStackable: false,
                                  duration: 2,
                                  application: 'inflict' as const,
                              },
                          },
                      ]
                    : []),
                {
                    id: `seed-${stacks}`,
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

/** Snakeroot's real passive with an empty active, so he never casts. The kit-level flags
 *  (`doesntBreakStasis`) come with it: the passive hit's Stasis exemption rides them. */
const snakerootPassiveOnly = (): ShipSkills => {
    const kit = realKit('Snakeroot');
    return {
        ...kit,
        slots: [
            { slot: 'active', abilities: [] },
            ...kit.slots.filter((s) => s.slot === 'passive'),
        ],
    };
};

interface Seeder {
    stacks: number;
    /** Line covers A and B; Base hits A alone. */
    line?: boolean;
    /** Inflict a 2-turn Stasis before the stacks. */
    stasis?: boolean;
}

const SEEDER_CELLS: Position[] = ['M4', 'T4', 'B4'];

/** Snakeroot's passive hits per enemy unit id ('a' / 'b'), plus his own cast's hit on A. */
const run = (
    placement: Placement,
    seeders: Seeder[],
    snakeroot: Partial<BoardUnit> = {}
): { procs: Record<string, number>; amounts: number[]; aDebuffsAtRoundEnd: string[] } => {
    const snake: BoardUnit = {
        id: 'snakeroot',
        kit: snakerootPassiveOnly(),
        position: 'M3',
        speed: 10,
        attack: 1000,
        hacking: 1e6,
        chargeCount: 99,
        ...snakeroot,
    };
    const allies: BoardUnit[] = seeders.map((s, i) => ({
        id: `seeder-${i}`,
        kit: corrosionKit(s.stacks, s.stasis),
        position: SEEDER_CELLS[i],
        speed: 300 - i * 10,
        attack: 1000,
        hacking: 1e6,
        ...(s.line ? { pattern: parsePattern('Pattern-Line-Range-1') } : {}),
    }));
    const a: BoardUnit = { id: 'a', kit: NO_KIT, position: 'M4', speed: 1 };
    const b: BoardUnit = { id: 'b', kit: NO_KIT, position: 'M3', speed: 1 };
    const { input, id } = boardInput(placement, snake, allies, [a, b], 1);
    const snakeId = id(snake);
    const unitOf = new Map([a, b].map((u) => [id(u), u.id]));
    const bus = createEventBus();
    const procs: Record<string, number> = {};
    const amounts: number[] = [];
    let aDebuffsAtRoundEnd: string[] = [];
    bus.on('status-snapshot', (e: Extract<CombatEvent, { type: 'status-snapshot' }>) => {
        if (e.actorId === id(a)) aDebuffsAtRoundEnd = e.debuffNames;
    });
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.sourceId !== snakeId) return;
            const unit = unitOf.get(e.targetId) ?? e.targetId;
            procs[unit] = (procs[unit] ?? 0) + 1;
            amounts.push(Math.round(e.amount));
        }
    );
    runCombat({ ...input, bus });
    return { procs, amounts, aDebuffsAtRoundEnd };
};

describe.each<Placement>(['player', 'enemy'])('Snakeroot on the %s side', (placement) => {
    it("an ally's 4th stack on A fires one 120% hit on A (R43b)", () => {
        const r = run(placement, [{ stacks: 4 }]);
        expect(r.procs).toEqual({ a: 1 });
        // 120% of attack 1000 against defence 0, no crit.
        expect(r.amounts).toEqual([1200]);
    });

    it('negative: 3 stacks cross nothing — no hit', () => {
        expect(run(placement, [{ stacks: 3 }]).procs).toEqual({});
    });

    it('3 → 9 crosses 4 and 8: two hits (R43b)', () => {
        expect(run(placement, [{ stacks: 3 }, { stacks: 6 }]).procs).toEqual({ a: 2 });
    });

    it('per enemy: a Line seeder brings A and B to 4 each → one hit on each', () => {
        expect(run(placement, [{ stacks: 4, line: true }]).procs).toEqual({ a: 1, b: 1 });
    });

    it("R43's example: his charged Line at A (6 stacks) and B (4 stacks) adds one hit, on A", () => {
        // Seeding: the Line seeder's 4 on A and B fires one hit on each; the second seeder's 2 more
        // on A cross nothing (A at 6). Then his charged lands 2 Corrosion II stacks on each: A
        // 6 → 8 crosses 8 (a hit), B 4 → 6 crosses nothing.
        const r = run(placement, [{ stacks: 4, line: true }, { stacks: 2 }], {
            kit: realKit('Snakeroot'),
            startCharged: true,
            chargeCount: 2,
            pattern: parsePattern('Pattern-Line-Range-1'),
        });
        expect(r.procs).toEqual({ a: 2, b: 1 });
    });

    it('"This attack does not reduce Stasis": A stays in Stasis after the hit', () => {
        // A tripwire for the rule that every hit shortens Stasis (R36/R40): Snakeroot's
        // exemption (`doesntBreakStasis`) must cover this hit too.
        const r = run(placement, [{ stacks: 4, stasis: true }]);
        expect(r.procs).toEqual({ a: 1 });
        expect(r.aDebuffsAtRoundEnd).toContain('Stasis');
    });

    it('reverse board: the Line seeder brings A and B to 4, then a Base seeder adds 4 to A alone', () => {
        expect(run(placement, [{ stacks: 4, line: true }, { stacks: 4 }]).procs).toEqual({
            a: 2,
            b: 1,
        });
    });
});
