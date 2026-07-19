/**
 * Pre-fight ship-passive application (combat-realism sub-project F, PR F5).
 *
 * Applies the parsed `pre-combat-stat` abilities (PR F4: Lionheart / Centurion / Enforcer /
 * Defiant / Stalwart) to ONE side's placement-plan stats, once, before actor/roster
 * construction. Ordering rule (spec, Architecture): the squad-leader pass runs FIRST, this
 * pass SECOND — so every grant here computes from the frozen POST-LEADER stats.
 *
 * Simultaneity: all grants are computed against a snapshot taken before ANY grant is
 * applied, so no grant ever sees another grant's output — Lionheart's "10% of its HP"
 * reads HIS post-leader hp, and a Defiant standing next to Lionheart computes its own
 * "+20% HP" from its PRE-grant hp (excluding Lionheart's gift).
 *
 * Death-reset: nothing to do — grants fold into the plans' BASE stats exactly once
 * pre-combat (roster maxHp / currentHp seeding / turn order inherit them) and base stats
 * are never re-derived mid-fight, so a donor's death cannot retract a grant. That matches
 * the locked game rule: pre-fight passives are hidden, permanent, and not reset on death.
 */
import { matchesRoleCategory, type ShipTypeName } from '../../constants/shipTypes';
import type { ShipSkills } from '../../types/abilities';
import type { Position } from '../../types/encounters';
import type { PreFightStatBlock } from './preFight/types';
import { adjacentAllyIds } from './adjacency';

/** Structural slice of the battle simulator's private `PlacementPlan` — exactly the
 *  fields this pass reads. `stats` is shared BY REFERENCE with the caller's plan and is
 *  mutated in place (the same contract as the pre-fight squad-leader pass). */
export interface PreCombatPlanLike {
    id: string;
    position: Position;
    /** The plan's derived combat stats (post-squad-leader) — mutated in place. */
    stats: PreFightStatBlock;
    shipSkills: ShipSkills;
    /** The ship's role — gates `requiresAdjacentRole` grants. Undefined never matches. */
    role: ShipTypeName | undefined;
}

/** One applied grant, for tests/telemetry: who granted what to whom. Zero-amount grants
 *  (e.g. a per-adjacent-ally grant with no neighbours) are not recorded. */
export interface AppliedPreCombatGrant {
    ownerId: string;
    recipientId: string;
    stat: 'hp' | 'attack' | 'crit' | 'hacking' | 'defence';
    amount: number;
}

/**
 * Apply every passive-slot `pre-combat-stat` ability across ONE side's plans (passives
 * never cross sides — call once per side; team symmetry by construction).
 *
 * Only the PASSIVE slot is honored: `buildShipAbilities` emits the type on any slot whose
 * text happens to match (defensive — no slot gate there), but only the refit-resolved
 * passive row is a real pre-fight passive in-game.
 */
export function applyPreCombatShipPassives(plans: PreCombatPlanLike[]): AppliedPreCombatGrant[] {
    // Frozen post-squad-leader snapshot: EVERY grant amount below reads from here, never
    // from the live (possibly already-granted) stats — simultaneity, no cascading.
    const snapshot = new Map<string, PreFightStatBlock>(
        plans.map((plan) => [plan.id, { ...plan.stats }])
    );
    const byId = new Map<string, PreCombatPlanLike>(plans.map((plan) => [plan.id, plan]));

    // Per-plan accumulated deltas, applied only after the full sweep.
    const deltas = new Map<string, Partial<Record<AppliedPreCombatGrant['stat'], number>>>();
    const applied: AppliedPreCombatGrant[] = [];
    const accumulate = (grant: AppliedPreCombatGrant): void => {
        if (grant.amount === 0) return;
        const bucket = deltas.get(grant.recipientId) ?? {};
        bucket[grant.stat] = (bucket[grant.stat] ?? 0) + grant.amount;
        deltas.set(grant.recipientId, bucket);
        applied.push(grant);
    };

    for (const owner of plans) {
        // Same adjacency definition as Protection/redirect: hex neighbours of the owner's
        // cell (all plans carry positions, so the positional branch always applies here).
        const adjacentIds = adjacentAllyIds(owner.id, plans);
        const adjacentPlans = adjacentIds.flatMap((id) => byId.get(id) ?? []);
        const ownerSnapshot = snapshot.get(owner.id);
        if (!ownerSnapshot) continue;

        for (const slot of owner.shipSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const ability of slot.abilities) {
                const config = ability.config;
                if (config.type !== 'pre-combat-stat') continue;

                // Role gate: at least one adjacent ally of the required category
                // (prefix match over ShipTypeName; an undefined role never matches).
                const requiredRole = config.requiresAdjacentRole;
                if (
                    requiredRole !== undefined &&
                    !adjacentPlans.some((p) => matchesRoleCategory(p.role, [requiredRole]))
                ) {
                    continue;
                }

                const perAllyFactor = config.perAdjacentAlly ? adjacentPlans.length : 1;
                // Recipient set: adjacent-allies grants gated by `requiresAdjacentRole` go
                // ONLY to the adjacent allies matching that role (Madax → "that Supporter's
                // Defense", not every neighbour) — the existence gate above only asked
                // WHETHER the grant fires, not WHO receives it. Self-targeted role-gated
                // grants (Enforcer/Defiant/Stalwart) are unaffected: they always resolve to
                // [owner] regardless of role, same as before.
                const recipients =
                    ability.target === 'adjacent-allies'
                        ? requiredRole !== undefined
                            ? adjacentPlans.filter((p) =>
                                  matchesRoleCategory(p.role, [requiredRole])
                              )
                            : adjacentPlans
                        : [owner];

                for (const recipient of recipients) {
                    const recipientSnapshot = snapshot.get(recipient.id);
                    if (!recipientSnapshot) continue;
                    // Amount from the SNAPSHOT: flat points ('crit' is a percentage-only
                    // stat, so its flat value adds directly as crit points), % of the
                    // recipient's own stat, or % of the DONOR's stat (Lionheart).
                    const base =
                        config.valueKind === 'flat'
                            ? config.value
                            : config.valueKind === 'percent-of-own'
                              ? (recipientSnapshot[config.stat] * config.value) / 100
                              : (ownerSnapshot[config.stat] * config.value) / 100;
                    accumulate({
                        ownerId: owner.id,
                        recipientId: recipient.id,
                        stat: config.stat,
                        amount: base * perAllyFactor,
                    });
                }
            }
        }
    }

    // Apply after the full sweep (no rounding — plan stats stay exact).
    for (const [id, bucket] of deltas) {
        const plan = byId.get(id);
        if (!plan) continue;
        for (const [stat, delta] of Object.entries(bucket)) {
            plan.stats[stat as AppliedPreCombatGrant['stat']] += delta;
        }
    }
    return applied;
}
