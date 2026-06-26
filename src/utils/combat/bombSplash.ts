import type { PendingBomb } from './state';

/** Splash fraction (percent) of a bomb's damage dealt to each adjacent ally when the
 *  carrier dies before detonation. Scales by bomb tier: 100→25, 200→50, 300→75 (tier/4). */
export function splashPctForTier(tier: number): number {
    return tier / 4;
}

/** Splash damage one pending bomb deals to ONE adjacent ally when the carrier dies.
 *  = stacks × damagePerStack × splashPct/100 × (1 + splashModifierPct/100). No affinity
 *  (bombs/DoTs are not affinity-scaled). `splashModifierPct` is the applier's Voidfire
 *  bonus, snapshotted on the bomb at application; defaults to the bomb's own
 *  `splashModifier` so callers can't silently undercount by omitting it. */
export function splashDamageForBomb(
    bomb: PendingBomb,
    splashModifierPct = bomb.splashModifier
): number {
    return (
        bomb.stacks *
        bomb.damagePerStack *
        (splashPctForTier(bomb.tier) / 100) *
        (1 + splashModifierPct / 100)
    );
}
