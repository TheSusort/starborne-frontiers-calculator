import { describe, it, expect } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import { castFootprint } from '../positionalApply';
import { markedTargets, resolvePositionalTargetCell } from '../positionalBinding';
import type { ActorTargetingStatus } from '../positionalBinding';
import type { CombatActor } from '../state';

const actor = (id: string, position: CombatActor['position'], currentHp = 100): CombatActor =>
    ({ id, position, currentHp }) as CombatActor;

const statusOf =
    (markedIds: string[], extra: Partial<ActorTargetingStatus> = {}) =>
    (id: string): ActorTargetingStatus => ({
        stealthed: false,
        taunting: false,
        concentrated: false,
        ...extra,
        marked: markedIds.includes(id),
    });

const MARKED = parseTarget('marked-or-front');
const HORSESHOE = parsePattern('Pattern-Horseshoe-Range-1');

describe('markedTargets', () => {
    it('returns every living Marked unit in board-position order (top 1-4, middle, bottom)', () => {
        const living = [actor('b4', 'B4'), actor('m1', 'M1'), actor('t3', 'T3'), actor('t2', 'T2')];
        const marked = markedTargets(MARKED, living, statusOf(['b4', 'm1', 't3']));
        expect(marked?.map((a) => a.id)).toEqual(['t3', 'm1', 'b4']);
    });

    it('skips a dead Marked unit and is null when nobody living is Marked', () => {
        const living = [actor('dead', 'M4', 0), actor('alive', 'M3')];
        expect(markedTargets(MARKED, living, statusOf(['dead']))).toBeNull();
    });

    it('is null for any other selection', () => {
        const living = [actor('m4', 'M4')];
        expect(markedTargets(parseTarget('front'), living, statusOf(['m4']))).toBeNull();
    });
});

describe('castFootprint', () => {
    it('Marked branch: each Marked unit at full damage, all primary, nobody else', () => {
        const living = [actor('m3', 'M3'), actor('m2', 'M2'), actor('t4', 'T4'), actor('b3', 'B3')];
        const { victims, allPrimary } = castFootprint(
            HORSESHOE,
            MARKED,
            'M3',
            living,
            statusOf(['t4', 'b3'])
        );
        expect(victims.map((v) => [v.victim.id, v.roleScale])).toEqual([
            ['t4', 1],
            ['b3', 1],
        ]);
        expect(allPrimary).toBe(true);
    });

    it('no Marked unit: the horseshoe around the anchor, anchor primary only', () => {
        const living = [actor('m3', 'M3'), actor('m2', 'M2'), actor('t3', 'T3'), actor('t1', 'T1')];
        const { victims, allPrimary } = castFootprint(
            HORSESHOE,
            MARKED,
            'M3',
            living,
            statusOf([])
        );
        expect(victims.map((v) => [v.victim.id, v.roleScale])).toEqual([
            ['m3', 1],
            ['m2', 0.5],
            ['t3', 0.5],
        ]);
        expect(allPrimary).toBe(false);
    });
});

describe('resolvePositionalTargetCell with a marked selection', () => {
    it('anchors on the first Marked unit, past Taunt and Stealth', () => {
        const living = [actor('m4', 'M4'), actor('b2', 'B2'), actor('t1', 'T1')];
        const status = (id: string): ActorTargetingStatus => ({
            stealthed: id === 'b2',
            taunting: id === 'm4',
            concentrated: false,
            marked: id === 'b2',
        });
        expect(resolvePositionalTargetCell('M1', MARKED, living, status)?.actor.id).toBe('b2');
    });

    it('targets like front when nobody is Marked', () => {
        const living = [actor('m4', 'M4'), actor('m2', 'M2'), actor('t4', 'T4')];
        const hit = resolvePositionalTargetCell('M1', MARKED, living, statusOf([]));
        const front = resolvePositionalTargetCell('M1', parseTarget('front'), living, statusOf([]));
        expect(hit).toEqual(front);
        expect(hit?.actor.id).toBe('m4');
    });
});
