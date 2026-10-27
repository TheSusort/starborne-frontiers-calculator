import { describe, it, expect } from 'vitest';
import { createGame, step } from '../engine';
import { resolveDuel } from '../checkpoints';
import { jumpArc, liftArc } from '../collision';
import { computeScore, runResult } from '../scoring';
import {
    CREDIT_SPACING,
    CREDITS_PER_TRAIL,
    DROP_SECONDS,
    DUCK_SECONDS,
    DUEL_CREDIT_REWARD,
    JUMP_SECONDS,
    STEP_SECONDS,
} from '../constants';
import type { GameState, InputAction, Lane, ObstacleKind, PickupKind, RunEvent } from '../types';

/** A game that never spawns, so each test places exactly what it needs. */
function quietGame(): GameState {
    const g = createGame(1);
    g.untilNextRow = Number.POSITIVE_INFINITY;
    return g;
}

const steps = (seconds: number) => Math.round(seconds / STEP_SECONDS);

function run(g: GameState, count: number, inputs: readonly InputAction[] = []): void {
    for (let i = 0; i < count; i++) step(g, i === 0 ? inputs : [], STEP_SECONDS);
}

/** Starts the game mid-action with `seconds` of it left. */
function inAction(action: 'jump' | 'duck', seconds: number): GameState {
    const g = quietGame();
    g.player.action = action;
    g.player.actionTime = seconds;
    return g;
}

/**
 * Presses `inputs` on one step, then steps until `seconds` after that press, the last step
 * carrying `obstacles` across z = 0.
 */
function pressThenCross(
    g: GameState,
    inputs: readonly InputAction[],
    seconds: number,
    obstacles: [ObstacleKind, Lane][]
): void {
    const n = steps(seconds);
    run(g, n - 1, inputs);
    for (const [kind, lane] of obstacles) {
        g.obstacles.push({ id: g.nextId++, kind, lane, z: 0.01, resolved: false });
    }
    step(g, [], STEP_SECONDS);
}

const nearMisses = (g: GameState) =>
    g.events.filter((e): e is Extract<RunEvent, { kind: 'near-miss' }> => e.kind === 'near-miss');

/** One lane-change near miss: leaves the current lane toward the middle side, and a wall
 *  crosses the lane just left. */
function laneNearMiss(g: GameState): void {
    const from = g.player.lane;
    pressThenCross(g, [from === 0 ? 'right' : 'left'], 2 * STEP_SECONDS, [['wall', from]]);
}

describe('input buffer', () => {
    /** A jump pressed mid-jump, with `left` seconds of that jump to go; returns the action
     *  shortly after the jump ends. */
    function pressJumpWithLeft(left: number): GameState {
        const g = inAction('jump', left);
        run(g, steps(left) + 3, ['jump']);
        return g;
    }

    it('a press 0.14 s before the action frees fires', () => {
        const g = pressJumpWithLeft(0.14);
        expect(g.player.action).toBe('jump');
        expect(g.player.actionTime).toBeGreaterThan(JUMP_SECONDS - 0.1);
    });

    it('a press 0.16 s before the action frees is dropped', () => {
        const g = pressJumpWithLeft(0.16);
        expect(g.player.action).toBe('run');
        expect(g.player.buffered).toBeNull();
    });

    it('a duck pressed mid-duck fires when the duck ends', () => {
        const g = inAction('duck', 0.1);
        run(g, steps(0.1) + 3, ['duck']);
        expect(g.player.action).toBe('duck');
        expect(g.player.actionTime).toBeGreaterThan(DUCK_SECONDS - 0.1);
    });

    it('the latest press wins: a jump then a duck during a drop ends in a duck only', () => {
        const g = inAction('jump', JUMP_SECONDS / 2);
        step(g, ['duck'], STEP_SECONDS);
        expect(g.player.action).toBe('drop');
        step(g, ['jump'], STEP_SECONDS);
        step(g, ['duck'], STEP_SECONDS);
        run(g, steps(DROP_SECONDS) + 2);
        expect(g.player.action).toBe('duck');
        run(g, steps(0.2));
        expect(g.player.action).toBe('duck');
    });

    it('the latest press wins: a duck then a jump during a drop ends in a jump', () => {
        const g = inAction('jump', JUMP_SECONDS / 2);
        step(g, ['duck'], STEP_SECONDS);
        step(g, ['duck'], STEP_SECONDS);
        step(g, ['jump'], STEP_SECONDS);
        run(g, steps(DROP_SECONDS) + 2);
        expect(g.player.action).toBe('jump');
    });

    it('a press that starts at once clears an older held press', () => {
        const g = inAction('jump', 0.12);
        step(g, ['jump'], STEP_SECONDS);
        expect(g.player.buffered?.action).toBe('jump');
        step(g, ['duck'], STEP_SECONDS);
        expect(g.player.action).toBe('drop');
        expect(g.player.buffered).toBeNull();
    });

    it('lane changes are never held', () => {
        const g = inAction('jump', JUMP_SECONDS / 2);
        step(g, ['left'], STEP_SECONDS);
        expect(g.player.lane).toBe(0);
        expect(g.player.buffered).toBeNull();
    });
});

describe('cancels', () => {
    it('a duck mid-jump drops for DROP_SECONDS, then ducks for DUCK_SECONDS', () => {
        const g = inAction('jump', JUMP_SECONDS / 2);
        const arc = jumpArc(g.player.actionTime);
        step(g, ['duck'], STEP_SECONDS);
        expect(g.player.action).toBe('drop');
        expect(g.player.dropArc).toBeCloseTo(arc, 9);
        run(g, steps(DROP_SECONDS) - 2);
        expect(g.player.action).toBe('drop');
        run(g, 2);
        expect(g.player.action).toBe('duck');
        run(g, steps(DUCK_SECONDS) - 2);
        expect(g.player.action).toBe('duck');
        run(g, 2);
        expect(g.player.action).toBe('run');
    });

    it('a drop descends in a straight line from the height at the cancel to the ground', () => {
        const g = inAction('jump', JUMP_SECONDS / 2);
        step(g, ['duck'], STEP_SECONDS);
        const start = g.player.dropArc;
        expect(liftArc(g.player)).toBeCloseTo(start * (1 - STEP_SECONDS / DROP_SECONDS), 9);
        run(g, steps(DROP_SECONDS / 2) - 1);
        expect(liftArc(g.player)).toBeCloseTo(start / 2, 1);
        run(g, steps(DROP_SECONDS));
        expect(g.player.action).toBe('duck');
        expect(liftArc(g.player)).toBe(0);
    });

    it.each<[ObstacleKind]>([['wall'], ['low'], ['high']])(
        'a %s barrier crossing during a drop hits',
        (kind) => {
            const g = inAction('jump', JUMP_SECONDS / 2);
            step(g, ['duck'], STEP_SECONDS);
            g.obstacles.push({ id: 1, kind, lane: 1, z: 0.01, resolved: false });
            step(g, [], STEP_SECONDS);
            expect(g.player.action).toBe('drop');
            expect(g.status).toBe('over');
        }
    );

    it('a drop from the peak flies over a credit at first, and collects it near the ground', () => {
        const dropWithCreditAfter = (seconds: number) => {
            const g = inAction('jump', JUMP_SECONDS / 2);
            step(g, ['duck'], STEP_SECONDS);
            run(g, steps(seconds));
            g.pickups.push({
                id: g.nextId++,
                kind: 'credit',
                lane: 1,
                z: 0.01,
                resolved: false,
                collected: false,
                trailId: -1,
            });
            step(g, [], STEP_SECONDS);
            expect(g.player.action).toBe('drop');
            return g.credits;
        };
        expect(dropWithCreditAfter(0)).toBe(0);
        expect(dropWithCreditAfter(DROP_SECONDS * 0.8)).toBe(1);
    });

    it('a jump mid-duck jumps at once', () => {
        const g = inAction('duck', DUCK_SECONDS / 2);
        step(g, ['jump'], STEP_SECONDS);
        expect(g.player.action).toBe('jump');
        expect(g.player.actionTime).toBeCloseTo(JUMP_SECONDS - STEP_SECONDS, 9);
    });
});

describe('near miss', () => {
    it('a lane change 0.19 s before the crossing pays; 0.21 s does not', () => {
        const near = quietGame();
        pressThenCross(near, ['left'], 0.19, [['wall', 1]]);
        expect(nearMisses(near)).toEqual([{ kind: 'near-miss', points: 25, chain: 1, lane: 1 }]);
        expect(near.bonus).toBe(25);

        const late = quietGame();
        pressThenCross(late, ['left'], 0.21, [['wall', 1]]);
        expect(nearMisses(late)).toEqual([]);
        expect(late.bonus).toBe(0);
    });

    it('a jump started in the window clears a low barrier and pays', () => {
        const g = quietGame();
        pressThenCross(g, ['jump'], 0.19, [['low', 1]]);
        expect(g.status).toBe('running');
        expect(nearMisses(g)).toHaveLength(1);

        const early = quietGame();
        pressThenCross(early, ['jump'], 0.21, [['low', 1]]);
        expect(early.status).toBe('running');
        expect(nearMisses(early)).toEqual([]);
    });

    it('a duck started in the window clears a high barrier and pays', () => {
        const g = quietGame();
        pressThenCross(g, ['duck'], 0.19, [['high', 1]]);
        expect(nearMisses(g)).toHaveLength(1);
    });

    it("a duck reached through a drop counts from the drop's press", () => {
        const g = inAction('jump', JUMP_SECONDS / 2);
        pressThenCross(g, ['duck'], 0.15, [['high', 1]]);
        expect(g.status).toBe('running');
        expect(nearMisses(g)).toHaveLength(1);
    });

    it('a wall with a jump does not count', () => {
        const g = quietGame();
        pressThenCross(g, ['jump'], 0.1, [['wall', 0]]);
        expect(g.status).toBe('running');
        expect(nearMisses(g)).toEqual([]);
    });

    it('a jump does not count for a low barrier in another lane', () => {
        const g = quietGame();
        pressThenCross(g, ['jump'], 0.1, [['low', 2]]);
        expect(nearMisses(g)).toEqual([]);
    });

    it('two obstacles in one row can each be a near miss', () => {
        const g = quietGame();
        step(g, ['left', 'jump'], STEP_SECONDS);
        pressThenCross(g, [], 0.1, [
            ['wall', 1],
            ['low', 0],
        ]);
        expect(nearMisses(g).map((e) => [e.lane, e.chain, e.points])).toEqual([
            [1, 1, 25],
            [0, 2, 50],
        ]);
    });

    it('a chain pays 25 more per near miss up to 150', () => {
        const g = quietGame();
        for (let i = 0; i < 8; i++) laneNearMiss(g);
        const paid = nearMisses(g).map((e) => e.points);
        expect(paid).toEqual([25, 50, 75, 100, 125, 150, 150, 150]);
        const total = paid.reduce((a, b) => a + b, 0);
        expect(g.bonus).toBe(total);
        expect(g.nearMissPoints).toBe(total);
        expect(g.bestNearMissChain).toBe(8);
        expect(runResult(g)).toMatchObject({ bestNearMissChain: 8, nearMissPoints: total });
    });

    it('a row that passes with no near miss ends the chain', () => {
        const g = quietGame();
        laneNearMiss(g);
        laneNearMiss(g);
        expect(g.nearMissChain).toBe(2);
        pressThenCross(g, [], 1, [['wall', g.player.lane === 0 ? 2 : 0]]);
        expect(g.nearMissChain).toBe(0);
        laneNearMiss(g);
        expect(nearMisses(g).map((e) => e.points)).toEqual([25, 50, 25]);
        expect(g.bestNearMissChain).toBe(2);
    });

    it('time alone does not end a chain', () => {
        const g = quietGame();
        laneNearMiss(g);
        run(g, steps(10));
        laneNearMiss(g);
        expect(nearMisses(g).map((e) => e.points)).toEqual([25, 50]);
    });

    it('a double row with one near miss and one far barrier keeps the chain', () => {
        const g = quietGame();
        laneNearMiss(g);
        const from = g.player.lane;
        const far = ([0, 1, 2] as Lane[]).find((l) => Math.abs(l - from) === 2) ?? 2;
        pressThenCross(g, [from === 0 ? 'right' : 'left'], 2 * STEP_SECONDS, [
            ['wall', from],
            ['wall', far === from ? 0 : far],
        ]);
        expect(nearMisses(g).map((e) => e.points)).toEqual([25, 50]);
        expect(g.nearMissChain).toBe(2);
    });

    it('a chain resets on a shield break, and the hit pays nothing', () => {
        const g = quietGame();
        g.player.shield = true;
        laneNearMiss(g);
        laneNearMiss(g);
        g.obstacles.push({ id: 900, kind: 'wall', lane: g.player.lane, z: 0.01, resolved: false });
        step(g, [], STEP_SECONDS);
        expect(g.player.shield).toBe(false);
        expect(g.nearMissChain).toBe(0);
        expect(nearMisses(g)).toHaveLength(2);
        laneNearMiss(g);
        expect(nearMisses(g).map((e) => e.points)).toEqual([25, 50, 25]);
    });

    it('a hit pays nothing even when the dodge came in the window', () => {
        const g = quietGame();
        g.player.shield = true;
        pressThenCross(g, ['jump'], 0.1, [['high', 1]]);
        expect(g.player.shield).toBe(false);
        expect(nearMisses(g)).toEqual([]);
        expect(g.bonus).toBe(0);
    });

    it('near-miss points go into the score', () => {
        const g = quietGame();
        const before = computeScore(g);
        laneNearMiss(g);
        expect(computeScore(g) - before).toBeGreaterThanOrEqual(25);
        expect(g.bonus).toBe(25);
    });
});

describe('credit streak', () => {
    /** Places a trail in `lane` just ahead of the player and steps until all of it has passed. */
    function passTrail(
        g: GameState,
        lane: Lane,
        kinds: PickupKind[] = Array(CREDITS_PER_TRAIL).fill('credit')
    ): void {
        const trailId = g.nextId;
        kinds.forEach((kind, i) =>
            g.pickups.push({
                id: g.nextId++,
                kind,
                lane,
                z: 0.01 + i * CREDIT_SPACING,
                resolved: false,
                collected: false,
                trailId,
            })
        );
        g.trails[trailId] = { pending: kinds.length, missed: false };
        for (let i = 0; i < 1000 && g.trails[trailId]; i++) step(g, [], STEP_SECONDS);
        expect(g.trails[trailId]).toBeUndefined();
    }

    const kinds = (g: GameState) => g.events.map((e) => e.kind).filter((k) => k !== 'near-miss');

    it('two finished trails switch it on, and credits then count double', () => {
        const g = quietGame();
        passTrail(g, 1);
        expect(g.creditStreak).toBe(1);
        expect(g.credits).toBe(4);
        passTrail(g, 1);
        expect(g.creditStreak).toBe(2);
        expect(kinds(g)).toEqual(['streak-on']);
        expect(g.credits).toBe(8);
        passTrail(g, 1);
        expect(g.credits).toBe(16);
        expect(kinds(g)).toEqual(['streak-on']);
    });

    it('an untouched trail resets it', () => {
        const g = quietGame();
        passTrail(g, 1);
        passTrail(g, 1);
        passTrail(g, 0);
        expect(g.creditStreak).toBe(0);
        expect(kinds(g)).toEqual(['streak-on', 'streak-lost']);
        passTrail(g, 1);
        expect(g.credits).toBe(12);
    });

    it('a trail missing one credit is unfinished', () => {
        const g = quietGame();
        passTrail(g, 1);
        g.pickups.push({
            id: g.nextId++,
            kind: 'credit',
            lane: 0,
            z: 0.01,
            resolved: false,
            collected: false,
            trailId: 500,
        });
        g.pickups.push({
            id: g.nextId++,
            kind: 'credit',
            lane: 1,
            z: 0.01 + CREDIT_SPACING,
            resolved: false,
            collected: false,
            trailId: 500,
        });
        g.trails[500] = { pending: 2, missed: false };
        run(g, steps(1));
        expect(g.trails[500]).toBeUndefined();
        expect(g.creditStreak).toBe(0);
    });

    it('a magnet-collected trail counts as finished; a missed power-up does not count', () => {
        const g = quietGame();
        g.player.magnetTime = 60;
        passTrail(g, 2, ['credit', 'shield', 'credit', 'credit']);
        passTrail(g, 0);
        expect(g.player.shield).toBe(false);
        expect(g.creditStreak).toBe(2);
        expect(kinds(g)).toEqual(['streak-on']);
    });

    it('a trail resets to nothing when the streak was not on, without a streak-lost', () => {
        const g = quietGame();
        passTrail(g, 1);
        passTrail(g, 0);
        expect(g.creditStreak).toBe(0);
        expect(kinds(g)).toEqual([]);
    });

    it('duel credits are not doubled', () => {
        const g = quietGame();
        g.creditStreak = 2;
        g.credits = 10;
        g.status = 'duel';
        g.pendingDuel = { checkpointId: 1, slot: 0, stakes: 'bonus-or-penalty' };
        resolveDuel(g, 'win');
        expect(g.credits).toBe(10 + DUEL_CREDIT_REWARD);
        expect(g.creditStreak).toBe(2);
    });
});

describe('determinism', () => {
    /** A small player bot that reads the state: it dodges the nearest obstacle in its lane at
     *  the last moment, so near misses and trails both happen. Returns the score and every event. */
    function play(seed: number) {
        const g = createGame(seed);
        const log: RunEvent[] = [];
        for (let i = 0; i < steps(240) && g.status === 'running'; i++) {
            const inputs: InputAction[] = [];
            const ahead = g.obstacles.filter(
                (o) => !o.resolved && o.lane === g.player.lane && o.z / g.speed < 0.12
            );
            for (const o of ahead) {
                const row = g.obstacles.filter((r) => Math.abs(r.z - o.z) < 1);
                if (o.kind === 'low') inputs.push('jump');
                else if (o.kind === 'high') inputs.push('duck');
                else {
                    const free = ([0, 1, 2] as Lane[]).find(
                        (l) => Math.abs(l - g.player.lane) === 1 && !row.some((r) => r.lane === l)
                    );
                    if (free !== undefined) inputs.push(free < g.player.lane ? 'left' : 'right');
                }
            }
            step(g, inputs, STEP_SECONDS);
            log.push(...g.events.splice(0));
        }
        return { score: computeScore(g), log };
    }

    it('the same seed and inputs give the same score and events', () => {
        const a = play(12345);
        const b = play(12345);
        expect(a.log.some((e) => e.kind === 'near-miss')).toBe(true);
        expect(a.log.some((e) => e.kind !== 'near-miss')).toBe(true);
        expect(b).toEqual(a);
        expect(play(54321)).not.toEqual(a);
    });
});
