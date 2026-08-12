import { describe, it, expect } from 'vitest';
import {
    DEFAULT_HEALER_SLOT,
    defaultHealTargetSlot,
    defaultHealingTeamSlot,
    defaultEnemySlot,
    resolveEnemySlots,
} from '../healingPlacement';
import { parsePattern } from '../../targetingParser';

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
});
