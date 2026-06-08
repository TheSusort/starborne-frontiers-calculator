import { Ability, ShipSkills, Skill } from '../../types/abilities';
import { DoTApplicationConfig, SecondaryDamage } from '../../types/calculator';
import { ConditionContext, conditionsMet, scaledBonus } from './evaluateConditions';

/** Folded passive-modifier deltas, in the same units as the DPS buff totals (percentage points). */
export interface ModifierTotals {
    attack: number;
    crit: number;
    critDamage: number;
    outgoingDamage: number;
    defence: number;
    defensePenetration: number;
    hp: number;
}

/**
 * Sum the values of all active `modifier` abilities into stat buckets. A modifier is
 * "active" when its conditions are met for the given context. Channels map to buckets
 * 1:1 except `defense` → `defence` (spelling). `outgoingHeal` and `incomingDamage`
 * have no DPS bucket and are ignored. Returns all-zero totals when nothing applies.
 */
export function modifierTotalsFromAbilities(
    abilities: Ability[],
    ctx: ConditionContext
): ModifierTotals {
    const totals: ModifierTotals = {
        attack: 0,
        crit: 0,
        critDamage: 0,
        outgoingDamage: 0,
        defence: 0,
        defensePenetration: 0,
        hp: 0,
    };
    for (const ability of abilities) {
        if (ability.type !== 'modifier' || ability.config.type !== 'modifier') continue;
        // Bare scaling-source conditions scale, never gate (see gateConditions). For
        // parser-emitted pure-scaling modifiers (value 0) this is outcome-identical
        // (gate-off vs 0+0); it matters for editor-built flat-value + scaling modifiers,
        // where the flat part applies unconditionally.
        if (!conditionsMet(gateConditions(ability), ctx)) continue;
        // `isMultiplicative` is intentionally ignored: these deltas are summed into the
        // same additive-percentage buff totals as the buff path (calculateBuffTotals).
        // Revisit if a flat or true-multiplicative modifier is ever introduced.
        // Additive: flat config value + per-condition scaled bonus (capped). A pure
        // scaling modifier (e.g. "7.5% defPen per buff, up to 45%") has value 0 and a
        // scaling rule; a flat modifier has no scaling.
        const { channel } = ability.config;
        const amount = ability.config.value + (ability.scaling ? scaledBonus(ability, ctx) : 0);
        switch (channel) {
            case 'attack':
                totals.attack += amount;
                break;
            case 'crit':
                totals.crit += amount;
                break;
            case 'critDamage':
                totals.critDamage += amount;
                break;
            case 'outgoingDamage':
                totals.outgoingDamage += amount;
                break;
            case 'defense':
                totals.defence += amount;
                break;
            case 'defensePenetration':
                totals.defensePenetration += amount;
                break;
            case 'hp':
                totals.hp += amount;
                break;
            // 'outgoingHeal' | 'incomingDamage' have no DPS bucket — ignore.
        }
    }
    return totals;
}

/** The skill in the slot matching the round's action, or undefined if absent. */
export function selectFiringSkill(
    shipSkills: ShipSkills,
    action: 'active' | 'charged'
): Skill | undefined {
    return shipSkills.slots.find((s) => s.slot === action);
}

/**
 * Damage inputs for a firing skill: the first `damage` ability's multiplier and
 * hit count (default 1), plus the ability itself for conditional scaling. When
 * there is no damage ability, contributes nothing (multiplier 0, hits 1).
 */
export function damageInputsFromSkill(skill: Skill | undefined): {
    multiplier: number;
    hits: number;
    scalingAbility?: Ability;
    noCrit: boolean;
} {
    const damage = skill?.abilities.find((a) => a.type === 'damage');
    if (!damage || damage.config.type !== 'damage') {
        return { multiplier: 0, hits: 1, scalingAbility: undefined, noCrit: false };
    }
    return {
        multiplier: damage.config.multiplier,
        hits: damage.config.hits ?? 1,
        scalingAbility: damage,
        noCrit: damage.config.noCrit ?? false,
    };
}

/** First `additional-damage` ability mapped to a SecondaryDamage, or undefined. */
export function secondaryFromSkill(skill: Skill | undefined): SecondaryDamage | undefined {
    const additional = skill?.abilities.find((a) => a.type === 'additional-damage');
    if (!additional || additional.config.type !== 'additional-damage') return undefined;
    return { stat: additional.config.stat, pct: additional.config.pct };
}

/** All `dot` abilities mapped to DoT application entries. */
export function dotsFromSkill(skill: Skill | undefined): DoTApplicationConfig {
    if (!skill) return [];
    const config: DoTApplicationConfig = [];
    for (const ability of skill.abilities) {
        if (ability.type !== 'dot' || ability.config.type !== 'dot') continue;
        config.push({
            id: ability.id,
            type: ability.config.dotType,
            tier: ability.config.tier,
            stacks: ability.config.stacks,
            duration: ability.config.duration,
        });
    }
    return config;
}

/** All `charge` abilities on the skill. */
export function chargeAbilitiesFromSkill(skill: Skill | undefined): Ability[] {
    return skill?.abilities.filter((a) => a.type === 'charge') ?? [];
}

/** Cast-time `control` abilities on the skill (e.g. Defiant's charged Stasis inflict). The engine
 *  does NOT simulate the control effect; the cast path emits `control-applied` so reactions fire.
 *  Filters to `trigger === 'on-cast'` (mirrors extraActionsFromSkill) so a reactive or
 *  annotation-only control ability can't over-emit `control-applied` from the cast path. */
export function controlAbilitiesFromSkill(skill: Skill | undefined): Ability[] {
    return skill?.abilities.filter((a) => a.type === 'control' && a.trigger === 'on-cast') ?? [];
}

/** `detonate-dot` abilities on the skill, as {dotType, powerPct} pairs. */
export function detonationsFromSkill(
    skill: Skill | undefined
): { dotType: 'corrosion' | 'inferno' | 'bomb'; powerPct: number }[] {
    if (!skill) return [];
    const out: { dotType: 'corrosion' | 'inferno' | 'bomb'; powerPct: number }[] = [];
    for (const ability of skill.abilities) {
        if (ability.config.type === 'detonate-dot') {
            out.push({ dotType: ability.config.dotType, powerPct: ability.config.powerPct });
        }
    }
    return out;
}

/**
 * The conditions that act as GATES for an ability: all of them EXCEPT a bare
 * scaling-source condition — the one at `scaling.conditionIndex` with no explicit
 * `countComparator`. That condition exists to SCALE the bonus (scaledBonus reads
 * its raw count); the base effect fires regardless. Meiying: "dealing 190% damage,
 * and when attacking a Supporter, it additionally deals 90%" — the 190% hits
 * everyone, only the +90% is Supporter-gated. A scaling condition WITH a
 * countComparator (e.g. "if the enemy has 3+ debuffs…") is deliberately both
 * scaler and gate (the count-threshold invariant: comparator gates, raw count
 * scales). Note: removing the scaling condition from an anyOf OR-run could in
 * principle reshape groups, but parser-emitted scaling conditions are always
 * single and the editor's scaling hardcodes conditions[0].
 */
function gateConditions(ability: Ability): Ability['conditions'] {
    const idx = ability.scaling?.conditionIndex;
    if (idx == null) return ability.conditions;
    const scalingCond = ability.conditions[idx];
    if (!scalingCond || scalingCond.countComparator != null) return ability.conditions;
    return ability.conditions.filter((_, i) => i !== idx);
}

/**
 * Hard condition gate for the firing skill's payload abilities, walked in ARRAY
 * ORDER (the parser emits in skill-text order — the game's execution order).
 * An ability whose GATE conditions fail contributes nothing this round (dropped
 * from the returned skill); a bare scaling-source condition only scales, never
 * gates (see gateConditions). A kept `dot` ability increments an enemy-debuff
 * overlay (+1 ENTRY, matching the sim's entry-count semantics) so LATER abilities
 * in the same cast see it — "Inflicts 2 Corrosion. Deals 90% +30% per debuff"
 * resolves like the game. `ctxFor` records each ability's positional context so
 * scaling (scaledBonus) uses the counts as of that ability's position.
 *
 * Covers the firing-skill payload path only; modifier and extend-dot abilities
 * keep their own firing+passive gating. Buff/debuff abilities gate dynamically in
 * the combat engine (src/utils/combat/engine.ts + abilityStatusGating.ts) — timed
 * at application, auras per-round — not statically at conversion.
 */
export function gateFiringAbilities(
    skill: Skill | undefined,
    baseCtx: ConditionContext
): { gatedSkill: Skill | undefined; ctxFor: Map<string, ConditionContext> } {
    const ctxFor = new Map<string, ConditionContext>();
    if (!skill) return { gatedSkill: undefined, ctxFor };
    let overlay = 0;
    const kept: Ability[] = [];
    for (const ability of skill.abilities) {
        const ctx =
            overlay > 0
                ? { ...baseCtx, enemyDebuffCount: baseCtx.enemyDebuffCount + overlay }
                : baseCtx;
        ctxFor.set(ability.id, ctx);
        if (!conditionsMet(gateConditions(ability), ctx)) continue;
        kept.push(ability);
        if (ability.config.type === 'dot') overlay += 1;
    }
    return { gatedSkill: { ...skill, abilities: kept }, ctxFor };
}

/** An extra-action grant collected from a (pre-gated) skill. The engine re-inserts
 *  the granting actor into the round's remaining turn queue once per descriptor,
 *  enforcing oncePerRound per actor per round. */
export interface ExtraActionGrant {
    abilityId: string;
    oncePerRound: boolean;
}

/** `extra-action` abilities on the skill that fire on cast. Conditions are already
 *  hard-gated by gateFiringAbilities (failing entries were dropped); non-on-cast
 *  triggers (annotation-only seams: on-kill/ally-destroyed texts are disqualified at
 *  parse time, but a manually-configured one must not fire on cast) are skipped. */
export function extraActionsFromSkill(skill: Skill | undefined): ExtraActionGrant[] {
    if (!skill) return [];
    const out: ExtraActionGrant[] = [];
    for (const ability of skill.abilities) {
        if (ability.config.type !== 'extra-action') continue;
        if (ability.trigger !== 'on-cast') continue;
        out.push({ abilityId: ability.id, oncePerRound: ability.config.oncePerRound });
    }
    return out;
}

/** `accumulate-detonate` abilities on the skill, as {turns, pct} pairs (e.g. Echoing Burst). */
export function accumulatorsFromSkill(skill: Skill | undefined): { turns: number; pct: number }[] {
    if (!skill) return [];
    const out: { turns: number; pct: number }[] = [];
    for (const ability of skill.abilities) {
        if (ability.config.type === 'accumulate-detonate') {
            out.push({ turns: ability.config.turns, pct: ability.config.pct });
        }
    }
    return out;
}
