import { describe, it, expect } from 'vitest';
import { diffOverrides, rostersDiffer, snapshotOverrides } from '../compareRuns';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { Ship } from '../../../types/ship';
import type { BattleResult } from '../../calculators/battleSimulator';

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

    it('copies the override object rather than aliasing the live placement', () => {
        const overrides = { attack: 100 };
        const player: BoardState = { T1: { ship: ship('a'), overrides } };
        const snap = snapshotOverrides(player, {});
        overrides.attack = 999;
        expect(snap['player:T1']).toEqual({ attack: 100 });
    });
});

describe('rostersDiffer', () => {
    const nova = (actorId: string, position: BattleResult['roster'][number]['position']) => ({
        actorId,
        side: 'player' as const,
        name: 'Nova',
        position,
    });

    it('reports no difference for the same roster', () => {
        const roster = [nova('attacker', 'T1')];
        expect(rostersDiffer(roster, [...roster])).toBe(false);
    });

    it('reports a difference on count change', () => {
        expect(rostersDiffer([nova('attacker', 'T1')], [])).toBe(true);
    });

    it('reports a difference when the same actorId now names a different ship — a board edit at an earlier position reassigns the engine-reserved id', () => {
        const baseline = [nova('attacker', 'T2')];
        const current = [
            {
                actorId: 'attacker',
                side: 'player' as const,
                name: 'Vanguard',
                position: 'T1' as const,
            },
            { actorId: 'p:nova:1', side: 'player' as const, name: 'Nova', position: 'T2' as const },
        ];
        expect(rostersDiffer(baseline, current)).toBe(true);
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
