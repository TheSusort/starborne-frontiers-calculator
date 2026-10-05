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
export interface AffinityModifiers {
    damageModifier: number;
    critCap: number;
    critPenalty: number;
}

const ADVANTAGE_MODIFIERS: AffinityModifiers = { damageModifier: 25, critCap: 100, critPenalty: 0 };
const DISADVANTAGE_MODIFIERS: AffinityModifiers = {
    damageModifier: -25,
    critCap: 75,
    critPenalty: 25,
};

export function computeAffinityModifiers(
    attacker: AffinityName | undefined,
    enemy: AffinityName | undefined
): AffinityModifiers {
    const matchup = getAffinityMatchup(attacker, enemy);
    if (matchup === 'advantage') return { ...ADVANTAGE_MODIFIERS };
    if (matchup === 'disadvantage') return { ...DISADVANTAGE_MODIFIERS };
    return { damageModifier: 0, critCap: 100, critPenalty: 0 };
}

/**
 * One hit's matchup modifiers once the two forced-affinity overrides are applied, in their
 * precedence order: an attacker forced to ADVANTAGE (Wusheng's charged hit, the attacker's
 * 'Offensive Affinity Override') beats a victim forcing its attacker to DISADVANTAGE (the victim's
 * 'Defensive Affinity Override'), and either beats the real matchup. The one place that
 * precedence is decided — the cast path, a covered AoE victim, a counter and a reactive proc all
 * resolve through it.
 */
export function affinityModifiersWithOverrides(
    attacker: AffinityName | undefined,
    victim: AffinityName | undefined,
    overrides: { forceAdvantage?: boolean; forceDisadvantage?: boolean }
): AffinityModifiers {
    if (overrides.forceAdvantage) return { ...ADVANTAGE_MODIFIERS };
    if (overrides.forceDisadvantage) return { ...DISADVANTAGE_MODIFIERS };
    return computeAffinityModifiers(attacker, victim);
}

/**
 * The crit rate (0..1) a hit rolls with: the attacker's uncapped crit total less the matchup's
 * penalty, clamped to [0, cap].
 */
export function affinityCappedCritRate(uncappedCrit: number, mods: AffinityModifiers): number {
    return Math.min(mods.critCap, Math.max(0, uncappedCrit - mods.critPenalty)) / 100;
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
