/**
 * `Reversed Repairs` status read (#362) — the SCHEDULED channel and the negative cases.
 *
 * Unlike Exposed (which deliberately reads only the timed channel, because "the next direct hit"
 * has no standing value to model), a 1-turn duration debuff DOES have a standing value — so a
 * hand-selected Reversed Repairs in the simulator must work.
 *
 * The TIMED channel is covered in `reversedRepairs.engine.test.ts` (Task 5) instead, through the
 * real production seam — a `debuff` ability on a firing slot. A unit test that hand-builds a
 * `RegisteredAbilityStatus` payload proves the mapping, not that the engine feeds it the right
 * input; and a wrong hand-built shape yields a vacuous red that turns green once you "fix"
 * production to match the mistake.
 *
 * `hasReversedRepairs` takes the victim's `{ id, side }` rather than a bare id (#362 fix-wave-1):
 * the scheduled channel is a single global list with no per-victim keying at all, so a bare id
 * gave callers no way to stop it leaking across teams. See `reversedRepairs.ts` for the full
 * explanation of why the gate lives on `side` and only on the scheduled arm.
 */
import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import type { SelectedGameBuff } from '../../../types/calculator';
import { hasReversedRepairs, REVERSED_REPAIRS } from '../reversedRepairs';

/** The calculator buff-picker's exact output shape: no skillSource and no skillDuration, which
 *  the status engine classifies as ALWAYS-ACTIVE (the scheduled channel). Copied from
 *  `exposedStatus.integration.test.ts`'s `applier: 'scheduled'` arm. */
const scheduled = (buffName: string): SelectedGameBuff => ({
    id: buffName,
    buffName,
    stacks: 1,
    parsedEffects: {},
    isStackable: false,
});

describe('hasReversedRepairs', () => {
    it('is false on a clean actor', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        expect(hasReversedRepairs(se, { id: 'victim-1', side: 'enemy' })).toBe(false);
    });

    it('reads the scheduled channel for an enemy-side victim (a hand-selected debuff in the simulator)', () => {
        const se = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [scheduled(REVERSED_REPAIRS)],
        });
        expect(hasReversedRepairs(se, { id: 'victim-1', side: 'enemy' })).toBe(true);
    });

    // Regression pin (#362 fix-wave-1): `enemyAlwaysSnap` (statusEngine.ts) builds from a single
    // global `alwaysEnemy` list with NO per-victim (or per-side) filtering. Before the fix, this
    // read `true` for literally any id passed in — including a player-side actor, which would
    // have their own team's repairs reversed into damage. Must stay false for player side.
    it('does NOT leak the scheduled channel onto a player-side victim', () => {
        const se = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [scheduled(REVERSED_REPAIRS)],
        });
        expect(hasReversedRepairs(se, { id: 'player-3', side: 'player' })).toBe(false);
        expect(hasReversedRepairs(se, { id: 'enemy-7', side: 'enemy' })).toBe(true);
    });

    it('does not confuse it with the other repair-named statuses', () => {
        const se = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [scheduled('Inc. Repair Down II'), scheduled('Block Repair')],
        });
        expect(hasReversedRepairs(se, { id: 'victim-1', side: 'enemy' })).toBe(false);
    });
});
