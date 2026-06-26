import type { PendingBomb } from './state';

/** Splash fraction (percent) of a bomb's damage dealt to each adjacent ally when the
 *  carrier dies before detonation. Scales by bomb tier: 100→25, 200→50, 300→75 (tier/4). */
export function splashPctForTier(tier: number): number {
    return tier / 4;
}

/** Splash damage one pending bomb deals to ONE adjacent ally when the carrier dies.
 *  = stacks × damagePerStack × splashPct/100 × (1 + splashModifierPct/100). No affinity
 *  (bombs/DoTs are not affinity-scaled). `splashModifierPct` is the applier's Voidfire
 *  bonus (wired in a later phase); defaults to 0. */
export function splashDamageForBomb(bomb: PendingBomb, splashModifierPct = 0): number {
    return (
        bomb.stacks *
        bomb.damagePerStack *
        (splashPctForTier(bomb.tier) / 100) *
        (1 + splashModifierPct / 100)
    );
}
