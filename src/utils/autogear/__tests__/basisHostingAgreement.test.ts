import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateRoleScore, calculatePriorityScore } from '../priorityScore';
import { roleHostsBasis } from '../offFormula/roleBasisHost';
import { configToSharedBuild } from '../../communityBuild';
import { runSimulation } from '../../simulation/simulationCalculator';
import { SHIP_TYPES } from '../../../constants';
import type { BaseStats } from '../../../types/stats';
import type { RoleBasis } from '../../../types/autogear';

/**
 * Four independent sites decide whether a `roleBasis` applies to a role: `calculateRoleScore`,
 * `calculatePriorityScore`, `configToSharedBuild` (`communityBuild.ts`), and `runSimulation`
 * (`simulationCalculator.ts`). All four must route through the same hosting predicate
 * (`hostedBasisTerms`/`isRoleBasisHosted`, `roleBasisHost.ts`) so none of them can drift from
 * `roleHostsBasis`'s own answer (#551).
 *
 * `Math.random` is pinned so `runSimulation`'s crit roll can never coincidentally land and mask
 * a basis difference (or manufacture one).
 */
const ALL_ROLES = Object.keys(SHIP_TYPES);
const ALL_PRODUCES: RoleBasis['produces'][] = ['damage', 'repair', 'shield'];

// A basis on 'security' is foreign to every hosting role's own primary stat (attack or hp), and
// `security` is set far from both so a hosted basis is guaranteed to move the result.
const stats: BaseStats = {
    hp: 5000,
    attack: 100,
    defence: 800,
    hacking: 250,
    security: 999,
    crit: 0,
    critDamage: 150,
    speed: 100,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    shieldPenetration: 0,
    defensePenetration: 0,
    damageReduction: 0,
};

const basisFor = (produces: RoleBasis['produces']): RoleBasis => ({
    produces,
    terms: [{ stat: 'security', weight: 1 }],
});

describe('basis hosting agreement across the four sites', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    for (const role of ALL_ROLES) {
        for (const produces of ALL_PRODUCES) {
            it(`${role} x ${produces}`, () => {
                const expected = roleHostsBasis(role, produces);
                const basis = basisFor(produces);

                const roleScoreDiffers =
                    calculateRoleScore(role, stats, undefined, basis) !==
                    calculateRoleScore(role, stats);
                expect(roleScoreDiffers).toBe(expected);

                const priorityScoreDiffers =
                    calculatePriorityScore(
                        stats,
                        [],
                        role,
                        {},
                        [],
                        [],
                        false,
                        0,
                        undefined,
                        undefined,
                        basis
                    ) !== calculatePriorityScore(stats, [], role, {}, [], [], false, 0);
                expect(priorityScoreDiffers).toBe(expected);

                const shared = configToSharedBuild(
                    {
                        shipRole: role,
                        statPriorities: [],
                        setPriorities: [],
                        statBonuses: [],
                        roleBasis: basis,
                    },
                    true
                );
                expect(shared?.roleBasis !== undefined).toBe(expected);

                const simulationDiffers =
                    JSON.stringify(runSimulation(stats, role, undefined, { roleBasis: basis })) !==
                    JSON.stringify(runSimulation(stats, role));
                expect(simulationDiffers).toBe(expected);
            });
        }
    }
});
