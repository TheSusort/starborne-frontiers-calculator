import { describe, it, expect } from 'vitest';
import {
    fingerprintActor,
    diffFingerprints,
    runDifferential,
    fingerprintActorTokens,
} from '../fingerprint';
import type { BattleResult } from '../../../calculators/battleSimulator';
import type { CombatLogEntry } from '../../log/types';

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

/** Minimal BattleResult carrying only the combatLog shape fingerprinting walks. */
const resultWith = (entries: CombatLogEntry[]): BattleResult =>
    ({
        combatLog: [{ round: 1, startOfRound: [], turns: [{ entries }], endOfRound: [] }],
    }) as unknown as BattleResult;

const entry = (over: Partial<CombatLogEntry>): CombatLogEntry => ({
    kind: 'attack',
    actorId: 'a',
    targets: [],
    reactions: [],
    ...over,
});

describe('fingerprintActorTokens', () => {
    it('suffixes a cast-sourced entry with its slot and leaves a passive entry bare', () => {
        // The Malvex case: an active-slot shield grant and a passive on-damaged shield grant are
        // the SAME kind. Bare-kind fingerprinting cannot tell them apart, so a bug that ungates
        // the active one is invisible. The slot suffix is what separates them.
        const tokens = fingerprintActorTokens(
            resultWith([
                entry({ kind: 'shield', slot: 'active', skillName: 'Shield Surge' }),
                entry({ kind: 'shield' }),
            ]),
            'a'
        );
        expect(tokens).toEqual(['shield', 'shield:active']);
    });

    it('is sorted and de-duplicated so entry order can never churn a snapshot', () => {
        const tokens = fingerprintActorTokens(
            resultWith([
                entry({ kind: 'heal', slot: 'charged' }),
                entry({ kind: 'attack', slot: 'active' }),
                entry({ kind: 'attack', slot: 'active' }),
            ]),
            'a'
        );
        expect(tokens).toEqual(['attack:active', 'heal:charged']);
    });

    it('walks nested reactions and ignores other actors', () => {
        const tokens = fingerprintActorTokens(
            resultWith([
                entry({
                    kind: 'attack',
                    actorId: 'other',
                    reactions: [entry({ kind: 'heal', actorId: 'a' })],
                }),
            ]),
            'a'
        );
        expect(tokens).toEqual(['heal']);
    });

    it('excludes skillName from the token (a rename must not move a snapshot)', () => {
        const a = fingerprintActorTokens(
            resultWith([entry({ kind: 'attack', slot: 'active', skillName: 'Old Name' })]),
            'a'
        );
        const b = fingerprintActorTokens(
            resultWith([entry({ kind: 'attack', slot: 'active', skillName: 'New Name' })]),
            'a'
        );
        expect(a).toEqual(b);
    });

    it('walks startOfRound and endOfRound, not just turn entries', () => {
        const result = {
            combatLog: [
                {
                    round: 1,
                    startOfRound: [entry({ kind: 'dot-ticked' })],
                    turns: [],
                    endOfRound: [entry({ kind: 'buff-expired' })],
                },
            ],
        } as unknown as BattleResult;
        expect(fingerprintActorTokens(result, 'a')).toEqual(['buff-expired', 'dot-ticked']);
    });
});
