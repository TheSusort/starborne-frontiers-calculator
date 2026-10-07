import { EnemyBaseClass } from '../../types/calculator';
import { dotStackCount, type ActiveDoTStack, type DoTContainers } from '../combat/state';
import { ConditionContext } from './evaluateConditions';

/**
 * SP-E — sums live DoT stacks by their entry's `family` tag (Belladonna's named "Acidic Decay"
 * gate), each stack counting one (`dotStackCount`). Untagged entries — every DoT outside
 * Belladonna's Corrosion→Acidic-Decay conversion — contribute to no named family.
 */
export function dotFamilyCounts(
    corrosion: readonly ActiveDoTStack[],
    inferno: readonly ActiveDoTStack[],
    generic: readonly ActiveDoTStack[]
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of [...corrosion, ...inferno, ...generic]) {
        if (e.family) out[e.family] = (out[e.family] ?? 0) + dotStackCount([e]);
    }
    return out;
}

/** The DoT readings {@link buildRoundContext} takes, read off ONE unit's DoT containers — the
 *  unit whose debuffs the context's `enemy-debuff` / `enemy-dot-count` subjects ask about. Each DoT
 *  reading is a count of stacks (`dotStackCount`); `accumulatorCount` is one per Echoing Burst
 *  accumulator. */
export function dotReadings(holder: DoTContainers): {
    corrosionStacks: number;
    infernoStacks: number;
    bombStacks: number;
    genericStacks: number;
    accumulatorCount: number;
    enemyDotFamilyCounts: Record<string, number>;
} {
    const generic = holder.genericDoTEntries ?? [];
    return {
        corrosionStacks: dotStackCount(holder.corrosionEntries),
        infernoStacks: dotStackCount(holder.infernoEntries),
        bombStacks: dotStackCount(holder.pendingBombs),
        genericStacks: dotStackCount(generic),
        accumulatorCount: holder.pendingAccumulators?.length ?? 0,
        enemyDotFamilyCounts: dotFamilyCounts(
            holder.corrosionEntries,
            holder.infernoEntries,
            generic
        ),
    };
}

/**
 * Assemble a {@link ConditionContext} from per-round DPS-sim state.
 *
 * `enemyDebuffCount` adds the DoT stack counts and the Echoing Burst accumulators (see
 * `dotReadings`) to the landed named debuffs.
 * The remaining fields are DPS-assumption defaults: self HP is fixed at 100 (the sim
 * never takes damage); enemy HP is caller-derived (`enemyHpPct`, passed through as-is with
 * no default — SP-4d: absent means no enemy/victim reading exists this round);
 * no self-debuffs / enemy-buffs / adjacency.
 */
export function buildRoundContext(state: {
    selfBuffNames: string[];
    /** Buffs on self, one per stack — `ConditionContext.selfBuffCount`. Pass-through; absent stays
     *  absent. */
    selfBuffCount?: number;
    landedEnemyDebuffCount: number;
    /** Corrosion / Inferno / Bomb stacks on the unit asked about — `dotReadings`. */
    corrosionStacks: number;
    infernoStacks: number;
    bombStacks: number;
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
    /** Buffs on the cast's bound target, one per stack. Passed through with NO default — absent routes
     *  bare `enemy-buff` conditions to their manual/union fallback; see
     *  ConditionContext.enemyBuffCount. */
    enemyBuffCount?: number;
    /** Living opposing units carrying a debuff. Passed through with NO default — see
     *  ConditionContext.debuffedEnemyCount. */
    debuffedEnemyCount?: number;
    /** Sub-project I, PR I1 — NAMES on the opposing (primary) target, for name-specific
     *  `enemy-debuff` gates. SENTINEL: leave `undefined` (do NOT pass `[]`) to keep the legacy
     *  name-agnostic `enemyDebuffCount` path — this is the DPS-parity invariant (the DPS
     *  simulator never supplies this param). Only the live combat engine (real/positional
     *  target) opts in with a real (possibly empty) array. See ConditionContext.enemyDebuffNames. */
    enemyDebuffNames?: string[];
    /** Active debuff names on self. Default [] (DPS-assumption: no self-debuffs). */
    selfDebuffNames?: string[];
    /** Debuffs on self, DoT stacks included — `ConditionContext.selfDebuffCount`. Pass-through;
     *  absent stays absent. */
    selfDebuffCount?: number;
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
    /** Count of LIVING own-side actors holding a shield pool, the acting actor INCLUDED, for
     *  Zenith's "for each ally with a shield" scaling. The combat engine supplies a live count in
     *  EVERY mode (a DPS-mode focus holds a real pool, so a 0 there would under-report a real
     *  fight). Default 0 only for callers that model no shields at all. See
     *  ConditionContext.shieldedAllyCount. */
    shieldedAllyCount?: number;
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
    /** SP-D — optional per-family DoT stack count lookup (Belladonna's named "3+ Acidic Decay"
     *  gate; `dotFamilyCounts`). Absent → every family reads 0 via
     *  ConditionContext.enemyDotFamilyCounts' own fallback. */
    enemyDotFamilyCounts?: Record<string, number>;
    /** Generic (Voron/Orel absolute-per-tick) DoT stacks — `dotReadings`. Default 0. Folded into
     *  the bare `enemyDotCount` sum alongside corrosion/inferno. */
    genericStacks?: number;
    /** Echoing Burst accumulators on the unit asked about — `dotReadings`. Default 0. Each is one
     *  debuff in `enemyDebuffCount` (owner ruling R109); not a damage-over-time effect, so not in
     *  `enemyDotCount`. */
    accumulatorCount?: number;
    /** SP-F F4 — living same-team ally ship names for `ally-on-team` (team-sim only). SENTINEL:
     *  leave undefined (do NOT pass []) to keep the manual assume-met fallback (single-ship DPS).
     *  Only the live combat engine's drain context supplies a real array. */
    allyTeamNames?: string[];
    /** LIVE adjacency / kill counts (Panguan, Centurion, Judge). ABSENT is the sentinel: it means
     *  this caller has no board or opposing roster to count on, and the condition falls back to
     *  its manual `manualCount ?? 1` — the single-ship DPS behaviour, unchanged. Only the combat
     *  engine populates them, from data `buildTurnArgs` already threads for other consumers
     *  (`adjacentAllyIds`, `adjacentEnemyIdsFor`) plus the per-side `opposingRoster` kill tally.
     *  Passed through with NO `?? 0`: a fabricated 0 here would silently mean "measured, nothing
     *  adjacent", which is a different (and wrong) answer from "cannot measure". See
     *  ConditionContext's own doc on the three fields for the history. */
    /** Living same-side allies board-adjacent to the ACTING unit (the actor itself excluded). */
    adjacentAllyCount?: number;
    /** Living opposing actors board-adjacent to this cast's resolved TARGET (target excluded).
     *  Owner ruling 2026-08-30: living only — a destroyed neighbour adds nothing. */
    enemyAdjacentCount?: number;
    /** Opposing actors destroyed SO FAR THIS BATTLE, regardless of who landed the kill (owner
     *  ruling 2026-08-30). Cumulative across rounds — it never resets. */
    enemyDestroyedCount?: number;
    /** SP-4d — true when this round/reaction has NO opposing victim to ask a per-victim question
     *  about (e.g. an ally-targeted cast that resolves nobody). Default `false`/omitted preserves
     *  every existing caller's behaviour unchanged (a real victim, or the DPS-assumption default).
     *
     *  WHY THIS EXISTS: `enemyDebuffCount` and `enemyDotCount` below are SUMS of counts
     *  (`landedEnemyDebuffCount`, `corrosionStacks`, `infernoStacks`, `bombStacks`,
     *  `genericStacks`) that this function's callers compute unconditionally and that are
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
    // A Bomb is a debuff but not a damage-over-time effect (owner ruling R112): its stacks count
    // in `enemyDebuffCount`, never in `enemyDotCount`.
    const dotStacks = state.corrosionStacks + state.infernoStacks + (state.genericStacks ?? 0);
    return {
        selfBuffNames: state.selfBuffNames,
        ...(state.selfBuffCount !== undefined ? { selfBuffCount: state.selfBuffCount } : {}),
        // SP-4d: absent (not a fabricated 0) when this round has no opposing victim — see
        // `noOpposingVictim`'s doc above for why the sum alone can't distinguish the two.
        enemyDebuffCount: hasVictim
            ? state.landedEnemyDebuffCount +
              dotStacks +
              state.bombStacks +
              (state.accumulatorCount ?? 0)
            : undefined,
        effectiveCritRate: state.effectiveCritRate,
        enemyType: state.enemyType,
        // DPS-assumption defaults (overridable for live-engine population)
        selfDebuffNames: state.selfDebuffNames ?? [],
        ...(state.selfDebuffCount !== undefined ? { selfDebuffCount: state.selfDebuffCount } : {}),
        enemyBuffNames: state.enemyBuffNames ?? [],
        // Pass-through, NOT `?? 0` — see the fields' doc on the state interface above.
        adjacentAllyCount: state.adjacentAllyCount,
        enemyAdjacentCount: state.enemyAdjacentCount,
        enemyDestroyedCount: state.enemyDestroyedCount,
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
        shieldedAllyCount: state.shieldedAllyCount ?? 0,
        selfCritPower: state.selfCritPower ?? 0,
        selfSpeed: state.selfSpeed ?? 0,
        selfCurrentHp: state.selfCurrentHp ?? 0,
        // SP-D — DoT-ONLY subtotal, the SAME stacks already folded into enemyDebuffCount above
        // (Bombs and Echoing Burst excluded).
        // Deliberately excludes landedEnemyDebuffCount (control/marker debuffs) — that is the
        // whole DoT-ONLY point of this subject vs `enemy-debuff`.
        // SP-4d: absent (not a fabricated 0) when there is no opposing victim — same reasoning as
        // enemyDebuffCount above; see `noOpposingVictim`'s doc.
        enemyDotCount: hasVictim ? dotStacks : undefined,
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
        ...(state.enemyBuffCount !== undefined ? { enemyBuffCount: state.enemyBuffCount } : {}),
        ...(state.debuffedEnemyCount !== undefined
            ? { debuffedEnemyCount: state.debuffedEnemyCount }
            : {}),
    };
}
