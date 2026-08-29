import { describe, it, expect } from 'vitest';
import {
    toCommunityBuild,
    sortCommunityBuilds,
    isImplantMatch,
    configToSharedBuild,
    hasExistingBuildConfig,
    communityBuildToConfigUpdate,
} from '../communityBuild';
import type {
    CommunityRecommendation,
    SharedAutogearBuild,
} from '../../types/communityRecommendation';

const sharedConfig: SharedAutogearBuild = {
    version: 1,
    shipRole: 'ATTACKER',
    statPriorities: [{ stat: 'crit', minLimit: 100, hardRequirement: true }],
    setPriorities: [{ setName: 'CRITICAL', count: 4 }],
    statBonuses: [{ stat: 'attack', percentage: 30, mode: 'additive' }],
    fleetBuffs: [{ stat: 'attack', percentage: 30 }],
    excludedImplantTypes: ['MARTYRDOM'],
    optimizeImplants: true,
};

const makeRow = (over: Partial<CommunityRecommendation> = {}): CommunityRecommendation => ({
    id: 'r1',
    ship_name: 'Ares',
    ship_refit_level: 3,
    title: 'Crit Bruiser',
    description: 'caps crit',
    is_implant_specific: false,
    ship_role: 'ATTACKER',
    stat_priorities: [{ stat: 'crit', minLimit: 100, hardRequirement: true }],
    stat_bonuses: [{ stat: 'attack', percentage: 30, mode: 'additive' }],
    set_priorities: [{ setName: 'CRITICAL', count: 4 }],
    upvotes: 10,
    downvotes: 1,
    total_votes: 11,
    score: 0.9,
    created_at: '2026-08-01T00:00:00Z',
    ...over,
});

describe('toCommunityBuild', () => {
    it('uses shared_config when it is present and valid', () => {
        const build = toCommunityBuild(makeRow({ shared_config: sharedConfig }));
        expect(build?.isLegacy).toBe(false);
        expect(build?.build.fleetBuffs).toEqual([{ stat: 'attack', percentage: 30 }]);
        expect(build?.build.optimizeImplants).toBe(true);
        expect(build?.build.excludedImplantTypes).toEqual(['MARTYRDOM']);
    });

    it('synthesises from the legacy columns when shared_config is absent', () => {
        const build = toCommunityBuild(makeRow());
        expect(build?.isLegacy).toBe(true);
        expect(build?.build.shipRole).toBe('ATTACKER');
        expect(build?.build.statPriorities).toEqual([
            { stat: 'crit', minLimit: 100, hardRequirement: true },
        ]);
        expect(build?.build.fleetBuffs).toEqual([]);
        expect(build?.build.excludedImplantTypes).toEqual([]);
        expect(build?.build.optimizeImplants).toBe(false);
    });

    it('falls back to the legacy columns when shared_config is corrupt rather than throwing', () => {
        const build = toCommunityBuild(
            makeRow({ shared_config: { version: 1, shipRole: 'WIZARD' } })
        );
        expect(build?.isLegacy).toBe(true);
        expect(build?.build.shipRole).toBe('ATTACKER');
    });

    it('drops a row whose legacy columns are unusable too', () => {
        expect(toCommunityBuild(makeRow({ shared_config: null, ship_role: 'WIZARD' }))).toBeNull();
    });

    it('carries the row metadata onto the read model', () => {
        const build = toCommunityBuild(makeRow({ shared_config: sharedConfig }));
        expect(build).toMatchObject({
            id: 'r1',
            title: 'Crit Bruiser',
            shipRefitLevel: 3,
            upvotes: 10,
            downvotes: 1,
        });
    });
});

describe('sortCommunityBuilds', () => {
    const generic = toCommunityBuild(
        makeRow({ id: 'generic', score: 0.5, created_at: '2026-01-01T00:00:00Z' })
    )!;
    const mine = toCommunityBuild(
        makeRow({
            id: 'mine',
            score: 0.1,
            created_at: '2026-02-01T00:00:00Z',
            is_implant_specific: true,
            ultimate_implant: 'Havoc',
        })
    )!;
    const theirs = toCommunityBuild(
        makeRow({
            id: 'theirs',
            score: 0.99,
            created_at: '2026-03-01T00:00:00Z',
            is_implant_specific: true,
            ultimate_implant: 'Martyrdom',
        })
    )!;

    it('groups matching implant first, generic second, other implant last', () => {
        const sorted = sortCommunityBuilds([theirs, generic, mine], 'Havoc', 'top');
        expect(sorted.map((b) => b.id)).toEqual(['mine', 'generic', 'theirs']);
    });

    it('puts implant-specific builds last when no ultimate implant is equipped', () => {
        const sorted = sortCommunityBuilds([theirs, generic, mine], null, 'top');
        expect(sorted[0].id).toBe('generic');
    });

    it('orders by score within a group for "top"', () => {
        const low = toCommunityBuild(makeRow({ id: 'low', score: 0.2 }))!;
        const high = toCommunityBuild(makeRow({ id: 'high', score: 0.8 }))!;
        expect(sortCommunityBuilds([low, high], null, 'top').map((b) => b.id)).toEqual([
            'high',
            'low',
        ]);
    });

    it('orders by created_at within a group for "newest"', () => {
        const old = toCommunityBuild(
            makeRow({ id: 'old', score: 0.9, created_at: '2026-01-01T00:00:00Z' })
        )!;
        const recent = toCommunityBuild(
            makeRow({ id: 'recent', score: 0.1, created_at: '2026-06-01T00:00:00Z' })
        )!;
        expect(sortCommunityBuilds([old, recent], null, 'newest').map((b) => b.id)).toEqual([
            'recent',
            'old',
        ]);
    });

    it('does not mutate its input', () => {
        const input = [theirs, generic, mine];
        sortCommunityBuilds(input, 'Havoc', 'top');
        expect(input.map((b) => b.id)).toEqual(['theirs', 'generic', 'mine']);
    });
});

describe('isImplantMatch', () => {
    it('is true only for an implant-specific build matching the equipped implant', () => {
        const specific = toCommunityBuild(
            makeRow({ is_implant_specific: true, ultimate_implant: 'Havoc' })
        )!;
        const generic = toCommunityBuild(makeRow())!;
        expect(isImplantMatch(specific, 'Havoc')).toBe(true);
        expect(isImplantMatch(specific, 'Martyrdom')).toBe(false);
        expect(isImplantMatch(specific, null)).toBe(false);
        expect(isImplantMatch(generic, 'Havoc')).toBe(false);
    });
});

describe('configToSharedBuild', () => {
    const config = {
        shipRole: 'ATTACKER' as const,
        statPriorities: [{ stat: 'crit' as const, minLimit: 100 }],
        setPriorities: [{ setName: 'CRITICAL', count: 4 }],
        statBonuses: [{ stat: 'attack', percentage: 30, mode: 'additive' as const }],
        fleetBuffs: [{ stat: 'attack' as const, percentage: 30 }],
        excludedImplantTypes: ['MARTYRDOM'],
        optimizeImplants: true,
    };

    it('produces a version-1 build carrying all seven fields', () => {
        expect(configToSharedBuild(config)).toEqual({ version: 1, ...config });
    });

    it('returns null without a ship role', () => {
        expect(configToSharedBuild({ ...config, shipRole: null })).toBeNull();
    });

    it('defaults the optional arrays', () => {
        const build = configToSharedBuild({
            shipRole: 'ATTACKER',
            statPriorities: [],
            setPriorities: [],
            statBonuses: [],
        });
        expect(build).toEqual({
            version: 1,
            shipRole: 'ATTACKER',
            statPriorities: [],
            setPriorities: [],
            statBonuses: [],
            fleetBuffs: [],
            excludedImplantTypes: [],
            optimizeImplants: false,
        });
    });
});

describe('hasExistingBuildConfig', () => {
    const empty = {
        shipRole: 'ATTACKER' as const,
        statPriorities: [],
        setPriorities: [],
        statBonuses: [],
        fleetBuffs: [],
        excludedImplantTypes: [],
        optimizeImplants: false,
    };

    it('is false for an empty config even though shipRole is always set', () => {
        expect(hasExistingBuildConfig(empty)).toBe(false);
    });

    it('is true when any build list has an entry', () => {
        expect(hasExistingBuildConfig({ ...empty, statPriorities: [{ stat: 'crit' }] })).toBe(true);
        expect(
            hasExistingBuildConfig({ ...empty, setPriorities: [{ setName: 'CRITICAL', count: 4 }] })
        ).toBe(true);
        expect(
            hasExistingBuildConfig({ ...empty, statBonuses: [{ stat: 'attack', percentage: 1 }] })
        ).toBe(true);
        expect(
            hasExistingBuildConfig({ ...empty, fleetBuffs: [{ stat: 'attack', percentage: 1 }] })
        ).toBe(true);
        expect(hasExistingBuildConfig({ ...empty, excludedImplantTypes: ['MARTYRDOM'] })).toBe(
            true
        );
    });

    it('is true when optimizeImplants is on', () => {
        expect(hasExistingBuildConfig({ ...empty, optimizeImplants: true })).toBe(true);
    });
});

describe('communityBuildToConfigUpdate', () => {
    // Pins the feature's single most important guarantee: applying a community
    // build writes exactly these seven build-shaping fields and never the
    // eight personal ones (algorithm, ignoreEquipped, ignoreUnleveled,
    // useUpgradedStats, tryToCompleteSets, includeCalibratedGear,
    // assumeCalibrated, useArenaModifiers). Adding an eighth key here — of
    // either kind — must fail this test, not ship silently.
    it('produces an update object with exactly the seven build-shaping keys', () => {
        const update = communityBuildToConfigUpdate(sharedConfig);
        expect(Object.keys(update).sort()).toEqual(
            [
                'shipRole',
                'statPriorities',
                'setPriorities',
                'statBonuses',
                'fleetBuffs',
                'excludedImplantTypes',
                'optimizeImplants',
            ].sort()
        );
    });

    it('carries every field through unchanged', () => {
        expect(communityBuildToConfigUpdate(sharedConfig)).toEqual({
            shipRole: sharedConfig.shipRole,
            statPriorities: sharedConfig.statPriorities,
            setPriorities: sharedConfig.setPriorities,
            statBonuses: sharedConfig.statBonuses,
            fleetBuffs: sharedConfig.fleetBuffs,
            excludedImplantTypes: sharedConfig.excludedImplantTypes,
            optimizeImplants: sharedConfig.optimizeImplants,
        });
    });
});
