import { describe, it, expect } from 'vitest';
import { parsePattern } from '../../targetingParser';
import { footprintAllies } from '../footprintAllies';
import type { CombatActor } from '../state';

const actor = (id: string, position: CombatActor['position'], currentHp = 100): CombatActor =>
    ({ id, position, currentHp }) as CombatActor;

describe('footprintAllies', () => {
    it('Line-Support-Range-1 includes origin ally and one forward cell only', () => {
        const pattern = parsePattern('Pattern-Line-Support-Range-1');
        // @ M3 → {M3, M4}
        const roster = [
            actor('supporter', 'M3'),
            actor('forward', 'M4'),
            actor('offPattern', 'M1'),
        ];

        const hits = footprintAllies({ pattern, anchor: 'M3', sameSideLiving: roster });

        expect(hits.map((a) => a.id).sort()).toEqual(['forward', 'supporter']);
    });

    it('Base-Support includes only the origin cell', () => {
        const pattern = parsePattern('Pattern-Base-Support');
        const roster = [actor('self', 'M4'), actor('neighbor', 'M3')];

        const hits = footprintAllies({ pattern, anchor: 'M4', sameSideLiving: roster });

        expect(hits).toHaveLength(1);
        expect(hits[0].id).toBe('self');
    });

    it('notSelf support excludes the caster at the origin', () => {
        const pattern = parsePattern('Pattern-Line-Support-Not-Self-Range-1');
        // @ M3 → covered {M4} only (no origin)
        const roster = [actor('supporter', 'M3'), actor('forward', 'M4'), actor('back', 'M2')];

        const hits = footprintAllies({ pattern, anchor: 'M3', sameSideLiving: roster });

        expect(hits.map((a) => a.id)).toEqual(['forward']);
    });

    it('dead ally on a footprint cell is excluded', () => {
        const pattern = parsePattern('Pattern-Line-Support-Range-1');
        const roster = [actor('supporter', 'M3'), actor('deadForward', 'M4', 0)];

        const hits = footprintAllies({ pattern, anchor: 'M3', sameSideLiving: roster });

        expect(hits.map((a) => a.id)).toEqual(['supporter']);
    });

    it('Support-All includes every placed living ally on the board', () => {
        const pattern = parsePattern('Pattern-Support-All');
        const roster = [
            actor('a', 'M1'),
            actor('b', 'M4'),
            actor('c', 'T3'),
            actor('dead', 'B2', 0),
        ];

        const hits = footprintAllies({ pattern, anchor: 'M4', sameSideLiving: roster });

        expect(hits.map((a) => a.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('empty footprint cell contributes nothing', () => {
        const pattern = parsePattern('Pattern-Line-Support-Range-1');
        const roster = [actor('supporter', 'M3')];

        const hits = footprintAllies({ pattern, anchor: 'M3', sameSideLiving: roster });

        expect(hits.map((a) => a.id)).toEqual(['supporter']);
    });
});
