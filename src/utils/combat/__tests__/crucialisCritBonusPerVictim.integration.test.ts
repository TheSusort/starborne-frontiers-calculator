/**
 * Crucialis's "deals 80% damage and, if a critical hit, deals an additional 90% damage" (charged:
 * 200% + 210%) is a crit bonus PER STRUCK ENEMY (AoE rulings 10/13): each enemy's bonus follows
 * the crit of ITS OWN hit, never the aimed enemy's.
 *
 * Real parsed active and charged skills (buildTraceShip, refit 4) on her
 * Line-from-centre-Range-1 pattern from M4, mounted on both sides: A at M4 is aimed, B at M3 is
 * covered (a covered cell takes half). Attack 1000, crit 50%, crit power 100%, no defence, so a
 * hit is (base + bonus if it crit) × (2 if it crit) × (½ if covered) × 1000:
 *   active  — A: 800 / 3400, B: 400 / 1700
 *   charged — A: 2000 / 8200, B: 1000 / 4100
 * Every round's crit pattern is read off the `attacked` events and the damage checked against it;
 * the board must show both mixed patterns (A crits alone, B crits alone) or the test proves nothing.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { mirrorBoard, realSlots, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(11));

const ROUNDS = 30;

const teams = (slot: 'active' | 'charged'): MirrorTeams => ({
    caster: [
        {
            id: 'crucialis',
            position: 'M4',
            attack: 1000,
            crit: 50,
            critDamage: 100,
            speed: 150,
            pattern: 'Pattern-Line-from-centre-Range-1',
            // The charged arm: one charge, so it fires every other round.
            ...(slot === 'charged'
                ? { chargeCount: 1, startCharged: true, hasChargedSkill: true }
                : {}),
            skills: { slots: realSlots('Crucialis', [slot]) },
        },
    ],
    other: [
        { id: 'e-A', position: 'M4', speed: 1, hp: 1e12 },
        { id: 'e-B', position: 'M3', speed: 1, hp: 1e12 },
    ],
    numRounds: ROUNDS,
});

interface Hit {
    crit: boolean;
    damage: number;
}

const run = (slot: 'active' | 'charged', side: 'player' | 'enemy') => {
    const { input, idOf } = mirrorBoard(teams(slot), side);
    const caster = idOf('crucialis');
    const a = idOf('e-A');
    const b = idOf('e-B');
    const bus = createEventBus();
    const byRound = new Map<number, { A?: Hit; B?: Hit }>();
    bus.on('attacked', (e) => {
        if (e.attackerId !== caster) return;
        const row = byRound.get(e.round) ?? {};
        const hit = { crit: e.didCrit === true, damage: Math.round(e.damage ?? 0) };
        if (e.targetId === a) row.A = hit;
        if (e.targetId === b) row.B = hit;
        byRound.set(e.round, row);
    });
    runCombat({ ...input, bus });
    return [...byRound.values()];
};

const EXPECT = {
    active: { A: [800, 3400], B: [400, 1700] },
    charged: { A: [2000, 8200], B: [1000, 4100] },
} as const;

describe("Crucialis: 'if a critical hit, deals an additional X%' follows each struck enemy's own crit", () => {
    for (const slot of ['active', 'charged'] as const) {
        for (const side of ['player', 'enemy'] as const) {
            it(`${side}-side ${slot}: every hit's bonus matches its own crit`, () => {
                const rounds = run(slot, side);
                expect(rounds).toHaveLength(slot === 'active' ? ROUNDS : ROUNDS / 2);
                const want = EXPECT[slot];
                for (const r of rounds) {
                    expect(r.A!.damage).toBe(want.A[r.A!.crit ? 1 : 0]);
                    expect(r.B!.damage).toBe(want.B[r.B!.crit ? 1 : 0]);
                }
                // Non-vacuous: both mixed crit patterns occurred.
                expect(rounds.some((r) => r.A!.crit && !r.B!.crit)).toBe(true);
                expect(rounds.some((r) => !r.A!.crit && r.B!.crit)).toBe(true);
            });
        }
    }
});
