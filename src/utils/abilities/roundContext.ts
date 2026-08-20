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
 * never takes damage); enemy HP is caller-derived (`enemyHpPct`, passed through as-is with
 * no default — SP-4d: absent means no enemy/victim reading exists this round);
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
    /** Derived enemy HP% (0..100): 100 × max(0, 1 − cumulativeDamage/enemyHp). Passed through
     *  as-is; absent means no enemy/victim reading exists this round (no phantom is invented). */
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
    /** True when the acting unit's shield pool is at or above its max HP. Default false.
     *  Narrower than `selfShielded`. Used by Quixilver's R2 passive gate. */
    selfShieldFull?: boolean;
    /** True when the acting unit's resolved TARGET has a shield (victim shieldPool > 0). Default
     *  false (DPS-assumption: the dummy victim carries no shield pool). Used by Malvex's charged
     *  Barrier gate. */
    enemyShielded?: boolean;
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
     *  self-buff. Default 0 for callers that do not populate it; the combat engine supplies a
     *  live count. NOT because "DPS mode has no enemy attackers" — that premise died with
     *  SP-4b-2a (every DPS run carries a real enemy) and is unrepresentable after SP-4b-2b
     *  (the normalization boundary throws on an empty roster). The 0 is about CONTENT: no
     *  opposing actor carries Stealth. See ConditionContext.stealthedEnemyCount. */
    stealthedEnemyCount?: number;
    /** Sub-project I, PR I4a — the acting unit's own live crit power (effective critDamage),
     *  for Wildfire's "…for every 10% crit power" dotDamage scaling. Default 0 (no live crit
     *  power known to this caller — DPS-safe / inert for every ship besides Wildfire). Only
     *  runPlayerTurn's modifierCtx passes a real value. See ConditionContext.selfCritPower. */
    selfCritPower?: number;
    /** SP-C — target's crit power. Passed through as-is; absent means no target reading exists
     *  this round (no phantom is invented). */
    targetCritPower?: number;
    /** SP-C — owner Speed. Default 0. */
    selfSpeed?: number;
    /** SP-C — comparison target Speed (DPS: enemySpeed; engine: min damaged-enemy speed). Passed
     *  through as-is; absent means no target reading exists this round (no phantom is invented). */
    targetSpeed?: number;
    /** SP-C — owner absolute current HP. Default 0 (DPS callers pass ship max HP). */
    selfCurrentHp?: number;
    /** SP-C — target absolute current HP (DPS: enemyHp). Passed through as-is; absent means no
     *  target reading exists this round (no phantom is invented). */
    targetCurrentHp?: number;
    /** SP-D — number of enemies damaged by this cast. Passed through as-is; absent means no
     *  cast/victim reading exists this round (no phantom is invented). Positional callers pass
     *  the real per-cast footprint size (0 is a real value — an empty/whiffed footprint — and is
     *  NOT re-defaulted here). See ConditionContext.enemiesHitThisCast. */
    enemiesHitThisCast?: number;
    /** SP-D — optional per-family DoT entry count lookup (Belladonna's named "3+ Acidic Decay"
     *  gate). Default undefined (no family tracking today — every family reads 0 via
     *  ConditionContext.enemyDotFamilyCounts' own fallback). See ConditionContext.enemyDotFamilyCounts. */
    enemyDotFamilyCounts?: Record<string, number>;
    /** SP-E — `genericDoTEntries.length` (Voron/Orel absolute-per-tick DoT). Default 0 (no
     *  generic DoT tracking today for any DPS caller — every existing ship reports 0). Folded
     *  into the bare `enemyDotCount` sum alongside corrosion/inferno/bomb. */
    genericCount?: number;
    /** SP-F F4 — living same-team ally ship names for `ally-on-team` (team-sim only). SENTINEL:
     *  leave undefined (do NOT pass []) to keep the manual assume-met fallback (single-ship DPS).
     *  Only the live combat engine's drain context supplies a real array. */
    allyTeamNames?: string[];
    /** SP-4d — true when this round/reaction has NO opposing victim to ask a per-victim question
     *  about (e.g. an ally-targeted cast that resolves nobody). Default `false`/omitted preserves
     *  every existing caller's behaviour unchanged (a real victim, or the DPS-assumption default).
     *
     *  WHY THIS EXISTS: `enemyDebuffCount` and `enemyDotCount` below are SUMS of entry-array
     *  lengths (`landedEnemyDebuffCount`, `corrosionEntryCount`, `infernoEntryCount`, `bombCount`,
     *  `genericCount`) that this function's callers compute unconditionally and that are
     *  themselves required numbers — they read exactly `0` both when there is no opposing victim
     *  AND when there is a real victim carrying no debuffs/DoTs. Those two situations must answer
     *  differently (unresolvable vs. a real `0`), and no arithmetic on the counts alone can tell
     *  them apart — only the caller, which alone knows whether it resolved a victim this round,
     *  can say so. This flag is that explicit signal.
     *
     *  EFFECT: when `true`, `enemyDebuffCount`, `enemyDotCount`, and `enemyShielded` are all left
     *  absent on the returned context regardless of what the constituent counts/`state.enemyShielded`
     *  say — see each field's own assignment below. Every OTHER field on this context is
     *  unaffected; side-wide subjects (`enemy-buff`, `enemy-destroyed`, `enemy-adjacent`,
     *  `enemy-stealth-count`, `enemy-type`) do not read through this flag at all and keep
     *  answering, because a real opposing roster is always guaranteed to exist even on a turn
     *  that resolves no single victim. */
    noOpposingVictim?: boolean;
}): ConditionContext {
    const hasVictim = !state.noOpposingVictim;
    return {
        selfBuffNames: state.selfBuffNames,
        // SP-4d: absent (not a fabricated 0) when this round has no opposing victim — see
        // `noOpposingVictim`'s doc above for why the sum alone can't distinguish the two.
        enemyDebuffCount: hasVictim
            ? state.landedEnemyDebuffCount +
              state.corrosionEntryCount +
              state.infernoEntryCount +
              state.bombCount +
              // SP-E (Task E3 forward-note): now that generic DoTs become live (Voron/Orel
              // transform), fold genericCount in here too — closes the DoT-vs-debuff asymmetry
              // vs enemyDotCount below, which already includes it (E2). Inert (0) for every
              // existing ship without a live generic DoT.
              (state.genericCount ?? 0)
            : undefined,
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
        isLowestSpeedAlly: state.isLowestSpeedAlly ?? true,
        targetRepairedThisRound: state.targetRepairedThisRound ?? false,
        selfShielded: state.selfShielded ?? false,
        selfShieldFull: state.selfShieldFull ?? false,
        // SP-4d: absent when there is no opposing victim (see `noOpposingVictim`'s doc) — a
        // no-victim turn must not read as "the enemy has no shield" (a real, satisfiable `false`),
        // it must read as "there is no enemy to ask about" (unresolvable). With a victim, keeps
        // the pre-existing default-false behaviour untouched.
        enemyShielded: hasVictim ? (state.enemyShielded ?? false) : undefined,
        wasHitThisRound: state.wasHitThisRound ?? false,
        firstActivator: state.firstActivator ?? false,
        isLastStanding: state.lastStanding ?? false,
        turnsTaken: state.turnsTaken ?? 0,
        stealthedEnemyCount: state.stealthedEnemyCount ?? 0,
        selfCritPower: state.selfCritPower ?? 0,
        selfSpeed: state.selfSpeed ?? 0,
        selfCurrentHp: state.selfCurrentHp ?? 0,
        // SP-D — DoT-ONLY subtotal, derived from the SAME entry counts already folded into
        // enemyDebuffCount above. Deliberately excludes landedEnemyDebuffCount (control/marker
        // debuffs) — that is the whole DoT-ONLY point of this subject vs `enemy-debuff`.
        // SP-4d: absent (not a fabricated 0) when there is no opposing victim — same reasoning as
        // enemyDebuffCount above; see `noOpposingVictim`'s doc.
        enemyDotCount: hasVictim
            ? state.corrosionEntryCount +
              state.infernoEntryCount +
              state.bombCount +
              (state.genericCount ?? 0)
            : undefined,
        // SP-4d: these five are NOT defaulted. An absent reading means the subject does not exist
        // (no victim resolved this turn), and evaluateConditions answers that honestly; inventing
        // `100` / `0` / `1` here is exactly the phantom the rung deletes, and it hid itself by
        // sitting one layer ABOVE the `??` in evaluateConditions. The conditional-spread idiom is
        // load-bearing: writing the key with an `undefined` value would also work at runtime, but
        // it makes `'enemyHpPct' in ctx` lie, which the sentinel-vs-legacy `enemyDebuffNames`
        // distinction in this same context type depends on.
        ...(state.enemyHpPct !== undefined ? { enemyHpPct: state.enemyHpPct } : {}),
        ...(state.targetCritPower !== undefined ? { targetCritPower: state.targetCritPower } : {}),
        ...(state.targetSpeed !== undefined ? { targetSpeed: state.targetSpeed } : {}),
        ...(state.targetCurrentHp !== undefined ? { targetCurrentHp: state.targetCurrentHp } : {}),
        ...(state.enemiesHitThisCast !== undefined
            ? { enemiesHitThisCast: state.enemiesHitThisCast }
            : {}),
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
        // SP-F F4 — sentinel spread (mirrors enemyDebuffNames): set the key only when the caller
        // supplied a real roster array, so absence keeps `ally-on-team`'s assume-met fallback.
        ...(state.allyTeamNames !== undefined ? { allyTeamNames: state.allyTeamNames } : {}),
    };
}
