import { describe, it, expect } from 'vitest';
import { generateLargeFileDiff } from '../starborneDiffCalculator';
import type { Equipment, ExportedPlayData, Unit } from '../../../types/starborne';

/**
 * Covers the equipment-moved-between-ships label built by `compareKeyProperties`.
 *
 * This page diffs arbitrary uploaded JSON, so a piece can arrive with no `Name` even though
 * the `Equipment` type declares one — hence the partial casts below. The label used to be an
 * `||` chain over three template literals, and a literal containing `★` is never falsy, so
 * the two fallbacks were unreachable and a nameless piece rendered "undefined ★ undefined".
 */

const unit = (Id: string, Name: string): Unit => ({ Id, Name }) as Unit;

const gear = (EquippedOnUnit: string | null, named: Partial<Equipment>): Equipment =>
    ({ Id: 'gear-1', EquippedOnUnit, Level: 16, Rank: 5, ...named }) as Equipment;

const data = (units: Unit[], equipment: Equipment[]): ExportedPlayData => ({
    Units: units,
    Equipment: equipment,
});

/** The one `EquippedOnUnit` change these fixtures produce. */
const moveDescription = (before: Equipment, after: Equipment): string => {
    const results = generateLargeFileDiff(
        data([unit('u1', 'Kestrel')], [before]),
        data([unit('u2', 'Magnolia')], [after])
    );
    const moves = results.filter((r) => r.description.includes('equipped from'));
    expect(moves).toHaveLength(1);
    return moves[0].description;
};

describe('generateLargeFileDiff — equipment moved between ships', () => {
    it('labels the move with the first file’s name when it has one', () => {
        const description = moveDescription(
            gear('u1', { Name: 'Photon Cannon', Rank: 5 }),
            gear('u2', { Name: 'Photon Cannon', Rank: 5 })
        );
        expect(description).toBe('5 ★ Photon Cannon equipped from Kestrel → Magnolia');
    });

    it('falls back to the second file’s name when the first piece is unnamed', () => {
        const description = moveDescription(
            gear('u1', { Rank: 5 }), // no Name — the case the dead `||` chain could not reach
            gear('u2', { Name: 'Photon Cannon', Rank: 3 })
        );
        expect(description).toBe('3 ★ Photon Cannon equipped from Kestrel → Magnolia');
        expect(description).not.toContain('undefined');
    });

    it('falls back to "Unknown Equipment" when neither file names the piece', () => {
        const description = moveDescription(gear('u1', {}), gear('u2', {}));
        expect(description).toBe('Unknown Equipment equipped from Kestrel → Magnolia');
        expect(description).not.toContain('undefined');
    });
});
