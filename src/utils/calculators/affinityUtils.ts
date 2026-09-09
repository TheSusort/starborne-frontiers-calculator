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

/**
 * The matchup's stat modifiers.
 *
 * `damageModifier` is ONE number the game applies to TWO clauses: the damage dealt, and the
 * hacking a debuff rolls with. The in-game loading screen states both — advantage is "25%
 * increased Damage / 25% increased Hacking", disadvantage is "Damage and Hacking decreased by
 * 25%". There is deliberately NO separate hacking field: a second copy of the same number could
 * drift from this one, and the game gives them no way to differ. Hacking callers apply it through
 * `affinityScaledHacking` below; `critCap`/`critPenalty` cover the disadvantage crit clause.
 *
 * The other disadvantage clause — affinity-gated effects that need no hacking roll simply do not
 * apply — is not priced here; it is a matchup test at the call site (`getAffinityMatchup(...) !==
 * 'disadvantage'`). See `docs/combat-system.md` §8.
 */
export function computeAffinityModifiers(
    attacker: AffinityName | undefined,
    enemy: AffinityName | undefined
): { damageModifier: number; critCap: number; critPenalty: number } {
    const matchup = getAffinityMatchup(attacker, enemy);
    if (matchup === 'advantage') return { damageModifier: 25, critCap: 100, critPenalty: 0 };
    if (matchup === 'disadvantage') return { damageModifier: -25, critCap: 75, critPenalty: 25 };
    return { damageModifier: 0, critCap: 100, critPenalty: 0 };
}

/**
 * The hacking a debuff actually rolls with, once the matchup is applied — the hacking clause of
 * `computeAffinityModifiers`' modifier, which is why it takes that same number rather than a
 * hacking-specific one.
 *
 * `hacking` must already carry its buffs: affinity scales the buffed total, not the base.
 * `liveDebuffLandingChance` (combat/effectiveStats.ts) is the caller, and owns the
 * hacking-vs-security comparison this feeds.
 */
export function affinityScaledHacking(hacking: number, affinityModifier: number): number {
    return hacking * (1 + affinityModifier / 100);
}
