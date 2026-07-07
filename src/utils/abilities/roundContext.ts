import { EnemyBaseClass } from '../../types/calculator';
import type { ActiveDoTStack } from '../combat/state';
import { ConditionContext } from './evaluateConditions';

/**
 * SP-E — sums live DoT entries by their `family` tag (e.g. Belladonna's named "Acidic
 * Decay" gate). Untagged entries — every DoT stack in the game today, since only E4's
 * Corrosion→Acidic-Decay conversion sets `family` — contribute to no named family, so this
 * returns `{}` for every existing ship. That keeps `enemyDotFamilyCounts` (and therefore any
 * `enemy-dot-count` named-family gate) DPS-byte-identical until a family-tagged stack actually
 * exists at runtime.
 */
export function dotFamilyCounts(
    corrosion: ActiveDoTStack[],
    inferno: ActiveDoTStack[],
    generic: ActiveDoTStack[]
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of [...corrosion, ...inferno, ...generic]) {
        if (e.family) out[e.family] = (out[e.family] ?? 0) + 1;
    }
    return out;
}

/**
 * Assemble a {@link ConditionContext} from per-round DPS-sim state.
 *
 * `enemyDebuffCount` uses ENTRY-ARRAY LENGTHS (active DoT entries / pending bombs),
 * NOT total stacks — matching the inline conditional/charge logic it replaces.
 * The remaining fields are DPS-assumption defaults: self HP is fixed at 100 (the sim
 * never takes damage); enemy HP is caller-derived (`enemyHpPct`, default 100);
 * no self-debuffs / enemy-buffs / adjacency.
 */
export function buildRoundContext(state: {
    selfBuffNames: string[];
    landedEnemyDebuffCount: number;
    corrosionEntryCount: number; // = corrosionEntries.length (active DoT entries, NOT total stacks)
    infernoEntryCount: number; // = infernoEntries.length
    bombCount: number; // = pendingBombs.length
    effectiveCritRate: number; // 0..100
    enemyType?: EnemyBaseClass;
    roundCrit?: boolean;
    /** Derived enemy HP% (0..100): 100 × max(0, 1 − cumulativeDamage/enemyHp). Default 100. */
    enemyHpPct?: number;
    /** Self HP% (0..100). Default 100 (DPS-assumption: self never takes damage). */
    selfHpPct?: number;
    /** Heal target's live HP% (0..100) for `hpSubject:'target'` gates. Default 100
     *  (DPS-assumption / no heal target → a "below N" target gate fails → inert). */
    targetHpPct?: number;
    /** Active buff names on the enemy. Default [] (DPS-assumption: no enemy buffs). */
    enemyBuffNames?: string[];
    /** Sub-project I, PR I1 — NAMES on the opposing (primary) target, for name-specific
     *  `enemy-debuff` gates. SENTINEL: leave `undefined` (do NOT pass `[]`) to keep the legacy
     *  name-agnostic `enemyDebuffCount` path — this is the DPS-parity invariant (the DPS
     *  simulator never supplies this param). Only the live combat engine (real/positional
     *  target) opts in with a real (possibly empty) array. See ConditionContext.enemyDebuffNames. */
    enemyDebuffNames?: string[];
    /** Active debuff names on self. Default [] (DPS-assumption: no self-debuffs). */
    selfDebuffNames?: string[];
    /** Owner has the lowest Speed among its (player) team. Default true (lone-actor /
     *  DPS assumption: a single attacker is trivially the slowest). Populated live by the
     *  engine drain context (Phase 4c PR 6). */
    isLowestSpeedAlly?: boolean;
    /** The acting attacker's target was repaired this round. Default false. */
    targetRepairedThisRound?: boolean;
    /** True when the acting unit has a shield (shieldPool > 0). Default false. */
    selfShielded?: boolean;
    /** True when the acting unit was hit by a direct attack this round. Default false. */
    wasHitThisRound?: boolean;
    /** True when the acting unit took the round's first real turn. Default false. */
    firstActivator?: boolean;
    /** True when the acting unit is the sole living actor on its side. Default false. */
    lastStanding?: boolean;
    /** The condition owner's own-turn counter. Default 0 (DPS-assumption: inert for
     *  period>=2 conditions). Populated live by the engine drain context. */
    turnsTaken?: number;
    /** Sub-project I, PR I5 — count of living opposing actors currently holding the Stealth
     *  self-buff. Default 0 (DPS-assumption: no enemy attackers to count). Populated live by
     *  the combat engine. See ConditionContext.stealthedEnemyCount. */
    stealthedEnemyCount?: number;
    /** Sub-project I, PR I4a — the acting unit's own live crit power (effective critDamage),
     *  for Wildfire's "…for every 10% crit power" dotDamage scaling. Default 0 (no live crit
     *  power known to this caller — DPS-safe / inert for every ship besides Wildfire). Only
     *  runPlayerTurn's modifierCtx passes a real value. See ConditionContext.selfCritPower. */
    selfCritPower?: number;
    /** SP-C — target's crit power. Default 0 (no enemy crit-power config). */
    targetCritPower?: number;
    /** SP-C — owner Speed. Default 0. */
    selfSpeed?: number;
    /** SP-C — comparison target Speed (DPS: enemySpeed; engine: min damaged-enemy speed). Default 0. */
    targetSpeed?: number;
    /** SP-C — owner absolute current HP. Default 0 (DPS callers pass ship max HP). */
    selfCurrentHp?: number;
    /** SP-C — target absolute current HP (DPS: enemyHp). Default 0. */
    targetCurrentHp?: number;
    /** SP-D — number of enemies damaged by this cast. Default 1 (DPS single-target mode).
     *  Positional callers pass the real per-cast footprint size (0 is a real value — an
     *  empty/whiffed footprint — and is NOT re-defaulted here). See
     *  ConditionContext.enemiesHitThisCast. */
    enemiesHitThisCast?: number;
    /** SP-D — optional per-family DoT entry count lookup (Belladonna's named "3+ Acidic Decay"
     *  gate). Default undefined (no family tracking today — every family reads 0 via
     *  ConditionContext.enemyDotFamilyCounts' own fallback). See ConditionContext.enemyDotFamilyCounts. */
    enemyDotFamilyCounts?: Record<string, number>;
    /** SP-E — `genericDoTEntries.length` (Voron/Orel absolute-per-tick DoT). Default 0 (no
     *  generic DoT tracking today for any DPS caller — every existing ship reports 0). Folded
     *  into the bare `enemyDotCount` sum alongside corrosion/inferno/bomb. */
    genericCount?: number;
}): ConditionContext {
    return {
        selfBuffNames: state.selfBuffNames,
        enemyDebuffCount:
            state.landedEnemyDebuffCount +
            state.corrosionEntryCount +
            state.infernoEntryCount +
            state.bombCount,
        effectiveCritRate: state.effectiveCritRate,
        enemyType: state.enemyType,
        // DPS-assumption defaults (overridable for live-engine population)
        selfDebuffNames: state.selfDebuffNames ?? [],
        enemyBuffNames: state.enemyBuffNames ?? [],
        adjacentAllyCount: 0,
        enemyAdjacentCount: 0,
        enemyDestroyedCount: 0,
        selfHpPct: state.selfHpPct ?? 100,
        targetHpPct: state.targetHpPct ?? 100,
        enemyHpPct: state.enemyHpPct ?? 100,
        isLowestSpeedAlly: state.isLowestSpeedAlly ?? true,
        targetRepairedThisRound: state.targetRepairedThisRound ?? false,
        selfShielded: state.selfShielded ?? false,
        wasHitThisRound: state.wasHitThisRound ?? false,
        firstActivator: state.firstActivator ?? false,
        isLastStanding: state.lastStanding ?? false,
        turnsTaken: state.turnsTaken ?? 0,
        stealthedEnemyCount: state.stealthedEnemyCount ?? 0,
        selfCritPower: state.selfCritPower ?? 0,
        targetCritPower: state.targetCritPower ?? 0,
        selfSpeed: state.selfSpeed ?? 0,
        targetSpeed: state.targetSpeed ?? 0,
        selfCurrentHp: state.selfCurrentHp ?? 0,
        targetCurrentHp: state.targetCurrentHp ?? 0,
        enemiesHitThisCast: state.enemiesHitThisCast ?? 1,
        // SP-D — DoT-ONLY subtotal, derived from the SAME entry counts already folded into
        // enemyDebuffCount above. Deliberately excludes landedEnemyDebuffCount (control/marker
        // debuffs) — that is the whole DoT-ONLY point of this subject vs `enemy-debuff`.
        enemyDotCount:
            state.corrosionEntryCount +
            state.infernoEntryCount +
            state.bombCount +
            (state.genericCount ?? 0),
        ...(state.enemyDotFamilyCounts !== undefined
            ? { enemyDotFamilyCounts: state.enemyDotFamilyCounts }
            : {}),
        ...(state.roundCrit !== undefined ? { roundCrit: state.roundCrit } : {}),
        // Sentinel spread (sub-project I, PR I1): only set the key when the caller passed a
        // real array — an explicit `undefined` value would collapse to the same runtime
        // behaviour, but omitting the key entirely keeps this symmetric with roundCrit above
        // and avoids ever materializing an accidental `[]` default.
        ...(state.enemyDebuffNames !== undefined
            ? { enemyDebuffNames: state.enemyDebuffNames }
            : {}),
    };
}
