/**
 * Damage-kind aware shield absorption.
 *
 * Locked game rules (spec 2026-06-25):
 * - Direct hit: shieldEligible = D × (1 − pen/100); absorbed = min(pool, eligible); hp = D − absorbed.
 * - Bomb (detonation): drains shield in FULL (pen = 0); absorbed = min(pool, D); hp = D − absorbed.
 * - DoT (Inferno/Corrosion): bypasses shield entirely; absorbed = 0; hp = D.
 *
 * Pure — no engine state. Pen applies to the DIRECT portion only; the bomb portion is
 * always fully shield-eligible regardless of pen.
 */
export function shieldAbsorb(args: {
    damage: number; // post-block total
    shieldPool: number;
    isDot: boolean; // cause.byDirectDamage === false
    penPct: number; // 0..100, direct portion only
    bombPortion: number; // <= damage
}): { absorbed: number; hpDamage: number } {
    const { damage, shieldPool, isDot, penPct, bombPortion } = args;
    if (isDot) return { absorbed: 0, hpDamage: damage }; // bypass
    // Clamp pen to its 0..100 contract: out-of-range stat values would otherwise
    // make the direct portion negative (pen > 100) and overstate HP damage.
    const clampedPenPct = Math.max(0, Math.min(100, penPct));
    const pool = Math.max(0, shieldPool);
    const bomb = Math.max(0, Math.min(bombPortion, damage));
    const directPortion = damage - bomb;
    const shieldEligible = directPortion * (1 - clampedPenPct / 100) + bomb;
    const absorbed = Math.min(pool, shieldEligible);
    return { absorbed, hpDamage: damage - absorbed };
}
