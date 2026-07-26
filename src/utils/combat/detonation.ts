import type { DoTType } from '../../types/calculator';
import type { ActiveDoTStack, PendingBomb } from './state';

// Pure per-victim detonation math, lifted verbatim from playerTurn.ts detonate().
// Computes the DETONATION-category payout for each requested det type and CONSUMES the
// matching container as it resolves, in `dets` order — so a 2nd bomb det sees emptied bombs,
// mirroring the original loop. No events, no HP application. `recipe.detonatable`, when
// present, narrows what a det may consume to the entries that predate the cast (own-stack
// protection on the deferred positional path — see the field's doc).
//
// Precedence is preserved EXACTLY:
//  - inferno: Σ(stacks · tier/100 · effectiveAttack · remainingRounds) · dotMult · affinityMult · pct · detonationMult
//  - corrosion: Σ(stacks · tier/100 · baseHp · remainingRounds) · dotMult · affinityMult · pct · detonationMult,
//               baseHp = min(victimHp, 500_000)
//  - bomb: Σ(stacks · damagePerStack · b.affinityMult · (1 + b.detonationDamageModifier/100)) · pct
//          — per-bomb snapshots ONLY (NO dotMult/affinityMult/detonationMult).

export interface DetonationRecipe {
    // SP-E: widened to the full DoTType (generic never enters `dets` — no detonation ability
    // targets it — but the config it's built from carries DoTType, so this must accept it too;
    // the if/else-if chain below correctly no-ops for 'generic', same as it already does for any
    // dotType it doesn't explicitly branch on).
    dets: { dotType: DoTType; powerPct: number }[];
    effectiveAttack: number;
    dotMult: number;
    affinityMult: number;
    detonationMult: number;
    /**
     * OWN-STACK PROTECTION (positional path only): the exact container entries this cast is
     * allowed to detonate, captured BEFORE the cast applied its own new DoTs. Entries missing
     * from the set (i.e. appended by this same cast) are neither paid out nor consumed.
     *
     * The non-positional path needs no set — it detonates at Step 2.95, before Step 3 applies
     * new DoTs, so ordering alone guarantees "a skill that detonates and re-applies the same
     * type doesn't eat its own new stack". The positional path DEFERS the detonation until
     * after the whole turn body (the engine's per-victim loop consumes the recipe), so it must
     * carry the eligibility set to reproduce that guarantee. Identity-based rather than
     * index/length-based so it stays correct no matter how many victims' containers a single
     * cast appends to (anchor + splash) or in what order.
     *
     * Omitted ⇒ every entry present at detonation time is eligible (the historical behaviour;
     * all non-positional and hand-authored callers).
     */
    detonatable?: ReadonlySet<ActiveDoTStack | PendingBomb>;
}

export interface DetonationContainers {
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    victimHp: number;
}

export interface DetonationResult {
    bomb: number;
    inferno: number;
    corrosion: number;
    bombStacks: number;
    total: number;
}

/**
 * Consume a container IN PLACE (same array object — every caller holds the live actor-field
 * reference, so this must never reassign) and return the entries the recipe actually detonates.
 * Without a `detonatable` set that is the whole container (`.length = 0`, as before); with one it
 * is the eligible subset, and the ineligible entries are pushed back in their original order.
 */
function consumeDetonatable<T>(container: T[], detonatable: ReadonlySet<unknown> | undefined): T[] {
    if (!detonatable) {
        const all = container.slice();
        container.length = 0;
        return all;
    }
    const consumed: T[] = [];
    const kept: T[] = [];
    for (const entry of container) (detonatable.has(entry) ? consumed : kept).push(entry);
    container.length = 0;
    container.push(...kept);
    return consumed;
}

export function detonateContainers(
    recipe: DetonationRecipe,
    c: DetonationContainers
): DetonationResult {
    let bomb = 0;
    let inferno = 0;
    let corrosion = 0;
    let bombStacks = 0;

    for (const det of recipe.dets) {
        const pct = det.powerPct / 100;
        if (det.dotType === 'inferno') {
            inferno +=
                consumeDetonatable(c.infernoEntries, recipe.detonatable).reduce(
                    (sum, e) =>
                        sum +
                        e.stacks * (e.tier / 100) * recipe.effectiveAttack * e.remainingRounds,
                    0
                ) *
                recipe.dotMult *
                recipe.affinityMult *
                pct *
                recipe.detonationMult;
        } else if (det.dotType === 'corrosion') {
            const baseHp = Math.min(c.victimHp, 500_000);
            corrosion +=
                consumeDetonatable(c.corrosionEntries, recipe.detonatable).reduce(
                    (sum, e) => sum + e.stacks * (e.tier / 100) * baseHp * e.remainingRounds,
                    0
                ) *
                recipe.dotMult *
                recipe.affinityMult *
                pct *
                recipe.detonationMult;
        } else if (det.dotType === 'bomb') {
            const bombs = consumeDetonatable(c.pendingBombs, recipe.detonatable);
            bombStacks += bombs.reduce((sum, b) => sum + b.stacks, 0);
            bomb +=
                bombs.reduce(
                    (sum, b) =>
                        sum +
                        b.stacks *
                            b.damagePerStack *
                            b.affinityMult *
                            (1 + b.detonationDamageModifier / 100),
                    0
                ) * pct;
        }
    }

    return { bomb, inferno, corrosion, bombStacks, total: bomb + inferno + corrosion };
}
