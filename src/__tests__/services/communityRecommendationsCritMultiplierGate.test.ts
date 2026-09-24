import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    CommunityRecommendationService,
    CritMultiplierShareNotAllowedError,
} from '../../services/communityRecommendations';
import { supabase } from '../../config/supabase';
import type {
    CreateCommunityRecommendationInput,
    SharedAutogearBuild,
} from '../../types/communityRecommendation';

vi.mock('../../config/supabase', () => ({
    supabase: {
        from: vi.fn(),
    },
}));

const buildWithCritMultiplierBonus: SharedAutogearBuild = {
    version: 1,
    shipRole: 'ATTACKER',
    statPriorities: [],
    setPriorities: [],
    statBonuses: [{ stat: 'critMultiplier', percentage: 100, mode: 'multiplier' }],
    fleetBuffs: [],
    excludedImplantTypes: [],
    optimizeImplants: false,
};

const baseInput: CreateCommunityRecommendationInput = {
    shipName: 'Test Ship',
    shipRefitLevel: 3,
    title: 'A build',
    isImplantSpecific: false,
    sharedConfig: buildWithCritMultiplierBonus,
};

// Mirrors the RolelessShareNotAllowedError coverage in communityRecommendations.test.ts, for
// the sibling gate ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE: every bundle in the field reads
// critMultiplier in limitableStatSchema, so the switch is on and this build now writes.
describe('CommunityRecommendationService.createRecommendation — crit multiplier gate', () => {
    beforeEach(() => vi.clearAllMocks());

    // No explicit third/fourth argument: this is the call the hook actually makes, so it must
    // exercise ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE's real default.
    it('writes a build referencing critMultiplier by default, now that ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE is on', async () => {
        const single = vi.fn().mockResolvedValue({ data: { id: 'rec-1' }, error: null });
        const select = vi.fn().mockReturnValue({ single });
        const insert = vi.fn().mockReturnValue({ select });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

        const result = await CommunityRecommendationService.createRecommendation(
            baseInput,
            'profile-1'
        );

        expect(result).toEqual({ id: 'rec-1' });
        expect(insert).toHaveBeenCalledTimes(1);
    });

    // Defence in depth: any caller that explicitly opts out via `allowCritMultiplier: false`
    // must still be refused, independent of the switch.
    it('refuses to write a build referencing critMultiplier when allowCritMultiplier is explicitly false, without calling insert', async () => {
        const insert = vi.fn();
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

        const call = CommunityRecommendationService.createRecommendation(
            baseInput,
            'profile-1',
            // allowRoleless (unrelated to this gate — this build has a role)
            false,
            // allowCritMultiplier
            false
        );

        // Specifically the crit-multiplier gate, not just "some error" — this build is
        // otherwise schema-valid (InvalidSharedConfigError would fire earlier for a genuinely
        // malformed build), which would make a bare `.rejects.toThrow()` pass for the wrong
        // reason.
        await expect(call.catch((e) => e)).resolves.toBeInstanceOf(
            CritMultiplierShareNotAllowedError
        );
        expect(insert).not.toHaveBeenCalled();
    });

    it('does not gate a build with no critMultiplier reference', async () => {
        const single = vi.fn().mockResolvedValue({ data: { id: 'rec-1' }, error: null });
        const select = vi.fn().mockReturnValue({ single });
        const insert = vi.fn().mockReturnValue({ select });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

        const plainBuild: SharedAutogearBuild = {
            ...buildWithCritMultiplierBonus,
            statBonuses: [],
        };

        const result = await CommunityRecommendationService.createRecommendation(
            { ...baseInput, sharedConfig: plainBuild },
            'profile-1'
        );

        expect(result).toEqual({ id: 'rec-1' });
        expect(insert).toHaveBeenCalledTimes(1);
    });
});
