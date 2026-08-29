import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    CommunityRecommendationService,
    InvalidSharedConfigError,
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

const baseSharedConfig: SharedAutogearBuild = {
    version: 1 as const,
    shipRole: 'ATTACKER' as const,
    statPriorities: [{ stat: 'crit', minLimit: 100 }],
    setPriorities: [{ setName: 'CRITICAL', count: 4 }],
    statBonuses: [{ stat: 'attack', percentage: 30, mode: 'additive' as const }],
    fleetBuffs: [{ stat: 'attack', percentage: 30 }],
    excludedImplantTypes: [],
    optimizeImplants: true,
};

const baseInput: CreateCommunityRecommendationInput = {
    shipName: 'Test Ship',
    shipRefitLevel: 3,
    title: 'A build',
    isImplantSpecific: false,
    sharedConfig: baseSharedConfig,
};

describe('CommunityRecommendationService.createRecommendation', () => {
    beforeEach(() => vi.clearAllMocks());

    it('persists the zod-parsed (sanitised) build, not the raw input, into shared_config and the legacy columns', async () => {
        // Extra key a hostile or buggy caller could smuggle in — the schema's
        // object types strip it (zod's .strip()), and the insert payload must
        // reflect that stripped result rather than the original object.
        const rawSharedConfig = { ...baseSharedConfig, evilExtraKey: 'payload' };

        const single = vi
            .fn()
            .mockResolvedValue({ data: { id: 'rec-1', ...baseSharedConfig }, error: null });
        const select = vi.fn().mockReturnValue({ single });
        const insert = vi.fn().mockReturnValue({ select });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

        await CommunityRecommendationService.createRecommendation(
            { ...baseInput, sharedConfig: rawSharedConfig },
            'profile-1'
        );

        expect(insert).toHaveBeenCalledTimes(1);
        const payload = insert.mock.calls[0][0];

        expect(payload.shared_config).not.toHaveProperty('evilExtraKey');
        expect(payload.shared_config).toEqual(baseSharedConfig);

        // The legacy columns must derive from the same sanitised object, so they
        // cannot drift from shared_config or carry the extra key either.
        expect(payload.ship_role).toBe(baseSharedConfig.shipRole);
        expect(payload.stat_priorities).toEqual(baseSharedConfig.statPriorities);
        expect(payload.stat_bonuses).toEqual(baseSharedConfig.statBonuses);
        expect(payload.set_priorities).toEqual(baseSharedConfig.setPriorities);
    });

    it('throws InvalidSharedConfigError and never calls insert for an invalid build', async () => {
        const insert = vi.fn();
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

        const invalidInput = {
            ...baseInput,
            sharedConfig: { ...baseSharedConfig, shipRole: 'NOT_A_ROLE' },
        };

        await expect(
            CommunityRecommendationService.createRecommendation(invalidInput as never, 'profile-1')
        ).rejects.toThrow(InvalidSharedConfigError);

        expect(insert).not.toHaveBeenCalled();
    });
});
