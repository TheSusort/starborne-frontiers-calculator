import { describe, it, expect } from 'vitest';
import {
    CHARGED_OVERDRIVE_II,
    CHARGED_OVERDRIVE_II_PEN,
    holdsChargedOverdriveII,
    consumeChargedOverdriveII,
} from '../chargedOverdrive';
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
                'chargedOverdrive must NOT read the broad name union - see the one-shot invariant'
            );
        },
    } as unknown as StatusEngine;
    return { engine, removed };
};

describe('Charged Overdrive II read/consume', () => {
    it('exposes 20 percentage points of Defense Penetration', () => {
        expect(CHARGED_OVERDRIVE_II_PEN).toBe(20);
    });

    it('reports held when the timed/persistent channel carries it', () => {
        const { engine } = stubEngine([CHARGED_OVERDRIVE_II]);
        expect(holdsChargedOverdriveII(engine, 'victim-1')).toBe(true);
    });

    it('reports not held when the channel is empty', () => {
        const { engine } = stubEngine([]);
        expect(holdsChargedOverdriveII(engine, 'victim-1')).toBe(false);
    });

    it('does NOT match the standing Charge Overdrive II', () => {
        const { engine } = stubEngine(['Charge Overdrive II']);
        expect(holdsChargedOverdriveII(engine, 'victim-1')).toBe(false);
    });

    it('consume clears it, so a second read is false', () => {
        const { engine, removed } = stubEngine([CHARGED_OVERDRIVE_II]);
        consumeChargedOverdriveII(engine, 'victim-1');
        expect(removed).toEqual([`victim-1:${CHARGED_OVERDRIVE_II}`]);
        expect(holdsChargedOverdriveII(engine, 'victim-1')).toBe(false);
    });

    it('consume is a safe no-op when the actor holds none', () => {
        const { engine } = stubEngine([]);
        expect(() => consumeChargedOverdriveII(engine, 'victim-1')).not.toThrow();
    });
});
