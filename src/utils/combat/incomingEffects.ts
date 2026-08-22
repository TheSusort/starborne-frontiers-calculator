import { Ability, IncomingCondition, IncomingHitContext } from '../../types/abilities';
import type { FactionKey } from '../../constants/factions';
import { resolveSupportRecipients } from './supportRecipients';

/**
 * #363 — which actors an ALLY-SCOPED `incoming-reduction` ability protects.
 *
 * Every pre-#363 member of the incoming family is `target: 'self'`, so the engine's per-actor
 * incoming-effects map only ever keyed an ability onto its own carrier. Fuying's "All Tianchao
 * allies with Stealth take 30% less direct damage" is the corpus's first ally-scoped one, and it
 * has to be keyed onto its RECIPIENTS instead — the victim-side read is
 * `incomingAbilitiesOf(victim.id)`.
 *
 * Lifted out of the engine as a PURE function so the recipient SET is directly assertable. That
 * matters for one rule in particular that has no observable consequence on Fuying herself and so
 * cannot be pinned by any outcome:
 *
 * ⚠️ THE OWNER IS NOT EXCLUDED. Nothing here singles the carrier out. Fuying drops out of her own
 * aura's recipient set only because her active pattern is Not-Self and therefore omits her cell,
 * and she is doubly inert because `self-stealth` fails for her (that same Not-Self cast is what
 * grants Stealth, so she never holds it). Hardcoding "the owner is never a recipient" would encode
 * a fact about her GRANT's pattern into the AURA's recipient resolution, and would break silently
 * the day a carrier's pattern includes its own cell, a ship self-grants Stealth, or a teammate
 * grants Stealth to the carrier.
 *
 * Narrowing is the same shared composition every other #363 site uses (footprint, then faction):
 *  - `footprintAllyIds` is consulted ONLY when the ability is `patternScoped` (OWNER-RULED
 *    2026-08-22: a Stealthed Tianchao ally standing OUTSIDE Fuying's active pattern takes FULL
 *    damage). `undefined` means "do not narrow" per this codebase's convention — a non-positional
 *    or non-support pattern leaves the aura team-wide rather than silencing it.
 *  - an actor whose faction is unknown NEVER matches a filter (conservative: the aura can only
 *    under-reach, never over-reach, when faction data is missing).
 */
export function allyScopedIncomingRecipients(args: {
    ability: Ability;
    ownerId: string;
    /** Living same-side actor ids, in roster order. */
    livingSameSideIds: string[];
    /** Living ally ids on the owner's active support footprint; `undefined` → do not narrow. */
    footprintAllyIds: string[] | undefined;
    factionOf: (id: string) => FactionKey | undefined;
}): string[] {
    const { ability, ownerId, livingSameSideIds, footprintAllyIds, factionOf } = args;
    return resolveSupportRecipients({
        target: ability.target,
        casterId: ownerId,
        baseRecipients: livingSameSideIds,
        ...(ability.patternScoped === true ? { footprintAllyIds } : {}),
        factionFilter: ability.factionFilter,
        factionOf,
    });
}

/** True when an incoming condition is satisfied by the hit context. Exported (SP-E) so the
 *  engine's applyVictimDamage transform hook can gate a 'transform-incoming-to-dot' ability's
 *  `condition` the same way incomingReductionForHit/incomingBlockForIntake do internally. */
export function conditionMet(cond: IncomingCondition, ctx: IncomingHitContext): boolean {
    switch (cond) {
        case 'self-stealth':
            return ctx.victimStealthed;
        case 'self-stasis':
            return ctx.victimStasised;
        case 'incoming-crit':
            return ctx.didCrit;
        case 'incoming-crit-by-stealthed':
            return ctx.didCrit && ctx.attackerStealthed;
        case 'nth-hit-2plus':
            return ctx.hitIndexThisRound >= 2;
        case 'dot-inferno-corrosion':
            return ctx.dotType === 'inferno' || ctx.dotType === 'corrosion';
        case 'attacker-has-dot':
            return ctx.attackerHasDot;
        case 'self-barrier-recharging':
            return ctx.victimHasBarrierRecharging;
        case 'self-shielded':
            return ctx.victimHasShield;
        case 'attacker-taunted-or-provoke':
            return ctx.attackerTauntedOrProvoked;
        case 'self-protection-redirect':
            return ctx.viaProtectionRedirect ?? false;
        case 'always':
            return true;
    }
}

/**
 * Total incoming %-reduction for one hit (D-PR3 composition):
 *   max(applicable crit-family entries) + sum(applicable non-crit-family entries).
 * `scope` must match the hit: 'dot' entries apply only when ctx.dotType is set; 'direct'
 * entries only when it is not. Returns 0 when nothing applies.
 */
export function incomingReductionForHit(
    victimAbilities: Ability[],
    ctx: IncomingHitContext
): number {
    const isDot = ctx.dotType !== undefined;
    let nonCritSum = 0;
    let critFamilyMax = 0;
    for (const a of victimAbilities) {
        if (a.config.type !== 'incoming-reduction') continue;
        const { scope, condition, pct, critFamily, hpScaling } = a.config;
        if ((scope === 'dot') !== isDot) continue;
        if (!conditionMet(condition, ctx)) continue;
        // Epic PR12 (C): hpScaling REPLACES the flat pct with a continuous HP-proportional
        // value (Tormenter) — perUnit per missing-HP-point, capped.
        const effectivePct = hpScaling
            ? Math.min(hpScaling.cap, hpScaling.perUnit * (100 - ctx.selfHpPct))
            : pct;
        if (critFamily) critFamilyMax = Math.max(critFamilyMax, effectivePct);
        else nonCritSum += effectivePct;
    }
    return nonCritSum + critFamilyMax;
}

/**
 * Blocked fraction (0..1) for one DIRECT-damage intake. Full block (blockPct 1.0)
 * supersedes any partial block. `rollBlock(abilityId, chance)` is the engine-supplied
 * deterministic gate (true = proc). Returns 0 when nothing blocks. The once-per-round
 * guard is enforced by the ENGINE wrapper inside rollBlock; this function stays pure.
 */
export function incomingBlockForIntake(
    victimAbilities: Ability[],
    ctx: IncomingHitContext,
    rollBlock: (abilityId: string, chance: number) => boolean
): number {
    let best = 0;
    for (const a of victimAbilities) {
        if (a.config.type !== 'incoming-block') continue;
        if (!conditionMet(a.config.condition, ctx)) continue;
        if (!rollBlock(a.id, a.config.procChance)) continue;
        best = Math.max(best, a.config.blockPct);
        if (best >= 1) return 1;
    }
    return best;
}
