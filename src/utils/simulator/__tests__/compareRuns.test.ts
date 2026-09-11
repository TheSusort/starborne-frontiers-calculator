import { describe, it, expect } from 'vitest';
import { diffOverrides, snapshotOverrides } from '../compareRuns';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { Ship } from '../../../types/ship';

const ship = (id: string) => ({ id, name: id, baseStats: {}, equipment: {} }) as unknown as Ship;

describe('snapshotOverrides', () => {
    it('keys by side and position and skips placements with no override', () => {
        const player: BoardState = {
            T1: { ship: ship('a'), overrides: { attack: 100 } },
            M2: { ship: ship('b') },
        };
        expect(snapshotOverrides(player, {})).toEqual({ 'player:T1': { attack: 100 } });
    });

    it('captures both sides', () => {
        const snap = snapshotOverrides(
            { T1: { ship: ship('a'), overrides: { speed: 1 } } },
            { B4: { ship: ship('b'), overrides: { hp: 2 } } }
        );
        expect(snap).toEqual({ 'player:T1': { speed: 1 }, 'enemy:B4': { hp: 2 } });
    });
});

describe('diffOverrides', () => {
    it('reports a stat that gained an override', () => {
        expect(diffOverrides({}, { 'player:T1': { attack: 200 } })).toEqual([
            { key: 'player:T1', stat: 'attack', from: undefined, to: 200 },
        ]);
    });

    it('reports a stat that lost its override', () => {
        expect(diffOverrides({ 'player:T1': { attack: 200 } }, {})).toEqual([
            { key: 'player:T1', stat: 'attack', from: 200, to: undefined },
        ]);
    });

    it('reports a changed value', () => {
        expect(
            diffOverrides({ 'player:T1': { attack: 200 } }, { 'player:T1': { attack: 300 } })
        ).toEqual([{ key: 'player:T1', stat: 'attack', from: 200, to: 300 }]);
    });

    it('reports nothing when the two snapshots match', () => {
        const snap = { 'player:T1': { attack: 200 }, 'enemy:B4': { hp: 9 } };
        expect(diffOverrides(snap, { ...snap })).toEqual([]);
    });
});
