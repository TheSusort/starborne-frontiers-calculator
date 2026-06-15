import { describe, it, expect } from 'vitest';
import { parsePattern } from '../../targetingParser';
import { footprintVictims } from '../positionalApply';
import type { CombatActor } from '../state';

const actor = (id: string, position: CombatActor['position'], currentHp = 100): CombatActor =>
    ({ id, position, currentHp }) as CombatActor;

describe('footprintVictims', () => {
    it('single-target pattern (origin only) → origin occupant at roleScale 1.0', () => {
        const pattern = parsePattern('Pattern-Base');
        const living = [actor('front', 'M4'), actor('back', 'M1')];

        const hits = footprintVictims(pattern, 'M4', living);

        expect(hits).toHaveLength(1);
        expect(hits[0].victim.id).toBe('front');
        expect(hits[0].roleScale).toBe(1.0);
    });

    it('AoE pattern with occupants at origin + covered → origin 1.0, covered 0.5', () => {
        // Pattern-Line-Range-1 @ M4 → origin M4, covered M3.
        const pattern = parsePattern('Pattern-Line-Range-1');
        const living = [actor('origin', 'M4'), actor('covered', 'M3'), actor('elsewhere', 'M1')];

        const hits = footprintVictims(pattern, 'M4', living);

        expect(hits).toHaveLength(2);
        const byId = new Map(hits.map((h) => [h.victim.id, h.roleScale]));
        expect(byId.get('origin')).toBe(1.0);
        expect(byId.get('covered')).toBe(0.5);
        expect(byId.has('elsewhere')).toBe(false);
    });

    it('covered cell with NO living occupant contributes nothing', () => {
        // Pattern-Line-Range-1 @ M4 → origin M4, covered M3. M3 is empty.
        const pattern = parsePattern('Pattern-Line-Range-1');
        const living = [actor('origin', 'M4')];

        const hits = footprintVictims(pattern, 'M4', living);

        expect(hits).toHaveLength(1);
        expect(hits[0].victim.id).toBe('origin');
        expect(hits[0].roleScale).toBe(1.0);
    });

    it('dead actor (currentHp 0) at a covered cell is excluded', () => {
        const pattern = parsePattern('Pattern-Line-Range-1');
        const living = [actor('origin', 'M4'), actor('deadCovered', 'M3', 0)];

        const hits = footprintVictims(pattern, 'M4', living);

        expect(hits).toHaveLength(1);
        expect(hits[0].victim.id).toBe('origin');
    });
});
