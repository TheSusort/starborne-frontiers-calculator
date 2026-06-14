import { describe, it, expect } from 'vitest';
import type { ParsedTarget } from '../targetingParser';
import { selectTargets, rowScanOrder } from './selectTargets';

const enemy = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: `enemy-${selection}`,
    side: 'enemy',
    selection,
});
const ally = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: `ally-${selection}`,
    side: 'ally',
    selection,
});

describe('rowScanOrder — caster row, descend with wraparound', () => {
    it('T -> [T,M,B]', () => expect(rowScanOrder('T')).toEqual(['T', 'M', 'B']));
    it('M -> [M,B,T]', () => expect(rowScanOrder('M')).toEqual(['M', 'B', 'T']));
    it('B -> [B,T,M]', () => expect(rowScanOrder('B')).toEqual(['B', 'T', 'M']));
});

describe('selectTargets — ally side anchors on the caster', () => {
    it('team/others/all/self all anchor on caster, ordered [caster]', () => {
        for (const sel of ['team', 'others', 'all', 'self'] as const) {
            const r = selectTargets(ally(sel), {
                casterPosition: 'M2',
                enemyOccupied: [],
                allyOccupied: ['M2', 'M3'],
            });
            expect(r).toEqual({ ordered: ['M2'], anchor: 'M2' });
        }
    });
});

describe('selectTargets — empty enemy side', () => {
    it('returns null anchor', () => {
        expect(selectTargets(enemy('front'), { casterPosition: 'M2', enemyOccupied: [] })).toEqual({
            ordered: [],
            anchor: null,
        });
    });
});

describe('selectTargets — within-row front/back/skip (caster M4 vs enemies M4,M2,M1)', () => {
    const ctx = { casterPosition: 'M4' as const, enemyOccupied: ['M4', 'M2', 'M1'] as const };
    it('front -> [M4,M2,M1], anchor M4', () => {
        expect(selectTargets(enemy('front'), ctx)).toEqual({
            ordered: ['M4', 'M2', 'M1'],
            anchor: 'M4',
        });
    });
    it('skip -> [M2,M1,M4], anchor M2', () => {
        expect(selectTargets(enemy('skip'), ctx)).toEqual({
            ordered: ['M2', 'M1', 'M4'],
            anchor: 'M2',
        });
    });
    it('back -> [M1,M2,M4], anchor M1', () => {
        expect(selectTargets(enemy('back'), ctx)).toEqual({
            ordered: ['M1', 'M2', 'M4'],
            anchor: 'M1',
        });
    });
});

describe('selectTargets — single/two occupied fallbacks (caster M4)', () => {
    it('skip with two enemies M4,M1 -> anchor M1, ordered [M1,M4]', () => {
        expect(
            selectTargets(enemy('skip'), { casterPosition: 'M4', enemyOccupied: ['M4', 'M1'] })
        ).toEqual({ ordered: ['M1', 'M4'], anchor: 'M1' });
    });
    it('one enemy M4: front/back/skip all -> [M4], anchor M4', () => {
        for (const sel of ['front', 'back', 'skip'] as const) {
            expect(
                selectTargets(enemy(sel), { casterPosition: 'M4', enemyOccupied: ['M4'] })
            ).toEqual({ ordered: ['M4'], anchor: 'M4' });
        }
    });
});

describe('selectTargets — row-first scan (caster M, enemies only in top row T1,T3)', () => {
    it('front descends M(empty)->B(empty)->T, picks front-most T3', () => {
        expect(
            selectTargets(enemy('front'), { casterPosition: 'M2', enemyOccupied: ['T1', 'T3'] })
        ).toEqual({ ordered: ['T3', 'T1'], anchor: 'T3' });
    });
});

// Task A3 — enemy all cross-row ordering
describe('selectTargets — enemy all spans every row in scan order (caster M2)', () => {
    it('orders M row first (front->back), then B, then T', () => {
        const r = selectTargets(
            { raw: 'all', side: 'enemy', selection: 'all' },
            { casterPosition: 'M2', enemyOccupied: ['T1', 'B3', 'M1', 'M4'] }
        );
        // scan M,B,T: M front->back = M4,M1 ; B = B3 ; T = T1
        expect(r.ordered).toEqual(['M4', 'M1', 'B3', 'T1']);
        expect(r.anchor).toBe('M4');
    });
});
