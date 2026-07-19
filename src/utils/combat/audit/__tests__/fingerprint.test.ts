import { describe, it, expect } from 'vitest';
import { fingerprintActor, diffFingerprints, runDifferential } from '../fingerprint';
import type { BattleResult } from '../../../calculators/battleSimulator';

const fakeResult = (kindsByActor: Record<string, string[]>): BattleResult =>
    ({
        rounds: [],
        outcome: { winner: 'draw', lastRound: 1 },
        roster: [],
        combatLog: [
            {
                round: 1,
                startOfRound: [],
                turns: [
                    {
                        actorId: 'x',
                        entries: Object.entries(kindsByActor).flatMap(([actorId, kinds]) =>
                            kinds.map((kind) => ({ kind, actorId, targets: [], reactions: [] }))
                        ),
                    },
                ],
                endOfRound: [],
            },
        ],
    }) as unknown as BattleResult;

describe('fingerprint', () => {
    it('collects the kinds an actor produced across the log', () => {
        const r = fakeResult({ a: ['attack', 'heal', 'attack'] });
        expect([...fingerprintActor(r, 'a')].sort()).toEqual(['attack', 'heal']);
    });

    it('flags a kind present solo but missing in composition', () => {
        const solo = fingerprintActor(fakeResult({ a: ['attack', 'heal'] }), 'a');
        const comp = fingerprintActor(fakeResult({ a: ['attack'] }), 'a');
        const diff = diffFingerprints('ShipA', 'a', solo, comp);
        expect(diff?.missingInComposition).toContain('heal');
        expect(diff?.extraInComposition).toEqual([]);
    });

    it('returns null when fingerprints match', () => {
        const solo = fingerprintActor(fakeResult({ a: ['attack'] }), 'a');
        const comp = fingerprintActor(fakeResult({ a: ['attack'] }), 'a');
        expect(diffFingerprints('ShipA', 'a', solo, comp)).toBeNull();
    });
});

describe('runDifferential', () => {
    it('fingerprints each result via its own actorId and returns a diff when they differ', () => {
        // Solo run: the ship acts as 'p1_ship' and both attacks and heals.
        const soloResult = fakeResult({ p1_ship: ['attack', 'heal'] });
        // Composition run: the SAME ship is assigned a different actorId (roster-dependent)
        // and only attacks — the heal is suppressed by some interaction in the kit.
        const compResult = fakeResult({ comp_actor_3: ['attack'] });

        const diff = runDifferential(soloResult, compResult, 'ShipA', 'p1_ship', 'comp_actor_3');

        expect(diff).not.toBeNull();
        expect(diff?.actorId).toBe('comp_actor_3');
        expect(diff?.shipName).toBe('ShipA');
        expect(diff?.missingInComposition).toContain('heal');
        expect(diff?.extraInComposition).toEqual([]);
    });

    it('returns null when the two per-actor fingerprints match', () => {
        const soloResult = fakeResult({ p1_ship: ['attack', 'heal'] });
        const compResult = fakeResult({ comp_actor_3: ['attack', 'heal'] });

        expect(
            runDifferential(soloResult, compResult, 'ShipA', 'p1_ship', 'comp_actor_3')
        ).toBeNull();
    });
});
