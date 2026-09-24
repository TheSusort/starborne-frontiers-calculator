import { describe, it, expect } from 'vitest';
import {
    ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE,
    buildReferencesCritMultiplier,
} from '../communityBuild';
import type { SharedAutogearBuild } from '../../types/communityRecommendation';

const baseBuild: SharedAutogearBuild = {
    version: 1,
    shipRole: 'ATTACKER',
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    fleetBuffs: [],
    excludedImplantTypes: [],
    optimizeImplants: false,
};

describe('ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE', () => {
    // Every bundle in the field reads critMultiplier in limitableStatSchema (shipped with
    // #550), so the switch is on. Mirrors ALLOW_ROLELESS_COMMUNITY_SHARE's own default.
    it('defaults to true', () => {
        expect(ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE).toBe(true);
    });
});

describe('buildReferencesCritMultiplier', () => {
    it('is false for a build with no critMultiplier anywhere', () => {
        expect(buildReferencesCritMultiplier(baseBuild)).toBe(false);
    });

    it('is true when a stat priority names critMultiplier', () => {
        expect(
            buildReferencesCritMultiplier({
                ...baseBuild,
                statPriorities: [{ stat: 'critMultiplier', minLimit: 2 }],
            })
        ).toBe(true);
    });

    it('is true when a stat bonus names critMultiplier', () => {
        expect(
            buildReferencesCritMultiplier({
                ...baseBuild,
                statBonuses: [{ stat: 'critMultiplier', percentage: 50, mode: 'additive' }],
            })
        ).toBe(true);
    });

    it('is true when a custom-formula row names critMultiplier', () => {
        expect(
            buildReferencesCritMultiplier({
                ...baseBuild,
                customFormula: {
                    rows: [{ stat: 'critMultiplier', kind: 'core', direction: 'max' }],
                },
            })
        ).toBe(true);
    });

    it('is false for a build that only references other derived stats', () => {
        expect(
            buildReferencesCritMultiplier({
                ...baseBuild,
                statPriorities: [{ stat: 'directDamage', minLimit: 100 }],
                statBonuses: [{ stat: 'effectiveHp', percentage: 10, mode: 'additive' }],
            })
        ).toBe(false);
    });
});
