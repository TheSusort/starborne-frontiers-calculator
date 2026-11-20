import { describe, it, expect } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import { castFootprint } from '../positionalApply';
import { targetableEnemies } from '../positionalBinding';
import type { ActorTargetingStatus, PositionalActing } from '../positionalBinding';
import type { CombatActor } from '../state';

const actor = (id: string, position: CombatActor['position'], currentHp = 100): CombatActor =>
    ({ id, position, currentHp }) as CombatActor;

const statusFrom =
    (map: Record<string, Partial<ActorTargetingStatus>>) =>
    (id: string): ActorTargetingStatus => ({
        stealthed: false,
        taunting: false,
        concentrated: false,
        ...map[id],
    });

const FRONT = parseTarget('front');
const ids = (units: CombatActor[]) => units.map((u) => u.id).sort();

const living = [actor('a', 'M4'), actor('b', 'T3'), actor('c', 'B2'), actor('d', 'M1')];

describe('targetableEnemies', () => {
    it('no forced targeting and no Stealth → every living enemy', () => {
        expect(ids(targetableEnemies(FRONT, living, statusFrom({})))).toEqual(['a', 'b', 'c', 'd']);
    });

    it('drops the dead and the unpositioned', () => {
        const roster = [...living, actor('dead', 'T1', 0), actor('off', undefined)];
        expect(ids(targetableEnemies(FRONT, roster, statusFrom({})))).toEqual(['a', 'b', 'c', 'd']);
    });

    it('Provoked → the Provoker alone, over a Taunter and through its Stealth', () => {
        const so = statusFrom({ b: { taunting: true }, c: { stealthed: true } });
        expect(ids(targetableEnemies(FRONT, living, so, { provokedBy: 'c' }))).toEqual(['c']);
    });

    it('a dead or absent Provoker falls through to Taunt', () => {
        const so = statusFrom({ b: { taunting: true } });
        expect(ids(targetableEnemies(FRONT, living, so, { provokedBy: 'gone' }))).toEqual(['b']);
    });

    it('Taunted → every Taunter, a stealthed one included', () => {
        const so = statusFrom({
            b: { taunting: true, stealthed: true },
            d: { taunting: true },
            a: { stealthed: true },
        });
        expect(ids(targetableEnemies(FRONT, living, so))).toEqual(['b', 'd']);
    });

    it('Stealth → every enemy not in Stealth', () => {
        const so = statusFrom({ a: { stealthed: true }, c: { stealthed: true } });
        expect(ids(targetableEnemies(FRONT, living, so))).toEqual(['b', 'd']);
    });

    it('every enemy in Stealth → all of them', () => {
        const so = statusFrom({
            a: { stealthed: true },
            b: { stealthed: true },
            c: { stealthed: true },
            d: { stealthed: true },
        });
        expect(ids(targetableEnemies(FRONT, living, so))).toEqual(['a', 'b', 'c', 'd']);
    });

    it('ignoresProvoke skips the Provoke step only', () => {
        const so = statusFrom({ b: { taunting: true } });
        const acting: PositionalActing = { provokedBy: 'c', ignoresProvoke: true };
        expect(ids(targetableEnemies(FRONT, living, so, acting))).toEqual(['b']);
    });

    it('ignoresTaunt skips the Taunt step only', () => {
        const so = statusFrom({ b: { taunting: true }, a: { stealthed: true } });
        expect(ids(targetableEnemies(FRONT, living, so, { ignoresTaunt: true }))).toEqual([
            'b',
            'c',
            'd',
        ]);
        expect(
            ids(targetableEnemies(FRONT, living, so, { ignoresTaunt: true, provokedBy: 'a' }))
        ).toEqual(['a']);
    });

    it('an attacker or cast ignoring Stealth sees every enemy', () => {
        const so = statusFrom({ a: { stealthed: true } });
        expect(ids(targetableEnemies(FRONT, living, so, { ignoresStealth: true }))).toEqual([
            'a',
            'b',
            'c',
            'd',
        ]);
        expect(ids(targetableEnemies({ ...FRONT, ignoresStealth: true }, living, so))).toEqual([
            'a',
            'b',
            'c',
            'd',
        ]);
    });

    it('one Concentrate Fire mark → that enemy alone, over a Taunter and through Stealth', () => {
        const so = statusFrom({
            a: { concentrated: true, stealthed: true },
            b: { taunting: true },
        });
        expect(ids(targetableEnemies(FRONT, living, so))).toEqual(['a']);
    });

    it('several Concentrate Fire marks → every marked enemy', () => {
        const so = statusFrom({ a: { concentrated: true }, c: { concentrated: true } });
        expect(ids(targetableEnemies(FRONT, living, so))).toEqual(['a', 'c']);
    });

    it('Concentrate Fire beats Provoke and Taunt', () => {
        const so = statusFrom({ a: { concentrated: true }, b: { taunting: true } });
        expect(ids(targetableEnemies(FRONT, living, so, { provokedBy: 'c' }))).toEqual(['a']);
    });

    it('ignoresConcentrateFire skips the mark, falling to Provoke then Taunt', () => {
        const so = statusFrom({ a: { concentrated: true }, b: { taunting: true } });
        expect(ids(targetableEnemies(FRONT, living, so, { ignoresConcentrateFire: true }))).toEqual(
            ['b']
        );
        expect(
            ids(
                targetableEnemies(FRONT, living, so, {
                    ignoresConcentrateFire: true,
                    provokedBy: 'c',
                })
            )
        ).toEqual(['c']);
    });

    it('ignoresTaunt / ignoresProvoke do not skip Concentrate Fire', () => {
        const so = statusFrom({ a: { concentrated: true } });
        expect(
            ids(
                targetableEnemies(FRONT, living, so, {
                    ignoresTaunt: true,
                    ignoresProvoke: true,
                    provokedBy: 'c',
                })
            )
        ).toEqual(['a']);
    });

    it('without a status lookup nothing narrows it', () => {
        expect(ids(targetableEnemies(FRONT, living, undefined, { provokedBy: 'a' }))).toEqual([
            'a',
            'b',
            'c',
            'd',
        ]);
    });
});

describe('castFootprint on an All Targetable pattern', () => {
    const ALL = parsePattern('Pattern-All');
    const ALL_TARGETABLE = parsePattern('Pattern-All-Targetable');
    const so = statusFrom({ b: { taunting: true }, d: { taunting: true } });

    it('strikes only the targetable enemies, every one primary at full damage', () => {
        const { victims, allPrimary } = castFootprint(ALL_TARGETABLE, FRONT, 'M4', living, so);
        expect(victims.map((v) => [v.victim.id, v.roleScale]).sort()).toEqual([
            ['b', 1],
            ['d', 1],
        ]);
        expect(allPrimary).toBe(true);
    });

    it('a Provoked caster strikes only its Provoker', () => {
        const { victims } = castFootprint(ALL_TARGETABLE, FRONT, 'M4', living, so, {
            provokedBy: 'c',
        });
        expect(victims.map((v) => v.victim.id)).toEqual(['c']);
    });

    it('keeps the Pattern-All footprint order', () => {
        const whole = castFootprint(ALL, FRONT, 'M4', living, statusFrom({})).victims;
        const targetable = castFootprint(
            ALL_TARGETABLE,
            FRONT,
            'M4',
            living,
            statusFrom({})
        ).victims;
        expect(targetable.map((v) => v.victim.id)).toEqual(whole.map((v) => v.victim.id));
    });

    it('plain Pattern-All still strikes everyone under Taunt', () => {
        const { victims } = castFootprint(ALL, FRONT, 'M4', living, so, { provokedBy: 'c' });
        expect(victims.map((v) => v.victim.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    });
});
