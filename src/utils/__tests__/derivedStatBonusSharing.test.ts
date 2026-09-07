import { describe, it, expect } from 'vitest';
import { validateSharedAutogearBuild } from '../../schemas/sharedAutogearBuild';
import { toCommunityBuild } from '../communityBuild';
import type { CommunityRecommendation } from '../../types/communityRecommendation';

// sharedAutogearBuildSchema requires version/excludedImplantTypes/optimizeImplants
// (none are `.optional()`) — see src/schemas/sharedAutogearBuild.ts.
const build = (over: Record<string, unknown> = {}) => ({
    version: 1,
    shipRole: 'DEBUFFER_BOMBER',
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    fleetBuffs: [],
    excludedImplantTypes: [],
    optimizeImplants: false,
    ...over,
});

describe('derived stats in shared builds', () => {
    it('accepts a directDamage stat BONUS', () => {
        expect(
            validateSharedAutogearBuild(
                build({
                    statBonuses: [{ stat: 'directDamage', percentage: 60, mode: 'multiplier' }],
                })
            )
        ).not.toBeNull();
    });

    it('accepts an effectiveHp stat BONUS', () => {
        expect(
            validateSharedAutogearBuild(
                build({ statBonuses: [{ stat: 'effectiveHp', percentage: 40, mode: 'additive' }] })
            )
        ).not.toBeNull();
    });

    // Fleet buffs model a real in-game buff on a real stat. There is no fleet buff of
    // "direct damage", and widening them was explicitly out of scope.
    it('REJECTS a directDamage FLEET BUFF', () => {
        expect(
            validateSharedAutogearBuild(
                build({ fleetBuffs: [{ stat: 'directDamage', percentage: 30 }] })
            )
        ).toBeNull();
    });

    it('still rejects a nonsense bonus stat', () => {
        expect(
            validateSharedAutogearBuild(
                build({ statBonuses: [{ stat: 'notAStat', percentage: 10 }] })
            )
        ).toBeNull();
    });
});

// Copied verbatim from communityBuildLegacyShapes.test.ts's makeRow — that helper
// reproduces shapes verified against real production rows.
const makeRow = (over: Partial<CommunityRecommendation> = {}): CommunityRecommendation => ({
    id: 'r1',
    ship_name: 'Demolisher',
    ship_refit_level: 3,
    title: 'DEBUFFER (Bomber) Build',
    is_implant_specific: false,
    ship_role: 'DEBUFFER_BOMBER',
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

describe('legacy label recovery for derived bonus stats', () => {
    it("resolves a bonus recorded as the display label 'Direct Damage'", () => {
        const built = toCommunityBuild(
            makeRow({
                stat_bonuses: [
                    { stat: 'Direct Damage', percentage: 60, mode: 'multiplier' } as never,
                ],
            })
        );
        expect(built).not.toBeNull();
        expect(built!.build.statBonuses[0].stat).toBe('directDamage');
    });

    it('still resolves a legacy real-stat label', () => {
        const built = toCommunityBuild(
            makeRow({ stat_bonuses: [{ stat: 'crit rate', percentage: 20 } as never] })
        );
        expect(built).not.toBeNull();
        expect(built!.build.statBonuses[0].stat).toBe('crit');
    });
});
