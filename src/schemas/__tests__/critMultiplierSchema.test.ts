import { describe, it, expect } from 'vitest';
import type { SharedAutogearBuild } from '../../types/communityRecommendation';
import { validateSharedAutogearBuild } from '../sharedAutogearBuild';

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

// The deployed (origin/production) reader has no critMultiplier entry, but a build ON THIS
// bundle must still validate — write-side sharing is gated separately by
// ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE (communityBuild.ts /
// communityRecommendationsCritMultiplierGate.test.ts), not by this schema.
describe('sharedAutogearBuildSchema — accepts critMultiplier (reader is not the write gate)', () => {
    it('accepts a stat priority naming critMultiplier', () => {
        const build = {
            ...baseBuild,
            statPriorities: [{ stat: 'critMultiplier', minLimit: 2 }],
        };
        expect(validateSharedAutogearBuild(build)).not.toBeNull();
    });

    it('accepts a stat bonus naming critMultiplier', () => {
        const build = {
            ...baseBuild,
            statBonuses: [{ stat: 'critMultiplier', percentage: 50, mode: 'additive' as const }],
        };
        expect(validateSharedAutogearBuild(build)).not.toBeNull();
    });

    it('accepts a custom-formula core row naming critMultiplier', () => {
        const build = {
            ...baseBuild,
            version: 2 as const,
            shipRole: null,
            customFormula: {
                rows: [
                    { stat: 'critMultiplier', kind: 'core' as const, direction: 'max' as const },
                ],
            },
        };
        expect(validateSharedAutogearBuild(build)).not.toBeNull();
    });
});
