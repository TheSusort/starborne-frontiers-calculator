import { describe, it, expect } from 'vitest';
import {
    DEFAULT_HEALER_SLOT,
    defaultHealTargetSlot,
    defaultHealingTeamSlot,
    defaultEnemySlot,
    resolveEnemySlots,
} from '../healingPlacement';
import { parsePattern } from '../../targetingParser';
import { resolveCells } from '../../targeting/resolvePattern';

describe('healing calculator default placement', () => {
    it('the healer, heal target, and team ships never share a default slot', () => {
        const slots = [
            DEFAULT_HEALER_SLOT,
            defaultHealTargetSlot(),
            ...[0, 1, 2, 3].map(defaultHealingTeamSlot),
        ];
        expect(new Set(slots).size).toBe(slots.length);
    });

    it('gives the heal target NO front bias (decision 2)', () => {
        // Column 4 is the FRONT. The heal target must not be seeded there just to keep taking
        // damage — the owner ruled placement is explicit.
        //
        // NOTE: called with no arguments, this only exercises the unconditional
        // `!healerPattern?.modifiers.support` neutral-fallback early return — it never reaches the
        // `covered.find((p) => !p.endsWith('4'))` front-avoidance line below. That line's actual
        // front-column *priority* is covered by 'prefers a non-front covered cell over the naive
        // first match' in the decision-9 describe block below.
        expect(defaultHealTargetSlot().endsWith('4')).toBe(false);
    });

    it('seeds distinct enemy slots', () => {
        const slots = [0, 1, 2, 3].map(defaultEnemySlot);
        expect(new Set(slots).size).toBe(slots.length);
    });

    it('resolveEnemySlots pushes a colliding enemy to a free slot', () => {
        expect(resolveEnemySlots(['M4', 'M4'])).toEqual(['M4', 'T1']);
    });

    it('resolveEnemySlots keeps non-colliding slots untouched', () => {
        expect(resolveEnemySlots(['M4', 'M3', 'B2'])).toEqual(['M4', 'M3', 'B2']);
    });

    it('returns a same-length array', () => {
        expect(resolveEnemySlots(['M4', 'M4', 'M4'])).toHaveLength(3);
    });
});

// ── Decision 9: minimal autoplace ───────────────────────────────────────────
// Seed the heal target into a cell the HEALER's own support footprint covers, so a default board
// does not silently produce zero healing. Only SUPPORT patterns filter ally recipients
// (`supportFootprintAllyIds` returns undefined otherwise), so a non-support pattern needs no
// autoplace at all.
describe('defaultHealTargetSlot — minimal autoplace (decision 9)', () => {
    it('seeds a cell the healer support footprint covers', () => {
        // Pattern-Line-Support-Range-1 @ M2 covers {M2, M3} (resolvePattern.test.ts:83-87 shows the
        // M3 anchor case; from M2 the forward cell is M3). M2 is the healer's own cell, so the heal
        // target must land on M3.
        expect(defaultHealTargetSlot('M2', parsePattern('Pattern-Line-Support-Range-1'))).toBe(
            'M3'
        );
    });

    it('never returns the healer own cell', () => {
        const slot = defaultHealTargetSlot('M2', parsePattern('Pattern-Line-Support-Range-3'));
        expect(slot).not.toBe('M2');
    });

    it('still respects decision 2 — no front bias when an alternative exists', () => {
        // Range-3 @ M1 covers {M1, M2, M3, M4}. M4 is the FRONT column and must not be preferred
        // while M2/M3 are available.
        const slot = defaultHealTargetSlot('M1', parsePattern('Pattern-Line-Support-Range-3'));
        expect(slot).not.toBe('M4');
        expect(['M2', 'M3']).toContain(slot);
    });

    it('falls back to the neutral default when no pattern is known (manual entry)', () => {
        expect(defaultHealTargetSlot('M2', undefined)).toBe('M3');
    });

    it('falls back to the neutral default for a NON-support pattern', () => {
        // A non-support pattern never filters ally recipients, so coverage is irrelevant.
        expect(defaultHealTargetSlot('M2', parsePattern('Pattern-Cone-Range-1'))).toBe('M3');
    });

    it('falls back gracefully when the footprint covers only the healer own cell', () => {
        // Line-Support-Range-1 @ M4: the forward cell clips off-board, leaving {M4} — the healer's
        // own cell. No covered cell is available for the heal target, so take the neutral default
        // rather than returning M4 (two actors cannot share a cell).
        expect(defaultHealTargetSlot('M4', parsePattern('Pattern-Line-Support-Range-1'))).toBe(
            'M3'
        );
    });

    it('falls back to the neutral default instead of THROWING on a tableless pattern', () => {
        // `Pattern-Line-Support-Range-2` parses cleanly to signature `line|2|support`, which has NO
        // offset table, so `resolveCells` throws (resolvePattern.ts:40) — and this helper is on
        // `simulateHealing`'s hot path, so an unguarded throw becomes a React render crash once the
        // UI threads real ship targeting. No ship in `docs/ship-targeting.csv` currently uses it, so
        // this is a tripwire for a future offset-table gap, not a live bug.
        const pattern = parsePattern('Pattern-Line-Support-Range-2');
        // Precondition: the underlying call really does throw, or this test guards nothing.
        expect(() => resolveCells(pattern, 'M2')).toThrow();
        expect(defaultHealTargetSlot('M2', pattern)).toBe('M3');
    });

    it('prefers a non-front covered cell over the naive first match', () => {
        // Every other case in this file uses a forward-LINE pattern, where traversal order always
        // places the column-4 cell last in `covered` — so "prefer non-front" and "take the first
        // covered cell" coincide and neither this describe block nor the top-level no-front-bias
        // test can distinguish `covered.find((p) => !p.endsWith('4'))` from a naive `covered[0]`.
        // Pickaxe breaks that coincidence: its traversal visits the front cell FIRST.
        const pattern = parsePattern('Pattern-Support-Double-Pickaxe-Range-0');
        const covered = resolveCells(pattern, 'M3')
            .map((c) => c.position)
            .filter((p) => p !== 'M3');

        // Precondition: the naive-first choice really is a front-column cell. This is what makes
        // the test load-bearing — it guarantees the assertion below actually exercises
        // front-avoidance rather than agreeing with it by coincidence. If a future change to the
        // pickaxe offset table makes this false, this assertion is the tripwire: it will fail
        // first and say so, instead of the test silently stopping protecting anything.
        expect(covered[0].endsWith('4')).toBe(true);

        expect(defaultHealTargetSlot('M3', pattern)).toBe('M2');
    });
});
