import { describe, it, expect } from 'vitest';
import { stolenFromBoard } from '../gearSteal';
import type { Ship } from '../../../../types/ship';
import type { GearSuggestion } from '../../../../types/autogear';

const ships: Record<string, Ship> = {
    focus: { id: 'focus', name: 'Focus' } as Ship,
    ally: { id: 'ally', name: 'Ally' } as Ship,
    bench: { id: 'bench', name: 'Bench' } as Ship,
};
const getShipById = (id: string) => ships[id];

const suggestion = (gearId: string): GearSuggestion => ({
    slotName: 'weapon',
    gearId,
    score: 1,
});

const args = (suggestions: GearSuggestion[], gearToShipMap: Map<string, string>) => ({
    suggestions,
    focusShipId: 'focus',
    boardShipIds: ['focus', 'ally'],
    getShipById,
    gearToShipMap,
});

describe('stolenFromBoard', () => {
    it('reports a piece taken from a ship on the board', () => {
        const result = stolenFromBoard(args([suggestion('g1')], new Map([['g1', 'ally']])));
        expect(result).toEqual([{ gearId: 'g1', fromShipId: 'ally', fromShipName: 'Ally' }]);
    });

    it('ignores a piece taken from a ship that is not on the board', () => {
        expect(stolenFromBoard(args([suggestion('g1')], new Map([['g1', 'bench']])))).toEqual([]);
    });

    it('ignores the focus ship wearing its own piece', () => {
        expect(stolenFromBoard(args([suggestion('g1')], new Map([['g1', 'focus']])))).toEqual([]);
    });

    it('ignores unequipped gear', () => {
        expect(stolenFromBoard(args([suggestion('g1')], new Map()))).toEqual([]);
    });

    it('reports each stolen piece once even when several come from one ally', () => {
        const result = stolenFromBoard(
            args(
                [suggestion('g1'), suggestion('g2')],
                new Map([
                    ['g1', 'ally'],
                    ['g2', 'ally'],
                ])
            )
        );
        expect(result.map((p) => p.gearId).sort()).toEqual(['g1', 'g2']);
    });
});
