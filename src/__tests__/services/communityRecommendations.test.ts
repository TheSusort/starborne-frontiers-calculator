import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    CommunityRecommendationService,
    InvalidSharedConfigError,
    ShipRoleColumnNotNullableError,
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

    // `ship_role` is `NOT NULL` in the database, but a Custom-mode build's `shipRole` is
    // null — the seeded-from role is what gets mirrored into that column instead.
    it("mirrors a Custom-mode build's seededFrom role into the legacy ship_role column", async () => {
        const customConfig: SharedAutogearBuild = {
            version: 2,
            shipRole: null,
            statPriorities: [],
            setPriorities: [],
            statBonuses: [],
            fleetBuffs: [],
            excludedImplantTypes: [],
            optimizeImplants: false,
            customFormula: {
                rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }],
                seededFrom: 'ATTACKER',
            },
        };

        const single = vi.fn().mockResolvedValue({ data: { id: 'rec-1' }, error: null });
        const select = vi.fn().mockReturnValue({ single });
        const insert = vi.fn().mockReturnValue({ select });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

        await CommunityRecommendationService.createRecommendation(
            { ...baseInput, sharedConfig: customConfig },
            'profile-1'
        );

        const payload = insert.mock.calls[0][0];
        expect(payload.ship_role).toBe('ATTACKER');
        expect(payload.shared_config.shipRole).toBeNull();
    });

    // A hand-written Custom formula with no seededFrom has no role to mirror. Writing a
    // placeholder would display as a role the author never chose, so this writes NULL
    // instead of refusing — `ship_role` is nullable
    // (20260923000001_nullable_community_recommendation_ship_role.sql).
    it('writes a null ship_role for a from-scratch Custom-mode build with no seededFrom to mirror', async () => {
        const fromScratch: SharedAutogearBuild = {
            version: 2,
            shipRole: null,
            statPriorities: [],
            setPriorities: [],
            statBonuses: [],
            fleetBuffs: [],
            excludedImplantTypes: [],
            optimizeImplants: false,
            customFormula: {
                rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }],
            },
        };

        const single = vi.fn().mockResolvedValue({ data: { id: 'rec-1' }, error: null });
        const select = vi.fn().mockReturnValue({ single });
        const insert = vi.fn().mockReturnValue({ select });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

        const result = await CommunityRecommendationService.createRecommendation(
            { ...baseInput, sharedConfig: fromScratch },
            'profile-1'
        );

        expect(result).toEqual({ id: 'rec-1' });
        const payload = insert.mock.calls[0][0];
        expect(payload.ship_role).toBeNull();
        expect(payload.shared_config.shipRole).toBeNull();
    });

    // Until the migration making `ship_role` nullable is applied, the database itself still
    // rejects a NULL write with a not_null_violation — that failure must surface as a named
    // error the UI can explain, not an opaque `null` return or a crash.
    it('throws ShipRoleColumnNotNullableError when the DB still enforces NOT NULL on a null ship_role', async () => {
        const fromScratch: SharedAutogearBuild = {
            version: 2,
            shipRole: null,
            statPriorities: [],
            setPriorities: [],
            statBonuses: [],
            fleetBuffs: [],
            excludedImplantTypes: [],
            optimizeImplants: false,
            customFormula: {
                rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }],
            },
        };

        const single = vi.fn().mockResolvedValue({
            data: null,
            error: {
                code: '23502',
                message: 'null value in column "ship_role" violates not-null constraint',
            },
        });
        const select = vi.fn().mockReturnValue({ single });
        const insert = vi.fn().mockReturnValue({ select });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

        await expect(
            CommunityRecommendationService.createRecommendation(
                { ...baseInput, sharedConfig: fromScratch },
                'profile-1'
            )
        ).rejects.toThrow(ShipRoleColumnNotNullableError);
    });

    // `ship_name` and `title` are NOT NULL on this table too. A from-scratch build legitimately
    // writes a null `ship_role`, but if some OTHER column's insert value is what actually
    // violated the constraint, that 23502 must not be misreported as the pending-migration
    // case just because legacyShipRole happens to be null on this build.
    it('does not throw ShipRoleColumnNotNullableError when the 23502 names a different column', async () => {
        const fromScratch: SharedAutogearBuild = {
            version: 2,
            shipRole: null,
            statPriorities: [],
            setPriorities: [],
            statBonuses: [],
            fleetBuffs: [],
            excludedImplantTypes: [],
            optimizeImplants: false,
            customFormula: {
                rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }],
            },
        };

        const single = vi.fn().mockResolvedValue({
            data: null,
            error: {
                code: '23502',
                message: 'null value in column "title" violates not-null constraint',
            },
        });
        const select = vi.fn().mockReturnValue({ single });
        const insert = vi.fn().mockReturnValue({ select });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

        const result = await CommunityRecommendationService.createRecommendation(
            { ...baseInput, sharedConfig: fromScratch },
            'profile-1'
        );

        expect(result).toBeNull();
    });

    // A NOT NULL violation on a build that DOES have a role to mirror is not the
    // pending-migration case — it must fall through to the generic null-return path rather
    // than claiming a migration is the cause of an unrelated failure.
    it('does not throw ShipRoleColumnNotNullableError for a build that has a role to mirror', async () => {
        const single = vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23502', message: 'some other not-null violation' },
        });
        const select = vi.fn().mockReturnValue({ single });
        const insert = vi.fn().mockReturnValue({ select });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

        const result = await CommunityRecommendationService.createRecommendation(
            baseInput,
            'profile-1'
        );

        expect(result).toBeNull();
    });
});
