import { describe, it, expect } from 'vitest';
import { toCommunityBuild, normalizeShipRole } from '../communityBuild';
import type { CommunityRecommendation } from '../../types/communityRecommendation';

/**
 * Every fixture here reproduces a shape verified against real production
 * `community_recommendations` rows (see the #429 merge-blocker investigation),
 * NOT a hand-written shape that happens to satisfy the schema. Before this
 * fix, every one of these rows was silently dropped from the UI.
 */

const makeRow = (over: Partial<CommunityRecommendation> = {}): CommunityRecommendation => ({
    id: 'r1',
    ship_name: 'Valerian',
    ship_refit_level: 3,
    title: 'DEBUFFER (Corrosion) Build',
    is_implant_specific: false,
    ship_role: 'ATTACKER',
    stat_priorities: [{ stat: 'hacking', minLimit: 100 }],
    stat_bonuses: [{ stat: 'attack', percentage: 30 }],
    set_priorities: [{ setName: 'CRITICAL', count: 4 }],
    upvotes: 0,
    downvotes: 0,
    total_votes: 0,
    score: 0,
    created_at: '2026-08-01T00:00:00Z',
    ...over,
});

describe('normalizeShipRole', () => {
    // All five distinct real production ship_role values, verified live.
    it.each([
        ['DEBUFFER (Corrosion)', 'DEBUFFER_CORROSION'],
        ['DEFENDER (Security)', 'DEFENDER_SECURITY'],
        ['DEFENDER(SECURITY)', 'DEFENDER_SECURITY'],
        ['SUPPORTER (Offensive)', 'SUPPORTER_OFFENSIVE'],
        ['CORROSION', 'DEBUFFER_CORROSION'],
    ])('normalises %s to %s', (raw, expected) => {
        expect(normalizeShipRole(raw)).toBe(expected);
    });

    it('returns null for a nonsense value that resolves to nothing', () => {
        expect(normalizeShipRole('ZONK')).toBeNull();
        expect(normalizeShipRole('')).toBeNull();
    });

    it('degrades a future compound role to its longest known prefix', () => {
        // No real SHIP_TYPES key ends with '_SOMETHINGNEW', and
        // 'DEBUFFER_SOMETHINGNEW' itself isn't a key either, but 'DEBUFFER' is.
        expect(normalizeShipRole('DEBUFFER (SomethingNew)')).toBe('DEBUFFER');
    });
});

describe('toCommunityBuild — real legacy row shapes', () => {
    it('resolves a row with all three defects at once (real row: Valerian "DEBUFFER (Corrosion) Build")', () => {
        const build = toCommunityBuild(
            makeRow({
                ship_role: 'DEBUFFER (Corrosion)',
                set_priorities: [{ setName: 'DECIMATION' } as never],
                stat_bonuses: [{ stat: 'hp', weight: 5 } as never],
            })
        );

        expect(build).not.toBeNull();
        expect(build?.isLegacy).toBe(true);
        expect(build?.build.shipRole).toBe('DEBUFFER_CORROSION');
        expect(build?.build.setPriorities).toEqual([{ setName: 'DECIMATION' }]);
        expect(build?.build.setPriorities[0].count).toBeUndefined();
        expect(build?.build.statBonuses).toEqual([{ stat: 'hp', percentage: 5 }]);
    });

    it('resolves a row whose only defect is a display-label ship_role', () => {
        const build = toCommunityBuild(makeRow({ ship_role: 'DEFENDER(SECURITY)' }));
        expect(build).not.toBeNull();
        expect(build?.build.shipRole).toBe('DEFENDER_SECURITY');
    });

    it('resolves a row whose only defect is a countless set priority', () => {
        const build = toCommunityBuild(
            makeRow({ set_priorities: [{ setName: 'DECIMATION' } as never] })
        );
        expect(build).not.toBeNull();
        expect(build?.build.setPriorities).toEqual([{ setName: 'DECIMATION' }]);
    });

    it('resolves a row whose only defect is a weight-shaped stat bonus', () => {
        const build = toCommunityBuild(
            makeRow({ stat_bonuses: [{ stat: 'hp', weight: 5 } as never] })
        );
        expect(build).not.toBeNull();
        expect(build?.build.statBonuses).toEqual([{ stat: 'hp', percentage: 5 }]);
    });

    it('still drops a row when the ship_role resolves to nothing usable', () => {
        expect(toCommunityBuild(makeRow({ ship_role: 'ZONK' }))).toBeNull();
    });
});
