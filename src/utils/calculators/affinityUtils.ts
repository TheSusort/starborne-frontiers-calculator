import { AffinityName } from '../../types/ship';

export type AffinityMatchup = 'advantage' | 'disadvantage' | 'neutral';

const ADVANTAGE_OVER: Partial<Record<AffinityName, AffinityName>> = {
    thermal: 'chemical',
    chemical: 'electric',
    electric: 'thermal',
};

export function getAffinityMatchup(
    attacker: AffinityName | undefined,
    enemy: AffinityName | undefined
): AffinityMatchup {
    if (!attacker || !enemy) return 'neutral';
    if (attacker === 'antimatter' || enemy === 'antimatter') return 'neutral';
    if (attacker === enemy) return 'neutral';
    if (ADVANTAGE_OVER[attacker] === enemy) return 'advantage';
    if (ADVANTAGE_OVER[enemy] === attacker) return 'disadvantage';
    return 'neutral';
}

export function computeAffinityModifiers(
    attacker: AffinityName | undefined,
    enemy: AffinityName | undefined
): { damageModifier: number; critCap: number; critPenalty: number } {
    const matchup = getAffinityMatchup(attacker, enemy);
    if (matchup === 'advantage') return { damageModifier: 25, critCap: 100, critPenalty: 0 };
    if (matchup === 'disadvantage') return { damageModifier: -25, critCap: 75, critPenalty: 25 };
    return { damageModifier: 0, critCap: 100, critPenalty: 0 };
}
