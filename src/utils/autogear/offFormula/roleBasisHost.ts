import { SHIP_TYPES } from '../../../constants/shipTypes';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { BasisTerm, RoleBasis } from '../../../types/autogear';
import { usableBasisTerms } from '../customFormula';
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
 * `ShipTypeName` is a real union (#547), so `Record<ShipTypeName, RoleBasisHost>` itself gates a
 * `ShipTypeName` added later that is missing here — `tsc --noEmit` fails on a missing or excess
 * key. `roleBasisHost.test.ts`'s per-role walk (calling `roleAxis`/`rolePrimaryStat`/
 * `roleHostsBasis` for every `SHIP_TYPES` key) is defense in depth on top of that compile-time
 * gate, not the only thing enforcing it.
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

/**
 * Whether `roleBasis` applies to `role` at all — the one hosting predicate every basis-aware
 * scorer, sharer, and results computation must agree on (`calculatePriorityScore`,
 * `calculateRoleScore`, `configToSharedBuild`, `runSimulation`).
 *
 * `Object.hasOwn(SHIP_TYPES, role)` guards `roleHostsBasis`, which throws for a role outside its
 * table (`ROLE_BASIS_HOST[role]` is `undefined`) — deliberate for this file's own totality test,
 * but only a caller that always passes a live role should ever reach it. A persisted config can
 * carry a `shipRole` that no longer names a real role, and that must read as "hosts nothing"
 * rather than crash.
 */
export function isRoleBasisHosted(role: ShipTypeName, roleBasis: RoleBasis | undefined): boolean {
    return (
        !!roleBasis && Object.hasOwn(SHIP_TYPES, role) && roleHostsBasis(role, roleBasis.produces)
    );
}

/**
 * `roleBasis.terms`, filtered to what the scorer can use (`usableBasisTerms`), when `role` hosts
 * `roleBasis` on its own axis (`isRoleBasisHosted`) — `undefined` otherwise, including when every
 * term is filtered out. Terms are re-validated through `usableBasisTerms`, the same predicate a
 * custom-formula row's `basis` goes through, so an unusable term (or an all-zero basis) falls
 * back to the plain primary stat rather than silently scoring 0.
 */
export function hostedBasisTerms(
    role: ShipTypeName,
    roleBasis: RoleBasis | undefined
): BasisTerm[] | undefined {
    return isRoleBasisHosted(role, roleBasis) ? usableBasisTerms(roleBasis!.terms) : undefined;
}
