import { DefenseBuffTotals } from '../../types/calculator';
import { calculateDamageReduction, calculateEffectiveHP } from '../autogear/scoring';

export function computeBuffedStats(
    hp: number,
    defense: number,
    buffTotals?: DefenseBuffTotals
): { buffedDefense: number; damageReduction: number; effectiveHP: number } {
    const defenseBuff = buffTotals?.defenseBuff ?? 0;
    const incomingDamageBuff = buffTotals?.incomingDamageBuff ?? 0;

    const buffedDefense = defense * (1 + defenseBuff / 100);
    const damageReduction = calculateDamageReduction(buffedDefense);
    const baseEHP = calculateEffectiveHP(hp, buffedDefense);
    // negative incomingDamageBuff means less incoming damage → more effective HP
    const effectiveHP = baseEHP / (1 + incomingDamageBuff / 100);

    return { buffedDefense, damageReduction, effectiveHP };
}
