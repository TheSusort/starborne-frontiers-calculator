import { describe, it, expect } from 'vitest';
import {
    toCommunityBuild,
    sortCommunityBuilds,
    isImplantMatch,
    configToSharedBuild,
    hasExistingBuildConfig,
    communityBuildToConfigUpdate,
    ALLOW_ROLELESS_COMMUNITY_SHARE,
} from '../communityBuild';
import { validateSharedAutogearBuild } from '../../schemas/sharedAutogearBuild';
import { validateProductionSharedAutogearBuild } from '../../schemas/__fixtures__/productionSharedAutogearBuild';
import { defaultAutogearShipConfig } from '../autogear/runShipOptimizer';
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

    it('reads a role-less Custom build with a null ship_role via shared_config', () => {
        const roleLessBuild: SharedAutogearBuild = {
            ...sharedConfig,
            version: 2,
            shipRole: null,
            customFormula: { rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }] },
        };
        const build = toCommunityBuild(makeRow({ shared_config: roleLessBuild, ship_role: null }));
        expect(build?.isLegacy).toBe(false);
        expect(build?.build.shipRole).toBeNull();
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

    it('drops a row with a null ship_role and no usable shared_config, without crashing', () => {
        expect(() =>
            toCommunityBuild(makeRow({ shared_config: null, ship_role: null }))
        ).not.toThrow();
        expect(toCommunityBuild(makeRow({ shared_config: null, ship_role: null }))).toBeNull();
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
        statBonuses: [{ stat: 'attack' as const, percentage: 30, mode: 'additive' as const }],
        fleetBuffs: [{ stat: 'attack' as const, percentage: 30 }],
        excludedImplantTypes: ['MARTYRDOM'],
        optimizeImplants: true,
    };

    it('produces a version-1 build carrying all seven legacy fields — a role build with no customFormula stays readable by production (1.68.0)', () => {
        expect(configToSharedBuild(config)).toEqual({ version: 1, ...config });
    });

    it('writes a role build at version 1, dropping the inactive customFormula, even when one is still set from a Custom-mode detour', () => {
        // `calculateRoleScore` (priorityScore.ts) only ever reads `customFormula` when
        // `shipRole` is null — a role build's formula is dead weight, not a live scorer input,
        // so it must never force the build onto the version production's live bundle (1.68.0)
        // cannot read at all.
        const build = configToSharedBuild({
            ...config,
            customFormula: {
                rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }],
                seededFrom: 'ATTACKER',
            },
        });
        expect(build?.version).toBe(1);
        expect(build).not.toHaveProperty('customFormula');
    });

    it("a role build carrying a stale formula parses under production's own (1.68.0) schema", () => {
        const build = configToSharedBuild({
            ...config,
            customFormula: {
                rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }],
                seededFrom: 'ATTACKER',
            },
        });
        expect(build?.version).toBe(1);
        expect(validateProductionSharedAutogearBuild(structuredClone(build))).not.toBeNull();
    });

    it('writes a roleBasis only when the configured role actually hosts its axis', () => {
        // DEFENDER hosts nothing (roleBasisHost.ts) — a `damage`-axis basis left over from a
        // different role must not ride along on a share, since the scorer would ignore it too.
        const build = configToSharedBuild({
            ...config,
            shipRole: 'DEFENDER',
            roleBasis: { produces: 'damage', terms: [{ stat: 'attack', weight: 2.1 }] },
        });
        expect(build).not.toHaveProperty('roleBasis');
    });

    it('writes a roleBasis the configured role hosts', () => {
        const build = configToSharedBuild({
            ...config,
            roleBasis: { produces: 'damage', terms: [{ stat: 'attack', weight: 2.1 }] },
        });
        expect(build).toHaveProperty('roleBasis', {
            produces: 'damage',
            terms: [{ stat: 'attack', weight: 2.1 }],
        });
    });

    it('does not throw and drops the roleBasis for a shipRole string that no longer names a real role', () => {
        expect(() =>
            configToSharedBuild({
                ...config,
                shipRole: 'RETIRED_ROLE',
                roleBasis: { produces: 'damage', terms: [{ stat: 'attack', weight: 2.1 }] },
            })
        ).not.toThrow();
        const build = configToSharedBuild({
            ...config,
            shipRole: 'RETIRED_ROLE',
            roleBasis: { produces: 'damage', terms: [{ stat: 'attack', weight: 2.1 }] },
        });
        expect(build).not.toHaveProperty('roleBasis');
    });

    it('returns null without a ship role or a usable custom formula', () => {
        expect(configToSharedBuild({ ...config, shipRole: null })).toBeNull();
    });

    it('shares a Custom-mode build when the formula is seeded from a role', () => {
        const build = configToSharedBuild({
            ...config,
            shipRole: null,
            customFormula: {
                rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }],
                seededFrom: 'ATTACKER',
            },
        });
        expect(build).toEqual({
            version: 2,
            ...config,
            shipRole: null,
            customFormula: {
                rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }],
                seededFrom: 'ATTACKER',
            },
        });
    });

    it('refuses a from-scratch Custom-mode build when allowRoleless is false, even with a usable formula', () => {
        const build = configToSharedBuild(
            {
                ...config,
                shipRole: null,
                customFormula: {
                    rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }],
                },
            },
            false
        );
        expect(build).toBeNull();
    });

    it("defaults allowRoleless to ALLOW_ROLELESS_COMMUNITY_SHARE — this pins the DEFAULT's wiring, not its value, so it survives #552's eventual flip", () => {
        const rolelessConfig = {
            ...config,
            shipRole: null,
            customFormula: {
                rows: [
                    {
                        stat: 'directDamage' as const,
                        kind: 'core' as const,
                        direction: 'max' as const,
                    },
                ],
            },
        };
        const withDefault = configToSharedBuild(rolelessConfig);
        const withExplicitConstant = configToSharedBuild(
            rolelessConfig,
            ALLOW_ROLELESS_COMMUNITY_SHARE
        );
        expect(withDefault).toEqual(withExplicitConstant);
    });

    it('shares a from-scratch Custom-mode build with a usable formula but no seededFrom, writing a null role, when allowRoleless is true', () => {
        const build = configToSharedBuild(
            {
                ...config,
                shipRole: null,
                customFormula: {
                    rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }],
                },
            },
            true
        );
        expect(build).toEqual({
            version: 2,
            ...config,
            shipRole: null,
            customFormula: { rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }] },
        });
    });

    it('refuses a Custom-mode build whose formula has no usable row, even with seededFrom', () => {
        const build = configToSharedBuild({
            ...config,
            shipRole: null,
            customFormula: { rows: [], seededFrom: 'ATTACKER' },
        });
        expect(build).toBeNull();
    });

    it('round-trips a Custom-mode config through share and apply, basis intact', () => {
        // The full app path: the page's config goes out through configToSharedBuild,
        // across the wire as JSON (validateSharedAutogearBuild stands in for that hop),
        // and back into an equivalent config update via communityBuildToConfigUpdate.
        const customFormula = {
            rows: [
                {
                    stat: 'directDamage' as const,
                    kind: 'core' as const,
                    direction: 'max' as const,
                    basis: [{ stat: 'attack' as const, weight: 2.5 }],
                },
            ],
            seededFrom: 'ATTACKER' as const,
        };
        const shared = configToSharedBuild({ ...config, shipRole: null, customFormula });
        expect(shared).not.toBeNull();

        const validated = validateSharedAutogearBuild(JSON.parse(JSON.stringify(shared)));
        expect(validated).not.toBeNull();

        const update = communityBuildToConfigUpdate(validated as SharedAutogearBuild);
        expect(update.shipRole).toBeNull();
        expect(update.customFormula).toEqual(customFormula);
    });

    it('round-trips a role build carrying a roleBasis through share and apply', () => {
        // Built from the real live shape (`defaultAutogearShipConfig`), not a hand-written
        // literal, so this proves roleBasis flows through the actual config type end to end
        // rather than through a type the config never has.
        const roleBasis = {
            produces: 'damage' as const,
            terms: [{ stat: 'attack' as const, weight: 1.5 }],
        };
        const shipConfig = { ...defaultAutogearShipConfig('ATTACKER'), roleBasis };

        const shared = configToSharedBuild(shipConfig);
        expect(shared).not.toBeNull();
        // A role build with no customFormula stays version 1 — production's live bundle
        // (1.68.0) only has a version-1 reader, and its schema is a plain non-strict
        // `z.object`, so it reads this in full, including a `roleBasis` it can't use.
        expect(shared?.version).toBe(1);
        expect(shared?.roleBasis).toEqual(roleBasis);

        const validated = validateSharedAutogearBuild(JSON.parse(JSON.stringify(shared)));
        expect(validated).not.toBeNull();
        expect(validated?.roleBasis).toEqual(roleBasis);

        const update = communityBuildToConfigUpdate(validated as SharedAutogearBuild);
        expect(update.roleBasis).toEqual(roleBasis);
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

    it('is true when a role config carries an applied roleBasis', () => {
        expect(
            hasExistingBuildConfig({
                ...empty,
                roleBasis: { produces: 'damage', terms: [{ stat: 'attack', weight: 1.5 }] },
            })
        ).toBe(true);
    });

    it('is true when a Custom-mode config carries a non-empty formula', () => {
        expect(
            hasExistingBuildConfig({
                ...empty,
                shipRole: null,
                customFormula: {
                    rows: [{ stat: 'directDamage', kind: 'core', direction: 'max' }],
                },
            })
        ).toBe(true);
    });

    it('is false for a Custom-mode config with no formula, or an empty one', () => {
        expect(hasExistingBuildConfig({ ...empty, shipRole: null })).toBe(false);
        expect(
            hasExistingBuildConfig({ ...empty, shipRole: null, customFormula: { rows: [] } })
        ).toBe(false);
    });
});

describe('communityBuildToConfigUpdate', () => {
    // Pins the feature's single most important guarantee: applying a community
    // build writes exactly these nine build-shaping fields and never the
    // seven personal ones (ignoreEquipped, ignoreUnleveled,
    // useUpgradedStats, tryToCompleteSets, includeCalibratedGear,
    // assumeCalibrated, useArenaModifiers). Adding a tenth key here — of
    // either kind — must fail this test, not ship silently.
    it('produces an update object with exactly the nine build-shaping keys', () => {
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
                'customFormula',
                'roleBasis',
            ].sort()
        );
    });

    it('carries every field through unchanged, including an absent customFormula/roleBasis', () => {
        expect(communityBuildToConfigUpdate(sharedConfig)).toEqual({
            shipRole: sharedConfig.shipRole,
            statPriorities: sharedConfig.statPriorities,
            setPriorities: sharedConfig.setPriorities,
            statBonuses: sharedConfig.statBonuses,
            fleetBuffs: sharedConfig.fleetBuffs,
            excludedImplantTypes: sharedConfig.excludedImplantTypes,
            optimizeImplants: sharedConfig.optimizeImplants,
            customFormula: undefined,
            roleBasis: undefined,
        });
    });

    it("carries a Custom-mode build's formula through", () => {
        const customFormula = {
            rows: [
                { stat: 'directDamage' as const, kind: 'core' as const, direction: 'max' as const },
            ],
            seededFrom: 'ATTACKER' as const,
        };
        const update = communityBuildToConfigUpdate({
            ...sharedConfig,
            shipRole: null,
            customFormula,
        });
        expect(update.shipRole).toBeNull();
        expect(update.customFormula).toEqual(customFormula);
    });

    // The page config's SetPriority.count is required (the autogear engine
    // consumes it), but a legacy shared build may have no recorded count.
    // Applying such a build must still produce a config the engine can score.
    it('fills a missing set priority count with LEGACY_DEFAULT_SET_COUNT, leaving a present count untouched', () => {
        const update = communityBuildToConfigUpdate({
            ...sharedConfig,
            setPriorities: [{ setName: 'DECIMATION' }, { setName: 'CRITICAL', count: 4 }],
        });
        expect(update.setPriorities).toEqual([
            { setName: 'DECIMATION', count: 2 },
            { setName: 'CRITICAL', count: 4 },
        ]);
    });
});
