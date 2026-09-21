import type { ShipTypeName } from '../../../constants/shipTypes';
import type { OffFormulaStat } from './offFormulaStats';

type BasisAxis = 'damage' | 'repair' | 'shield';

interface RoleBasisHost {
    /** The `OffFormulaFinding.produces` axis a derived basis can replace this role's primary
     *  quantity with. `null` when the role has no single scalable quantity to replace: a
     *  defender-style survival score, or a formula that adds terms in a way a basis cannot
     *  substitute into without double-counting a stat the formula already reads elsewhere. */
    axis: BasisAxis | null;
    /** The role's own primary stat that a derived basis stands in for. `null` iff `axis` is
     *  `null` — a role with no host axis has nothing for a basis to replace. */
    primaryStat: OffFormulaStat | null;
}

const noHost: RoleBasisHost = { axis: null, primaryStat: null };

/**
 * Which role formulas a derived basis (`deriveBasis`, `basisDerivation.ts`) can attach to, and
 * which axis/primary stat it replaces there. Sourced from `priorityScore.ts`'s per-role scorers:
 *
 * - ATTACKER, DEBUFFER, DEBUFFER_BOMBER score `attack` (via `calculateDPS`, or hacking x attack
 *   for the bomber) into a `damage` quantity — a damage-axis basis replaces `attack`.
 * - SUPPORTER scores `hp` into a `repair` quantity (`calculateHealerScore`) — a repair-axis
 *   basis replaces `hp`.
 * - SUPPORTER_SHIELD scores `hp` directly as its whole formula, standing in for a `shield`
 *   quantity — a shield-axis basis replaces `hp`.
 *
 * Every other role hosts nothing:
 * - DEFENDER and DEFENDER_SECURITY model survival rounds (`calculateDefenderScore`), not a
 *   single scalable quantity — a basis term inside its HP factor would double-count defence,
 *   which already drives the mitigation curve.
 * - DEBUFFER_DEFENSIVE and DEBUFFER_DEFENSIVE_SECURITY score hacking against effective HP, which
 *   already folds defence into its mitigation curve — same double-counting reason as the
 *   defenders, since effective HP is an hp/defence blend rather than hp alone.
 * - DEBUFFER_CORROSION scores hacking against Decimation-set count, which has no `attack`/`hp`
 *   substitution point at all.
 * - SUPPORTER_BUFFER adds speed and effective HP; ruled out for the same double-counting reason
 *   as the defenders.
 * - SUPPORTER_OFFENSIVE adds speed and `sqrt(attack)` (owner ruling, #544): the square root
 *   compresses a basis in a way no other hosting role's formula does, and nothing measures what
 *   that compression would do to rankings.
 *
 * A `ShipTypeName` added later that is missing here fails to TYPE-CHECK against this total
 * `Record` (`tsc`). `roleBasisHost.test.ts` carries an independent RUNTIME tripwire for the same
 * gap, since `tsc` does not run under `vitest`.
 */
const ROLE_BASIS_HOST: Record<ShipTypeName, RoleBasisHost> = {
    ATTACKER: { axis: 'damage', primaryStat: 'attack' },
    DEBUFFER: { axis: 'damage', primaryStat: 'attack' },
    DEBUFFER_BOMBER: { axis: 'damage', primaryStat: 'attack' },
    SUPPORTER: { axis: 'repair', primaryStat: 'hp' },
    SUPPORTER_SHIELD: { axis: 'shield', primaryStat: 'hp' },
    DEFENDER: noHost,
    DEFENDER_SECURITY: noHost,
    DEBUFFER_DEFENSIVE: noHost,
    DEBUFFER_DEFENSIVE_SECURITY: noHost,
    DEBUFFER_CORROSION: noHost,
    SUPPORTER_BUFFER: noHost,
    SUPPORTER_OFFENSIVE: noHost,
};

/** The `OffFormulaFinding.produces` axis a basis can host on `role`, or `null` if none. */
export function roleAxis(role: ShipTypeName): BasisAxis | null {
    return ROLE_BASIS_HOST[role].axis;
}

/** The stat a hosted basis replaces in `role`'s formula, or `null` if `role` hosts nothing. */
export function rolePrimaryStat(role: ShipTypeName): OffFormulaStat | null {
    return ROLE_BASIS_HOST[role].primaryStat;
}

/** True iff `role` hosts a basis on the `produces` axis — i.e. `roleAxis(role) === produces`. */
export function roleHostsBasis(role: ShipTypeName, produces: BasisAxis): boolean {
    return roleAxis(role) === produces;
}
