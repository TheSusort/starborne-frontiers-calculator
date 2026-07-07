/**
 * SP-E, Task E2 — `dotFamilyCounts` (the new per-family DoT-entry summarizer) and its wiring
 * into `enemyDotFamilyCounts`/`enemyDotCount` via `buildRoundContext`.
 *
 * The brief's original Step-1 sketch (`buildRoundContext` trivially passes an already-built
 * `enemyDotFamilyCounts` map through) is a no-op pass-through that already worked before this
 * task — it would pass red/green vacuously, so per the task's ambiguity resolution it is NOT
 * included here. What's genuinely new in this task is (a) the `dotFamilyCounts` derivation
 * helper itself, and (b) `genericCount` folding into the bare `enemyDotCount` sum. Both are
 * exercised below as real (non-vacuous) unit tests.
 *
 * The full engine-level integration (cheat-death unremovable-survival + a live family count)
 * is covered in `src/utils/combat/__tests__/enemyDotFamilyCounts.integration.test.ts`, which
 * needs `runCombat`/`createActor` from the combat engine.
 */
import { describe, it, expect } from 'vitest';
import { buildRoundContext, dotFamilyCounts } from '../roundContext';
import type { ActiveDoTStack } from '../../combat/state';

const stack = (partial: Partial<ActiveDoTStack> = {}): ActiveDoTStack => ({
    stacks: 1,
    tier: 15,
    remainingRounds: 2,
    sourceId: 'caster',
    ...partial,
});

describe('dotFamilyCounts', () => {
    it('sums corrosion + inferno + generic entries by their family tag', () => {
        const corrosion = [
            stack({ family: 'Acidic Decay', unremovable: true }),
            stack({ family: 'Acidic Decay', unremovable: true }),
        ];
        const inferno = [stack({ family: 'Molten Core' })];
        const generic = [stack({ family: 'Acidic Decay', unremovable: true, perTickAmount: 300 })];

        expect(dotFamilyCounts(corrosion, inferno, generic)).toEqual({
            'Acidic Decay': 3,
            'Molten Core': 1,
        });
    });

    it('untagged (family-less) entries contribute to no family — plain corrosion/inferno today', () => {
        const corrosion = [stack(), stack()];
        const inferno = [stack()];
        expect(dotFamilyCounts(corrosion, inferno, [])).toEqual({});
    });

    it('returns {} for three empty arrays (DPS-byte-identical default: no families exist)', () => {
        expect(dotFamilyCounts([], [], [])).toEqual({});
    });
});

describe('enemyDotFamilyCounts / genericCount via buildRoundContext', () => {
    const base = {
        selfBuffNames: [],
        landedEnemyDebuffCount: 0,
        corrosionEntryCount: 0,
        infernoEntryCount: 0,
        bombCount: 0,
        effectiveCritRate: 0,
    };

    it('a live-derived family map flows through into the ConditionContext untouched', () => {
        const corrosion = [
            stack({ family: 'Acidic Decay', unremovable: true }),
            stack({ family: 'Acidic Decay', unremovable: true }),
            stack(), // plain corrosion — no family
        ];
        const ctx = buildRoundContext({
            ...base,
            corrosionEntryCount: corrosion.length,
            enemyDotFamilyCounts: dotFamilyCounts(corrosion, [], []),
        });
        expect(ctx.enemyDotFamilyCounts).toEqual({ 'Acidic Decay': 2 });
    });

    it('omitting enemyDotFamilyCounts leaves it undefined (DPS-simulator default path)', () => {
        const ctx = buildRoundContext({ ...base });
        expect(ctx.enemyDotFamilyCounts).toBeUndefined();
    });

    it('genericCount folds into the bare enemyDotCount sum alongside corrosion/inferno/bomb', () => {
        const ctx = buildRoundContext({
            ...base,
            corrosionEntryCount: 1,
            infernoEntryCount: 1,
            bombCount: 1,
            genericCount: 2,
        });
        expect(ctx.enemyDotCount).toBe(5);
    });

    it('omitting genericCount defaults it to 0 (byte-identical for every existing DPS caller)', () => {
        const ctx = buildRoundContext({
            ...base,
            corrosionEntryCount: 1,
            infernoEntryCount: 1,
            bombCount: 1,
        });
        expect(ctx.enemyDotCount).toBe(3);
    });
});
