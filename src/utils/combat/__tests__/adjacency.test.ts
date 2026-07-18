import { describe, it, expect } from 'vitest';
import { adjacentAllyIds } from '../adjacency';
import type { Position } from '../../../types/encounters';

// Board adjacency (board.ts neighbors): M2 neighbors = T1,T2,M1,M3,B1,B2.
const a = (id: string, position?: Position, destroyedRound?: number) => ({
    id,
    position,
    destroyedRound,
});

describe('adjacentAllyIds', () => {
    it('positional: returns living same-side allies on neighbouring cells, owner excluded', () => {
        const actors = [
            a('owner', 'M2'),
            a('adjT2', 'T2'), // neighbour of M2
            a('adjM3', 'M3'), // neighbour of M2
            a('farB4', 'B4'), // not a neighbour
        ];
        expect(adjacentAllyIds('owner', actors).sort()).toEqual(['adjM3', 'adjT2']);
    });

    it('positional: excludes a destroyed adjacent ally', () => {
        const actors = [a('owner', 'M2'), a('deadT2', 'T2', 3), a('adjM3', 'M3')];
        expect(adjacentAllyIds('owner', actors)).toEqual(['adjM3']);
    });

    it('non-positional (owner has no position): falls back to all living same-side allies', () => {
        const actors = [a('owner'), a('ally1'), a('ally2'), a('dead', undefined, 2)];
        expect(adjacentAllyIds('owner', actors).sort()).toEqual(['ally1', 'ally2']);
    });

    it('positional but no other actor positioned: falls back to all living allies', () => {
        const actors = [a('owner', 'M2'), a('ally1')]; // ally1 unpositioned
        expect(adjacentAllyIds('owner', actors)).toEqual(['ally1']);
    });

    it('empty / owner-only roster → []', () => {
        expect(adjacentAllyIds('owner', [a('owner', 'M2')])).toEqual([]);
        expect(adjacentAllyIds('owner', [])).toEqual([]);
    });

    it('anchor not in roster: returns [] rather than the whole-roster fallback (Wave 5 hardening)', () => {
        const actors = [a('other1', 'M2'), a('other2', 'T2')];
        expect(adjacentAllyIds('not-in-roster', actors)).toEqual([]);
    });
});
