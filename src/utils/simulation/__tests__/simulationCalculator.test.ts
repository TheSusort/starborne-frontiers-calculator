import { describe, it, expect } from 'vitest';
import { runSimulation } from '../simulationCalculator';
import { customFormulaScore } from '../../autogear/customFormula';
import { calculateDirectDamage } from '../../autogear/statResolution';
import type { BaseStats } from '../../../types/stats';
import type { RoleBasis, CustomFormula } from '../../../types/autogear';

// `crit: 0` makes `Math.random() * 100 <= 0` fire only on an exact 0.0 draw — negligible over a
// handful of calls, so this stays deterministic without mocking Math.random (`Autogear results
// basis` spec, #551).
const baseStats: BaseStats = {
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

describe('runSimulation — ATTACKER role basis', () => {
    const foreignBasis: RoleBasis = {
        produces: 'damage',
        terms: [{ stat: 'security', weight: 2 }],
    };

    it('damage tracks the foreign-stat basis, not attack', () => {
        const withBasis = runSimulation(baseStats, 'ATTACKER', undefined, {
            roleBasis: foreignBasis,
        });
        // security(999) * weight(2) = 1998, substituted for attack in the same DPS formula.
        const equivalent = runSimulation({ ...baseStats, attack: 1998 }, 'ATTACKER');
        expect(withBasis.averageDamage).toBe(equivalent.averageDamage);
    });

    it('is NOT the same as scoring on raw attack (the instrument can tell the difference)', () => {
        const withBasis = runSimulation(baseStats, 'ATTACKER', undefined, {
            roleBasis: foreignBasis,
        });
        const withoutBasis = runSimulation(baseStats, 'ATTACKER');
        expect(withBasis.averageDamage).not.toBe(withoutBasis.averageDamage);
    });
});

describe('runSimulation — SUPPORTER role basis', () => {
    const blendBasis: RoleBasis = {
        produces: 'repair',
        terms: [
            { stat: 'hp', weight: 0.057 },
            { stat: 'defence', weight: 1.067 },
        ],
    };

    it('healing comes from the hp/defence blend, not hp alone', () => {
        const withBasis = runSimulation(baseStats, 'SUPPORTER', undefined, {
            roleBasis: blendBasis,
        });
        // 5000 * 0.057 + 800 * 1.067 = 285 + 853.6 = 1138.6
        const equivalent = runSimulation({ ...baseStats, hp: 1138.6 }, 'SUPPORTER');
        expect(withBasis.averageHealing).toBe(equivalent.averageHealing);
        expect(withBasis.averageHealing).not.toBe(
            runSimulation(baseStats, 'SUPPORTER').averageHealing
        );
    });
});

describe('runSimulation — SUPPORTER_SHIELD role basis', () => {
    const shieldBasis: RoleBasis = {
        produces: 'shield',
        terms: [{ stat: 'security', weight: 1 }],
    };

    it('hp is replaced by the basis value', () => {
        const withBasis = runSimulation(baseStats, 'SUPPORTER_SHIELD', undefined, {
            roleBasis: shieldBasis,
        });
        expect(withBasis.hp).toBe(baseStats.security);
        expect(withBasis.hp).not.toBe(runSimulation(baseStats, 'SUPPORTER_SHIELD').hp);
    });
});

describe('runSimulation — non-hosting role/basis pairs are unchanged', () => {
    it('DEFENDER ignores a damage-axis basis', () => {
        const damageBasis: RoleBasis = {
            produces: 'damage',
            terms: [{ stat: 'security', weight: 2 }],
        };
        const withBasis = runSimulation(baseStats, 'DEFENDER', undefined, {
            roleBasis: damageBasis,
        });
        const withoutBasis = runSimulation(baseStats, 'DEFENDER');
        expect(withBasis).toEqual(withoutBasis);
    });

    it('ATTACKER ignores a repair-axis basis', () => {
        const repairBasis: RoleBasis = {
            produces: 'repair',
            terms: [{ stat: 'hp', weight: 2 }],
        };
        const withBasis = runSimulation(baseStats, 'ATTACKER', undefined, {
            roleBasis: repairBasis,
        });
        const withoutBasis = runSimulation(baseStats, 'ATTACKER');
        expect(withBasis).toEqual(withoutBasis);
    });
});

describe('runSimulation — callers that pass no options are unaffected', () => {
    it('SimulationPage/EngineeringPreviewTab style calls (no 4th arg) behave exactly as before', () => {
        const noOptions = runSimulation(baseStats, 'ATTACKER', []);
        const explicitEmptyOptions = runSimulation(baseStats, 'ATTACKER', [], {});
        expect(noOptions).toEqual(explicitEmptyOptions);
    });
});

describe('runSimulation — Custom formula path', () => {
    it('formulaScore equals customFormulaScore, and no attack-derived averageDamage without a directDamage row', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'hp', kind: 'core', direction: 'max' }],
        };
        const result = runSimulation(baseStats, null, undefined, { customFormula: formula });
        expect(result.formulaScore).toBe(customFormulaScore(baseStats, formula));
        expect(result.averageDamage).toBeUndefined();
    });

    it('a directDamage row carrying a security basis makes damage track security', () => {
        const formula: CustomFormula = {
            rows: [
                {
                    stat: 'directDamage',
                    kind: 'core',
                    direction: 'max',
                    basis: [{ stat: 'security', weight: 3 }],
                },
            ],
        };
        const result = runSimulation(baseStats, null, undefined, { customFormula: formula });
        const expectedDamage = Math.round(
            calculateDirectDamage(baseStats, [{ stat: 'security', weight: 3 }])
        );
        expect(result.averageDamage).toBe(expectedDamage);
        // Non-vacuity: this must differ from what attack alone would produce.
        expect(result.averageDamage).not.toBe(Math.round(calculateDirectDamage(baseStats)));
    });

    it('role null with no formula keeps the old attack-based behaviour', () => {
        const withNoFormula = runSimulation(baseStats, null);
        const withEmptyFormula = runSimulation(baseStats, null, undefined, {
            customFormula: { rows: [] },
        });
        expect(withNoFormula).toEqual(withEmptyFormula);
        expect(withNoFormula.formulaScore).toBeUndefined();
        // Falls back to the ordinary attack-based damage sim.
        expect(withNoFormula.averageDamage).toBeDefined();
    });

    it('does not run the attack damage sim for a Custom ship (no averageDamage with only a bonus row)', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'crit', kind: 'bonus', direction: 'max' }],
        };
        const result = runSimulation(baseStats, null, undefined, { customFormula: formula });
        expect(result.formulaScore).toBeDefined();
        expect(result.averageDamage).toBeUndefined();
    });
});
