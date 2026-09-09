import type { CustomFormula, CustomFormulaRow } from '../../types/autogear';
import type { ShipTypeName } from '../../constants/shipTypes';

const core = (
    stat: CustomFormulaRow['stat'],
    importance: CustomFormulaRow['importance'] = 1
): CustomFormulaRow => ({ stat, kind: 'core', direction: 'max', importance });

const bonus = (stat: CustomFormulaRow['stat'], percentage = 100): CustomFormulaRow => ({
    stat,
    kind: 'bonus',
    direction: 'max',
    percentage,
});

/**
 * A starting formula per role, with a plain-language note on how faithful it is.
 *
 * `fidelity` is shown to the user next to the seed choice. A role whose formula is not a
 * product of stats gets an approximation and says so — presenting an approximation as the
 * role's real scoring is worse than presenting no seed.
 *
 * A maximized core row on a stat that is 0 at base zeroes the whole product, so no seed
 * places one; `customFormulaSeeds.test.ts` asserts that against `getBaseRoleStats`.
 */
export const CUSTOM_FORMULA_SEEDS: Record<
    ShipTypeName,
    { rows: CustomFormulaRow[]; fidelity: string }
> = {
    ATTACKER: {
        rows: [core('directDamage')],
        fidelity: 'Exact, except with an Arcane Siege implant.',
    },
    DEFENDER: {
        rows: [core('effectiveHp')],
        fidelity:
            'Approximation. The Defender formula models survival rounds against incoming damage, including healing and shield.',
    },
    DEFENDER_SECURITY: {
        rows: [core('effectiveHp'), core('security')],
        fidelity:
            'Approximation. The Defender formula it builds on models survival rounds against incoming damage.',
    },
    DEBUFFER: {
        rows: [core('hacking'), core('directDamage')],
        fidelity: 'Exact, except with an Arcane Siege implant.',
    },
    DEBUFFER_DEFENSIVE: {
        rows: [core('hacking'), core('effectiveHp')],
        fidelity: 'Exact.',
    },
    DEBUFFER_DEFENSIVE_SECURITY: {
        rows: [core('hacking'), core('security'), bonus('effectiveHp')],
        fidelity:
            'Approximation. The real formula adds effective HP to a hacking-by-security product, which a product cannot express.',
    },
    DEBUFFER_BOMBER: {
        rows: [core('hacking'), core('attack')],
        fidelity: 'Exact, except with an Arcane Siege implant.',
    },
    DEBUFFER_CORROSION: {
        rows: [core('hacking')],
        fidelity: 'Approximation. The role also rewards a 3-piece Decimation set.',
    },
    SUPPORTER: {
        rows: [core('hp'), bonus('healModifier'), bonus('crit', 50), bonus('critDamage', 50)],
        fidelity:
            'Approximation. Heal modifier is a bonus, not a core stat, because it is 0 before gear.',
    },
    SUPPORTER_BUFFER: {
        rows: [core('speed'), bonus('effectiveHp', 50)],
        fidelity: 'Approximation. The role also rewards a 4-piece Boost set.',
    },
    SUPPORTER_OFFENSIVE: {
        rows: [core('speed'), bonus('attack', 50)],
        fidelity: 'Approximation. The role also rewards a 4-piece Boost set.',
    },
    SUPPORTER_SHIELD: {
        rows: [core('hp')],
        fidelity: 'Exact.',
    },
};

/** Roles whose seed ranks builds identically to the role formula itself. */
export const EXACT_SEED_ROLES: readonly ShipTypeName[] = [
    'ATTACKER',
    'DEBUFFER',
    'DEBUFFER_DEFENSIVE',
    'DEBUFFER_BOMBER',
    'SUPPORTER_SHIELD',
];

export function seedFormulaFromRole(role: ShipTypeName): CustomFormula {
    return {
        rows: CUSTOM_FORMULA_SEEDS[role].rows.map((r) => ({ ...r })),
        seededFrom: role,
    };
}
