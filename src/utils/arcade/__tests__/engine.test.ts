import { describe, it, expect } from 'vitest';
import { createGame, step } from '../engine';
import { computeScore } from '../scoring';
import {
    STEP_SECONDS,
    JUMP_SECONDS,
    MAX_SPEED,
    MAGNET_SECONDS,
    METERS_PER_UNIT,
    CREDIT_POINTS,
} from '../constants';
import type { GameState, ObstacleKind, PickupKind, PlayerAction, Lane } from '../types';

/** A game that never spawns, so each test places exactly what it needs. */
function quietGame(): GameState {
    const g = createGame(1);
    g.untilNextRow = Number.POSITIVE_INFINITY;
    return g;
}

function withObstacle(kind: ObstacleKind, lane: Lane, action: PlayerAction): GameState {
    const g = quietGame();
    g.player.action = action;
    g.player.actionTime = action === 'run' ? 0 : 10;
    g.obstacles.push({ id: 99, kind, lane, z: 0.01, resolved: false });
    return step(g, [], STEP_SECONDS);
}

function withPickup(kind: PickupKind, lane: Lane, playerLane: Lane, magnet: number): GameState {
    const g = quietGame();
    g.player.lane = playerLane;
    g.player.magnetTime = magnet;
    g.pickups.push({ id: 98, kind, lane, z: 0.01, resolved: false, collected: false });
    return step(g, [], STEP_SECONDS);
}

function withPickupAction(kind: PickupKind, action: PlayerAction, magnet: number): GameState {
    const g = quietGame();
    g.player.action = action;
    g.player.actionTime = action === 'run' ? 0 : 10;
    g.player.magnetTime = magnet;
    g.pickups.push({
        id: 98,
        kind,
        lane: g.player.lane,
        z: 0.01,
        resolved: false,
        collected: false,
    });
    return step(g, [], STEP_SECONDS);
}

describe('lane changes', () => {
    it('starts in the middle lane and clamps at both edges', () => {
        const g = quietGame();
        expect(g.player.lane).toBe(1);
        step(g, ['left', 'left', 'left'], STEP_SECONDS);
        expect(g.player.lane).toBe(0);
        step(g, ['right', 'right', 'right', 'right'], STEP_SECONDS);
        expect(g.player.lane).toBe(2);
    });
});

describe('jump and duck', () => {
    it('a jump lasts JUMP_SECONDS and then returns to running', () => {
        const g = quietGame();
        step(g, ['jump'], STEP_SECONDS);
        expect(g.player.action).toBe('jump');
        const steps = Math.floor(JUMP_SECONDS / STEP_SECONDS) - 2;
        for (let i = 0; i < steps; i++) step(g, [], STEP_SECONDS);
        expect(g.player.action).toBe('jump');
        for (let i = 0; i < 4; i++) step(g, [], STEP_SECONDS);
        expect(g.player.action).toBe('run');
    });

    it('cannot start a duck or restart a jump mid-jump', () => {
        const g = quietGame();
        step(g, ['jump'], STEP_SECONDS);
        for (let i = 0; i < 10; i++) step(g, [], STEP_SECONDS);
        const remaining = g.player.actionTime;
        step(g, ['duck', 'jump'], STEP_SECONDS);
        expect(g.player.action).toBe('jump');
        expect(g.player.actionTime).toBeLessThan(remaining);
    });
});

describe('collision', () => {
    const cases: [ObstacleKind, PlayerAction, 'running' | 'over'][] = [
        ['wall', 'run', 'over'],
        ['wall', 'jump', 'over'],
        ['wall', 'duck', 'over'],
        ['low', 'run', 'over'],
        ['low', 'duck', 'over'],
        ['low', 'jump', 'running'],
        ['high', 'run', 'over'],
        ['high', 'jump', 'over'],
        ['high', 'duck', 'running'],
    ];
    it.each(cases)('%s in your lane while you %s → %s', (kind, action, expected) => {
        expect(withObstacle(kind, 1, action).status).toBe(expected);
    });

    it('an obstacle in another lane never hits', () => {
        expect(withObstacle('wall', 0, 'run').status).toBe('running');
    });

    it('a shield absorbs exactly one hit', () => {
        const g = quietGame();
        g.player.shield = true;
        g.obstacles.push({ id: 1, kind: 'wall', lane: 1, z: 0.01, resolved: false });
        step(g, [], STEP_SECONDS);
        expect(g.status).toBe('running');
        expect(g.player.shield).toBe(false);
        expect(g.shieldBreakTime).toBeGreaterThan(0);
        g.obstacles.push({ id: 2, kind: 'wall', lane: 1, z: 0.01, resolved: false });
        step(g, [], STEP_SECONDS);
        expect(g.status).toBe('over');
    });
});

describe('pickups', () => {
    it('collects a credit in your lane', () => {
        expect(withPickup('credit', 1, 1, 0).credits).toBe(1);
    });
    it('misses a credit in the next lane without a magnet', () => {
        expect(withPickup('credit', 2, 1, 0).credits).toBe(0);
    });
    it('a magnet collects a credit in the next lane', () => {
        expect(withPickup('credit', 2, 1, 3).credits).toBe(1);
    });
    it('a magnet does not reach two lanes away', () => {
        expect(withPickup('credit', 2, 0, 3).credits).toBe(0);
    });
    it('a magnet does not pull power-ups from other lanes', () => {
        expect(withPickup('shield', 2, 1, 3).player.shield).toBe(false);
    });
    it('jumping over a credit in your lane misses it', () => {
        expect(withPickupAction('credit', 'jump', 0).credits).toBe(0);
    });
    it('jumping over a shield in your lane misses it', () => {
        expect(withPickupAction('shield', 'jump', 0).player.shield).toBe(false);
    });
    it('an active magnet still collects a credit in your lane while jumping', () => {
        expect(withPickupAction('credit', 'jump', 3).credits).toBe(1);
    });
    it('ducking over a credit in your lane collects it', () => {
        expect(withPickupAction('credit', 'duck', 0).credits).toBe(1);
    });
    it('a shield pickup arms the shield', () => {
        expect(withPickup('shield', 1, 1, 0).player.shield).toBe(true);
    });
    it('a magnet pickup runs for MAGNET_SECONDS', () => {
        expect(withPickup('magnet', 1, 1, 0).player.magnetTime).toBeCloseTo(MAGNET_SECONDS, 5);
    });
});

describe('resolve once', () => {
    it('an obstacle cleared mid-jump does not hit once the jump ends', () => {
        const g = quietGame();
        g.player.action = 'jump';
        g.player.actionTime = STEP_SECONDS * 3;
        g.obstacles.push({ id: 5, kind: 'low', lane: 1, z: 0.01, resolved: false });
        step(g, [], STEP_SECONDS);
        expect(g.obstacles[0].resolved).toBe(true);
        for (let i = 0; i < 6; i++) step(g, [], STEP_SECONDS);
        expect(g.player.action).toBe('run');
        expect(g.obstacles).toHaveLength(1);
        expect(g.status).toBe('running');
    });

    it('a missed credit is not collected by changing lane afterwards', () => {
        const g = quietGame();
        g.pickups.push({
            id: 6,
            kind: 'credit',
            lane: 2,
            z: 0.01,
            resolved: false,
            collected: false,
        });
        step(g, [], STEP_SECONDS);
        step(g, ['right'], STEP_SECONDS);
        expect(g.player.lane).toBe(2);
        expect(g.credits).toBe(0);
    });

    it('a credit crossing on the fatal step does not count', () => {
        const g = quietGame();
        g.obstacles.push({ id: 7, kind: 'wall', lane: 1, z: 0.01, resolved: false });
        g.pickups.push({
            id: 8,
            kind: 'credit',
            lane: 1,
            z: 0.01,
            resolved: false,
            collected: false,
        });
        step(g, [], STEP_SECONDS);
        expect(g.status).toBe('over');
        expect(g.credits).toBe(0);
    });

    it('an active magnet does not pull a magnet pickup from the next lane', () => {
        const g = withPickup('magnet', 2, 1, 3);
        expect(g.player.magnetTime).toBeCloseTo(3 - STEP_SECONDS, 5);
    });
});

describe('speed and score', () => {
    it('accelerates and caps at MAX_SPEED', () => {
        const g = quietGame();
        const start = g.speed;
        step(g, [], 1);
        expect(g.speed).toBeGreaterThan(start);
        for (let i = 0; i < 1000; i++) step(g, [], 1);
        expect(g.speed).toBe(MAX_SPEED);
    });

    it('score = metres + credits × CREDIT_POINTS', () => {
        const g = quietGame();
        g.distance = 400;
        g.credits = 3;
        expect(computeScore(g)).toBe(Math.floor(400 * METERS_PER_UNIT) + 3 * CREDIT_POINTS);
    });

    it('a finished game does not advance', () => {
        const g = withObstacle('wall', 1, 'run');
        const d = g.distance;
        step(g, [], 1);
        expect(g.distance).toBe(d);
    });
});

describe('spawning through step', () => {
    it('spawns the first row once FIRST_ROW_DELAY units are travelled', () => {
        const g = createGame(7);
        expect(g.obstacles).toHaveLength(0);
        for (let i = 0; i < 400 && g.obstacles.length === 0; i++) step(g, [], STEP_SECONDS);
        expect(g.obstacles.length).toBeGreaterThan(0);
    });
});
