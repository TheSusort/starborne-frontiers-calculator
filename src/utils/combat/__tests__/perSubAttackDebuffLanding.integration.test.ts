/**
 * Direct debuff clauses land per SUB-ATTACK (multi-hit full-walk epic, PR8).
 *
 * R1: a multi-hit skill is N consecutive FULL-WALK attacks, each running the entire pipeline
 * including the debuff landing roll. This file owns PR8's fidelity assertions; the
 * once-per-cast before-picture lives in `incomingDebuffArrivalCardinality.integration.test.ts`.
 *
 * CORPUS-INERT (measured 2026-08-09): 147 ships, only Enforcer has `hits > 1`, 49 ships carry a
 * direct active/charged debuff-inflict clause, intersection EMPTY. Every fixture here is
 * therefore synthetic, and synthetic fixtures are the only verification this behaviour gets —
 * which is why each assertion below carries an anti-vacuity control.
 *
 * Task 5 fills in the fidelity assertions; this file currently holds only the compile-time shape
 * probe below.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resetRateGateRng } from '../../calculators/rateAccumulator';
import { runPlayerTurn } from '../playerTurn';

describe('PR8 Task 3 — runPlayerTurn exposes a per-sub-attack landing applier', () => {
    afterEach(() => resetRateGateRng());

    it('exports the split deferred-application shape', () => {
        // Compile-time contract: the pair must be {applyState, emitEvents}, not a bare thunk.
        // A bare thunk cannot be run in two places, which is exactly what PR8 needs — state at the
        // sub-attack boundary, events interleaved into the engine's emission steps.
        const probe: import('../playerTurn').DeferredEnemyApplication = {
            applyState: () => {},
            emitEvents: () => {},
        };
        expect(typeof probe.applyState).toBe('function');
        expect(typeof probe.emitEvents).toBe('function');
        expect(typeof runPlayerTurn).toBe('function');
    });
});
