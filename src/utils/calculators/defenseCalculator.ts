import { DefenseBuffTotals } from '../../types/calculator';
import { calculateDamageReduction, calculateEffectiveHP } from '../autogear/scoring';
import { expectedIncomingFactor } from '../damageComposition';
import { ENEMY_CRIT_RATE } from '../../constants/simulation';

/**
 * `critDamageReduction` is the ship's `damageReduction` stat (crit hits only); callers that have
 * no such stat leave it at 0. The incoming buff channel and the crit reduction share ONE
 * composition, so the 70% non-defence floor binds on their product.
 */
export function computeBuffedStats(
    hp: number,
    defense: number,
    security: number,
    buffTotals?: DefenseBuffTotals,
    critDamageReduction: number = 0
): { buffedDefense: number; damageReduction: number; effectiveHP: number; buffedSecurity: number } {
    const defenseBuff = buffTotals?.defenseBuff ?? 0;
    const incomingDamageBuff = buffTotals?.incomingDamageBuff ?? 0;
    const securityBuff = buffTotals?.securityBuff ?? 0;

    const buffedDefense = defense * (1 + defenseBuff / 100);
    const damageReduction = calculateDamageReduction(buffedDefense);
    const baseEHP = calculateEffectiveHP(hp, buffedDefense);
    // negative incomingDamageBuff means less incoming damage → more effective HP
    const effectiveHP =
        baseEHP / expectedIncomingFactor(incomingDamageBuff, critDamageReduction, ENEMY_CRIT_RATE);
    const buffedSecurity = security + securityBuff;

    return { buffedDefense, damageReduction, effectiveHP, buffedSecurity };
}
