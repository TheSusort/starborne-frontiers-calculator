import type { DoTType } from '../../types/calculator';
import type { ActiveDoTStack, PendingBomb } from './state';

// Pure per-victim detonation math, lifted verbatim from playerTurn.ts detonate().
// Computes the DETONATION-category payout for each requested det type and CONSUMES the
// matching container (`.length = 0`) as it resolves, in `dets` order — so a 2nd bomb det
// sees emptied bombs, mirroring the original loop. No events, no HP application.
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
                c.infernoEntries.reduce(
                    (sum, e) =>
                        sum +
                        e.stacks * (e.tier / 100) * recipe.effectiveAttack * e.remainingRounds,
                    0
                ) *
                recipe.dotMult *
                recipe.affinityMult *
                pct *
                recipe.detonationMult;
            c.infernoEntries.length = 0;
        } else if (det.dotType === 'corrosion') {
            const baseHp = Math.min(c.victimHp, 500_000);
            corrosion +=
                c.corrosionEntries.reduce(
                    (sum, e) => sum + e.stacks * (e.tier / 100) * baseHp * e.remainingRounds,
                    0
                ) *
                recipe.dotMult *
                recipe.affinityMult *
                pct *
                recipe.detonationMult;
            c.corrosionEntries.length = 0;
        } else if (det.dotType === 'bomb') {
            bombStacks += c.pendingBombs.reduce((sum, b) => sum + b.stacks, 0);
            bomb +=
                c.pendingBombs.reduce(
                    (sum, b) =>
                        sum +
                        b.stacks *
                            b.damagePerStack *
                            b.affinityMult *
                            (1 + b.detonationDamageModifier / 100),
                    0
                ) * pct;
            c.pendingBombs.length = 0;
        }
    }

    return { bomb, inferno, corrosion, bombStacks, total: bomb + inferno + corrosion };
}
