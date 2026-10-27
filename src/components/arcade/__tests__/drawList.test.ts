import { describe, expect, it } from 'vitest';
import { collectItems, type DrawItem } from '../flightRenderer';
import { createGame } from '../../../utils/arcade/engine';
import type { Checkpoint, Obstacle, Pickup } from '../../../utils/arcade/types';

const obstacle = (id: number, z: number) => ({ id, z, lane: 1, kind: 'wall' }) as Obstacle;
const pickup = (id: number, z: number, collected = false) =>
    ({ id, z, lane: 1, kind: 'credit', collected }) as Pickup;
const checkpoint = (id: number, z: number) => ({ id, z }) as Checkpoint;

describe('collectItems', () => {
    it('lists obstacles, uncollected pickups and checkpoints ahead, farthest first', () => {
        const game = createGame(1);
        game.obstacles = [obstacle(1, 10), obstacle(2, 40)];
        game.pickups = [pickup(3, 30), pickup(4, 50, true), pickup(5, -2)];
        game.checkpoints = [checkpoint(6, 20), checkpoint(7, 0)];
        const list: DrawItem[] = [];
        const n = collectItems(game, list);
        expect(n).toBe(5);
        expect(list.slice(0, n).map((i) => i.z)).toEqual([40, 30, 20, 10, -2]);
        expect(list[0].obstacle?.id).toBe(2);
        expect(list[1].pickup?.id).toBe(3);
        expect(list[2].checkpoint?.id).toBe(6);
        expect(list[2].obstacle).toBeNull();
    });

    it('keeps the game order for equal depths', () => {
        const game = createGame(1);
        game.obstacles = [obstacle(1, 10)];
        game.pickups = [pickup(2, 10)];
        game.checkpoints = [checkpoint(3, 10)];
        const list: DrawItem[] = [];
        collectItems(game, list);
        expect(list[0].obstacle?.id).toBe(1);
        expect(list[1].pickup?.id).toBe(2);
        expect(list[2].checkpoint?.id).toBe(3);
    });

    it('reuses its entries from frame to frame', () => {
        const game = createGame(1);
        game.obstacles = [obstacle(1, 10), obstacle(2, 40)];
        const list: DrawItem[] = [];
        collectItems(game, list);
        const entries = new Set(list);
        game.obstacles = [obstacle(3, 5)];
        game.pickups = [pickup(4, 8)];
        expect(collectItems(game, list)).toBe(2);
        expect(new Set(list)).toEqual(entries);
        expect(list[0].pickup?.id).toBe(4);
        expect(list[0].obstacle).toBeNull();
    });
});
