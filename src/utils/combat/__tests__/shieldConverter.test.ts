import { describe, it, expect } from 'vitest';
import { SHIELD_CONVERTER, holdsShieldConverter, consumeShieldConverter } from '../shieldConverter';
import type { StatusEngine } from '../statusEngine';

/** Minimal StatusEngine stub exposing only what the module is allowed to touch. A stub this
 *  narrow is the point: if the module ever reaches for selfBuffNamesForOwners, this test throws
 *  instead of silently passing. */
const stubEngine = (timedNames: string[]) => {
    const names = [...timedNames];
    const removed: string[] = [];
    const engine = {
        timedAbilityStatuses: (side: 'self' | 'enemy', actorId?: string) => {
            expect(side).toBe('self');
            expect(actorId).toBe('victim-1');
            return names.map((buffName) => ({ active: { buffName } }));
        },
        removeSelfBuffByName: (actorId: string, buffName: string) => {
            removed.push(`${actorId}:${buffName}`);
            const i = names.indexOf(buffName);
            if (i >= 0) names.splice(i, 1);
        },
        selfBuffNamesForOwners: () => {
            throw new Error(
                'shieldConverter must NOT read the broad name union - see the one-shot invariant'
            );
        },
    } as unknown as StatusEngine;
    return { engine, removed };
};

describe('Shield Converter read/consume', () => {
    it('reports held when the timed/persistent channel carries it', () => {
        const { engine } = stubEngine([SHIELD_CONVERTER]);
        expect(holdsShieldConverter(engine, 'victim-1')).toBe(true);
    });

    it('reports not held when the channel is empty', () => {
        const { engine } = stubEngine([]);
        expect(holdsShieldConverter(engine, 'victim-1')).toBe(false);
    });

    it('ignores unrelated statuses on the same channel', () => {
        const { engine } = stubEngine(['Hit Mitigation', 'Barrier']);
        expect(holdsShieldConverter(engine, 'victim-1')).toBe(false);
    });

    it('consume clears it, so a second read is false', () => {
        const { engine, removed } = stubEngine([SHIELD_CONVERTER]);
        consumeShieldConverter(engine, 'victim-1');
        expect(removed).toEqual([`victim-1:${SHIELD_CONVERTER}`]);
        expect(holdsShieldConverter(engine, 'victim-1')).toBe(false);
    });

    it('consume is a safe no-op when the actor holds none', () => {
        const { engine } = stubEngine([]);
        expect(() => consumeShieldConverter(engine, 'victim-1')).not.toThrow();
    });
});
