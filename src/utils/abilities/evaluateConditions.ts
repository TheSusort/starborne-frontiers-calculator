import { Ability, Condition } from '../../types/abilities';
import { EnemyBaseClass } from '../../types/calculator';

export interface ConditionContext {
    selfBuffNames: string[];
    selfDebuffNames: string[];
    enemyBuffNames: string[];
    enemyDebuffCount: number;
    /** Sub-project I, PR I1 — NAMES on the opposing (primary) target, for `enemy-debuff`
     *  conditions that carry a `buffName` (e.g. Tygr's "to enemies with Stasis or Disable",
     *  Incinerator's "to enemies afflicted with Inferno"). OPTIONAL SENTINEL: `undefined` means
     *  the caller has NOT opted in — evaluateCondition falls back to the legacy name-agnostic
     *  `enemyDebuffCount`. An empty array IS a real "no debuffs present" signal (a name-gate
     *  correctly evaluates to 0), which is why callers that want the legacy count path must
     *  leave this key OUT entirely rather than pass `[]`. The DPS simulator (byte-identical
     *  requirement) never populates this; only the live combat engine (real/positional target)
     *  opts in. Control/marker debuff names come from `ownerDebuffNamesFor`; DoT names (Inferno/
     *  Corrosion/Bomb) are synthesized base-type names since DoTs are tracked as counted entry
     *  arrays with no names of their own (see roundContext.ts). */
    enemyDebuffNames?: string[];
    enemyType?: EnemyBaseClass;
    effectiveCritRate: number; // 0..100
    /** This round's binary crit outcome from the deterministic schedule. When set,
     *  'self-crit' evaluates 1/0; when undefined (e.g. modifierCtx — see the two-tier
     *  note in the spec), it falls back to effectiveCritRate/100 as a probability. */
    roundCrit?: boolean;
    adjacentAllyCount: number;
    enemyAdjacentCount: number;
    enemyDestroyedCount: number;
    selfHpPct: number; // 0..100
    /** SP-4d: OPTIONAL, and absent means "there is no enemy to ask about" — not "an enemy at full
     *  health". Absent on a no-victim turn (an ally-targeted cast resolves nobody) and at drain
     *  time (the fight-wide reading it used to carry described no actor on the board). Every arm
     *  that reads it returns `undefined` when it is absent; `conditionMet` rejects that before the
     *  comparator switch. Do NOT reintroduce a `?? 100` here or at any builder — that default is
     *  the phantom this rung deletes (spec §3.2: it was materialised in TWO layers). */
    enemyHpPct?: number; // 0..100
    targetHpPct?: number; // 0..100 — heal target's live HP%, threaded in healing mode only
    /** True when the condition owner has the lowest Speed among its (player) team
     *  (ties → all tied qualify). Optional; defaults to true via buildRoundContext (a lone
     *  actor — single-ship DPS, drain default — is trivially slowest). Populated live by the
     *  engine via buildDrainContext. */
    isLowestSpeedAlly?: boolean;
    /** True when the acting attacker's target was repaired (HP healed) earlier this
     *  round. Live-derived by the engine; defaults false (DPS / un-repaired). */
    targetRepairedThisRound?: boolean;
    /** True when the condition owner currently has a shield (shieldPool > 0). Live-derived
     *  by the engine; defaults false (no shield / DPS mode). Used by the Arcane Siege implant. */
    selfShielded?: boolean;
    /** True when the condition owner's shield pool is at or above its max HP. Live-derived by
     *  the engine; defaults false (DPS mode / no shield). Narrower than `selfShielded`. */
    selfShieldFull?: boolean;
    /** True when the condition owner's TARGET currently has a shield (the resolved victim's
     *  shieldPool > 0) — the target-side mirror of `selfShielded`. Live-derived by the engine;
     *  defaults false (DPS mode's dummy victim carries no shield pool). Used by Malvex's charged
     *  "If the target has a Shield, it gains Barrier for 1 hit". */
    enemyShielded?: boolean;
    /** True when the condition owner was hit by a direct attack this round (damage landed
     *  on shield or HP). Live-derived by the engine; defaults false (DPS / not-yet-hit). */
    wasHitThisRound?: boolean;
    /** D-PR14: this owner took the round's first real turn. Live-derived by the engine;
     *  defaults false. Used by the Doomsayer implant. */
    firstActivator?: boolean;
    /** D-PR16: this owner is the SOLE living actor on its own side. Live-derived by the engine
     *  each drain; defaults false. Infrastructure for the Last Stand implant. */
    isLastStanding?: boolean;
    /** The condition owner's own-turn counter (CombatActor.turnsTaken). Live-derived by
     *  the engine drain context; defaults 0 (DPS / no-delegate → period>=2 never met). */
    turnsTaken?: number;
    /** Sub-project I, PR I5 — count of living OPPOSING actors whose self-buff set includes
     *  'Stealth' (Selenite's "10% more direct damage for every enemy with Stealth" count-
     *  scaling). Distinct from `enemyBuffNames`, which is a DEDUPED UNION of buff names
     *  across every opposing actor — it can answer "does at least one enemy have Stealth"
     *  but can never distinguish 1 stealthed enemy from N. Live-derived by the combat
     *  engine (count of living opposing actors carrying Stealth); defaults to 0 elsewhere —
     *  the scaling contributes 0, byte-identical to today. The default is NOT justified by
     *  "DPS mode has no enemy attackers": a DPS run has carried a real enemy since SP-4b-2a,
     *  and since SP-4b-2b no caller can express a roster-less run (the normalization boundary
     *  throws). It is justified by CONTENT — no opposing actor holds Stealth. */
    stealthedEnemyCount?: number;
    /** Sub-project I, PR I4a — the ACTING unit's own live crit power (effective critDamage
     *  stat, e.g. 150), a continuous MAGNITUDE scaling source (distinct from every other
     *  scaling source above, which are entity COUNTS). Used by Wildfire's dotDamage-channel
     *  "…for every 10% crit power" bonus. Populated ONLY by runPlayerTurn's modifierCtx, from
     *  a PRE-modifier estimate (layers 1+2+3 of the critDamage fold — mirrors critBuffForGates'
     *  same pre-modifier-layer treatment of effectiveCritRate, avoiding a self-referential
     *  gate since this ctx also feeds the layer-4 modifier fold that could in principle alter
     *  critDamage itself). Defaults to 0 everywhere else (DPS-safe: no other ConditionContext
     *  builder populates it, so it's inert for every ship besides Wildfire). */
    selfCritPower?: number;
    /** SP-C — the acting unit's target's effective crit power. Default 0 (no enemy crit-power
     *  config in DPS → an owner with any crit power out-competes it). Live-derived in the engine. */
    targetCritPower?: number;
    /** SP-C — the acting unit's own Speed. Default 0. Live-derived (ship stat / real actor). */
    selfSpeed?: number;
    /** SP-C — comparison target Speed. DPS: configured enemySpeed. Positional: MIN Speed among
     *  damaged enemies (Chakara "all damaged enemies have more Speed"). Default 0. */
    targetSpeed?: number;
    /** SP-C — the acting unit's ABSOLUTE current HP (not %). Default 0. DPS: ship max HP
     *  (full-HP assumption). Live-derived in the engine. */
    selfCurrentHp?: number;
    /** SP-C — target's ABSOLUTE current HP (not %). Default 0. DPS: configured enemyHp. */
    targetCurrentHp?: number;
    /** SP-D — the number of enemies DAMAGED by THIS cast (Berserker/Tygr's "hitting N or more
     *  enemies" gates). Default 1 (DPS single-target mode — a ≥2/≥3 gate is inert, the faithful
     *  behaviour). Live-derived by the positional engine from the firing actor's footprint. */
    enemiesHitThisCast?: number;
    /** SP-D — per-target DoT-ONLY entry subtotal (corrosion + inferno + bomb entry-array
     *  lengths, +acidicDecay once SP-E adds it). Distinct from `enemyDebuffCount`, which also
     *  folds in landed CONTROL/marker debuffs — `enemy-dot-count` must never be satisfied by a
     *  non-DoT debuff (e.g. Stasis). Default 0 (DPS-safe / no DoTs). Derived by buildRoundContext
     *  from the SAME corrosionEntryCount/infernoEntryCount/bombCount already threaded through the
     *  funnel for `enemyDebuffCount` — no new engine seam required. */
    enemyDotCount?: number;
    /** SP-D — optional per-family DoT entry count lookup, for `enemy-dot-count` conditions that
     *  carry a `buffName` (Belladonna's "3+ Acidic Decay"). Absent/missing family → 0 (the
     *  Acidic Decay DoT family does not exist until SP-E introduces it, so Belladonna's gate is
     *  runtime-inert today by design, not a bug). */
    enemyDotFamilyCounts?: Record<string, number>;
    /** SP-F F4 — ship names of the acting unit's LIVING same-team allies (team-sim only; the
     *  drain context maps living same-side actor ids → ship names). Present ONLY when the sim
     *  supplies a roster (battle sim). Absent (single-ship DPS / any caller without a roster) →
     *  `ally-on-team` falls back to the manual assume-met path, byte-identical to before. */
    allyTeamNames?: string[];
    /** Ship-kit W8 Task 13 (Meiying) -- true when the enemy THIS on-enemy-destroyed reaction just
     *  killed carried at least one debuff at the moment it died. Live-derived by the engine from
     *  the victim's own per-target debuff store (eventCtx.victimId), computed only when a victim
     *  was actually resolved for this intent. Defaults false (DPS mode / no on-enemy-destroyed
     *  victim) -- inert for every other reactive trigger and every other on-enemy-destroyed
     *  ability (none of which carry this condition). */
    killedEnemyHadDebuff?: boolean;
}

/** Resolve one condition to a count (>= 0), or `undefined` when the condition's SUBJECT DOES NOT
 *  EXIST (SP-4d). `undefined` is not "zero" and not "unknown": it means the question cannot be
 *  asked, so `conditionMet` refuses it regardless of comparator and `scaledBonus` pays nothing. */
export function evaluateCondition(cond: Condition, ctx: ConditionContext): number | undefined {
    // SP-F F4: `ally-on-team` (Isha/Nayra's reciprocal Override gate) is a LIVE roster check when
    // the team-sim provides ally ship names; otherwise it falls back to the manual assume-met path
    // (single-ship DPS has no roster → a "if X is on the same team" gate is treated as met). Handled
    // ahead of the `derivable:false` early-return since the parser emits it as `derivable:false`.
    if (cond.subject === 'ally-on-team') {
        if (ctx.allyTeamNames)
            return cond.buffName && ctx.allyTeamNames.includes(cond.buffName) ? 1 : 0;
        return Math.max(0, cond.manualCount ?? 1);
    }
    if (!cond.derivable) return Math.max(0, cond.manualCount ?? 1);

    switch (cond.subject) {
        case 'always':
            return 1;
        case 'self-buff':
            return countNames(ctx.selfBuffNames, cond.buffName);
        case 'self-debuff':
            return countNames(ctx.selfDebuffNames, cond.buffName);
        case 'enemy-buff':
            return countNames(ctx.enemyBuffNames, cond.buffName);
        case 'enemy-debuff':
            // Sub-project I, PR I1: name-specific when the caller opts in (both a buffName
            // on the condition AND a populated enemyDebuffNames array are present) — counts
            // matches by name, e.g. Tygr's "to enemies with Stasis or Disable". Otherwise
            // (no buffName, OR the caller left enemyDebuffNames undefined — the DPS-parity
            // sentinel) falls back to the legacy name-agnostic count of ALL landed enemy
            // debuffs + DoTs. See the ConditionContext.enemyDebuffNames doc for the sentinel
            // rationale.
            if (cond.buffName && ctx.enemyDebuffNames)
                return countNames(ctx.enemyDebuffNames, cond.buffName);
            return ctx.enemyDebuffCount;
        case 'enemy-type': {
            if (!ctx.enemyType) return 0; // unknown type → cannot confirm either way
            const matches = ctx.enemyType === cond.requiredEnemyType;
            return (cond.negate ? !matches : matches) ? 1 : 0;
        }
        case 'self-crit':
            // Binary when the round's deterministic crit outcome is known; otherwise
            // the legacy probability (0..1) used as gate (>0) and expected-value scaler.
            if (ctx.roundCrit !== undefined) return ctx.roundCrit ? 1 : 0;
            return ctx.effectiveCritRate / 100;
        case 'adjacent-ally':
            return ctx.adjacentAllyCount;
        case 'enemy-adjacent':
            return ctx.enemyAdjacentCount;
        case 'enemy-destroyed':
            return ctx.enemyDestroyedCount;
        case 'enemy-stealth-count':
            return ctx.stealthedEnemyCount ?? 0;
        case 'self-crit-power':
            return ctx.selfCritPower ?? 0;
        // SP-4d: was `?? 1` — a cast that resolved no victim booked a footprint of ONE. Absent now
        // means no footprint was recorded, which does not resolve. Tygr's `gte 2` and Berserker's
        // `gte 3` are unaffected either way; an `lte`/`eq 0` reader is the case this closes.
        case 'enemies-hit-this-cast':
            return ctx.enemiesHitThisCast;
        case 'enemy-dot-count':
            if (cond.buffName) return ctx.enemyDotFamilyCounts?.[cond.buffName] ?? 0;
            return ctx.enemyDotCount ?? 0;
        case 'killed-enemy-had-debuff':
            return ctx.killedEnemyHadDebuff ? 1 : 0;
        case 'stat-vs-target': {
            // The OWNER always exists, so an absent self reading is a caller omission (0), not a
            // missing subject. The TARGET is the subject: absent means nobody to compare against,
            // and a `gt` comparator against a fabricated 0 was TRUE against nobody (spec §2).
            const self =
                cond.compareStat === 'crit-power'
                    ? (ctx.selfCritPower ?? 0)
                    : cond.compareStat === 'speed'
                      ? (ctx.selfSpeed ?? 0)
                      : (ctx.selfCurrentHp ?? 0);
            const target =
                cond.compareStat === 'crit-power'
                    ? ctx.targetCritPower
                    : cond.compareStat === 'speed'
                      ? ctx.targetSpeed
                      : ctx.targetCurrentHp;
            if (target === undefined) return undefined;
            return (cond.statComparator === 'lt' ? self < target : self > target) ? 1 : 0;
        }
        case 'hp-threshold': {
            const met = evalHpThreshold(cond, ctx);
            return met === undefined ? undefined : met ? 1 : 0;
        }
        // HP-percentage counts: the enemy's current/missing HP% (0..100). Used as SCALING sources
        // for HP-proportional modifiers (Akula/Tithonus) — perUnit is "per HP point". As a bare
        // gate they pass while the enemy lives. SP-4d: with no enemy neither question resolves —
        // and note the missing-HP arm must NOT compute `100 - 0`, which would pay the FULL bonus.
        case 'enemy-hp-pct':
            return ctx.enemyHpPct;
        case 'enemy-hp-missing-pct':
            return ctx.enemyHpPct === undefined ? undefined : 100 - ctx.enemyHpPct;
        case 'self-hp-missing-pct':
            return 100 - ctx.selfHpPct;
        case 'lowest-speed-ally':
            return ctx.isLowestSpeedAlly ? 1 : 0;
        case 'target-repaired-this-round':
            return ctx.targetRepairedThisRound ? 1 : 0;
        case 'self-shield':
            return ctx.selfShielded ? 1 : 0;
        case 'self-shield-full':
            return ctx.selfShieldFull ? 1 : 0;
        case 'enemy-shield':
            return ctx.enemyShielded ? 1 : 0;
        case 'not-hit-this-round':
            return ctx.wasHitThisRound ? 0 : 1;
        case 'first-activator':
            return ctx.firstActivator ? 1 : 0;
        case 'last-standing':
            return ctx.isLastStanding ? 1 : 0;
        case 'every-n-turns': {
            const period = cond.period ?? 1;
            const offset = cond.offset ?? 0;
            const t = ctx.turnsTaken ?? 0;
            // Require period >= 1, a residue within [0, period-1], and at least one turn taken.
            // An out-of-range offset (>= period, or negative — JS signed modulo never yields it)
            // can never match, so reject it explicitly rather than evaluating to silent-never.
            if (period <= 0 || offset < 0 || offset >= period || t <= 0) return 0;
            return t % period === offset ? 1 : 0;
        }
        default:
            return 0;
    }
}

function countNames(names: string[], filter?: string): number {
    if (!filter) return names.length;
    return names.filter((n) => n === filter).length;
}

// HP-threshold basis: enemy HP by default (offensive scaling), self HP when hpSubject is
// 'self' (e.g. "if at full HP"), or the heal target's live HP when hpSubject is 'target'
// (reactive crossing gates — healing mode only; absent targetHpPct defaults to 100 so the
// condition is inert under DPS assumptions). Under DPS assumptions all three are 100.
function evalHpThreshold(cond: Condition, ctx: ConditionContext): boolean | undefined {
    const hp =
        cond.hpSubject === 'self'
            ? ctx.selfHpPct
            : cond.hpSubject === 'target'
              ? (ctx.targetHpPct ?? 100)
              : ctx.enemyHpPct;
    // SP-4d: only the enemy/default subject can be absent — `selfHpPct` is required and the heal
    // target's reading keeps its documented 100 default (healing-mode inertness, not a phantom).
    // The guard matters because without it `hp > t` / `hp < t` against `undefined` is just
    // `false`, so this arm would answer `0` for "there is no enemy" — indistinguishable from "the
    // enemy is at 0%", and satisfiable by an `eq 0` or `lte N` gate that should fire against
    // nobody. Pinned by absentSubject.test.ts's "negation idiom (eq 0) is not satisfied by an
    // absent enemy either" and its hp-threshold comparator-proof (lte) case.
    if (hp === undefined) return undefined;
    const t = cond.hpPercent ?? 0;
    return cond.hpComparator === 'above' ? hp > t : hp < t;
}

/**
 * Whether a single condition is satisfied (as a gate). With a `countComparator`,
 * the derived/manual count is compared against `countThreshold` (e.g. ≥3 debuffs,
 * exactly 0 debuffs); otherwise the default presence rule (count > 0) applies.
 */
export function conditionMet(cond: Condition, ctx: ConditionContext): boolean {
    const count = evaluateCondition(cond, ctx);
    if (cond.countComparator != null && cond.countThreshold != null) {
        // `count!`: the guard below has not run yet, so TS sees `number | undefined` here — the
        // assertion only satisfies the type checker, it does not change the runtime value. That
        // is deliberate: every relational/equality comparator already returns false against a
        // real `undefined` (`undefined >= 2`, `undefined <= 1`, `undefined === 0` are all false
        // in JS), so this switch is correct even when `count` is actually absent.
        switch (cond.countComparator) {
            case 'gte':
                return count! >= cond.countThreshold;
            case 'lte':
                return count! <= cond.countThreshold;
            case 'eq':
                return count! === cond.countThreshold;
        }
    }
    // SP-4d: an absent subject must be represented as `undefined`, never `0` — that
    // representation, not this guard's position, is what closes the phantom. This line is
    // explicit-over-implicit (it states the intent at the one place a count becomes a boolean)
    // but it is NOT load-bearing: deleting it is behaviour-neutral, because `undefined > 0` is
    // already false and every comparator above is already false against `undefined` too — a
    // mutation test cannot pin this ordering, and none should claim to. What must be pinned is
    // each arm (`hp-threshold`, `stat-vs-target`, `enemies-hit-this-cast`) returning `undefined`
    // rather than `0` for an absent subject: a `0` would satisfy an `eq 0` or `lte N` gate that
    // `undefined` never does. See absentSubject.test.ts's comparator-proof cases.
    if (count === undefined) return false;
    return count > 0;
}

/** AND across OR-groups. Consecutive `anyOf` conditions form one OR-group. Empty → true. */
export function conditionsMet(conditions: Condition[], ctx: ConditionContext): boolean {
    if (conditions.length === 0) return true;
    const groups = groupConditions(conditions);
    return groups.every((group) => group.some((c) => conditionMet(c, ctx)));
}

/** Group runs of `anyOf` together; non-anyOf conditions are their own singleton groups. */
function groupConditions(conditions: Condition[]): Condition[][] {
    const groups: Condition[][] = [];
    let run: Condition[] = [];
    for (const c of conditions) {
        if (c.anyOf) {
            run.push(c);
        } else {
            if (run.length) {
                groups.push(run);
                run = [];
            }
            groups.push([c]);
        }
    }
    if (run.length) groups.push(run);
    return groups;
}

/**
 * Indices of the consecutive `anyOf` OR-group containing `idx`. A non-anyOf condition is its
 * own singleton group → returns just [idx]. Mirrors groupConditions' consecutive-run grouping.
 * Lets a scaling source that is ONE member of an OR-group (Rikra's "against Taunted OR Provoked
 * enemies") scale/gate as the WHOLE group, not just its first member. Inert for the
 * single-condition scaling every existing parser-emitted / editor-built ability uses.
 */
export function anyOfGroupIndices(conditions: Condition[], idx: number): number[] {
    const c = conditions[idx];
    if (!c || !c.anyOf) return [idx];
    let lo = idx;
    while (lo > 0 && conditions[lo - 1]?.anyOf) lo--;
    let hi = idx;
    while (hi < conditions.length - 1 && conditions[hi + 1]?.anyOf) hi++;
    const out: number[] = [];
    for (let i = lo; i <= hi; i++) out.push(i);
    return out;
}

/** Per-count scaling bonus for an ability, capped. 0 if no scaling rule. */
export function scaledBonus(ability: Ability, ctx: ConditionContext): number {
    if (!ability.scaling) return 0;
    const idx = ability.scaling.conditionIndex;
    // Reactive event-count scaling (ship-kit W3 `countSource`) references no live-state
    // Condition — it is applied by the reactive heal/shield executor, not this additive
    // count-scaling path — so it contributes no DPS/damage bonus here.
    if (idx == null || !ability.conditions[idx]) return 0;
    // Sum across the scaling source's anyOf OR-group so a binary "X or Y" bonus (Rikra's
    // Taunted/Provoked) fires on either; a lone condition is a singleton group → unchanged.
    const count = anyOfGroupIndices(ability.conditions, idx).reduce(
        // SP-4d: an absent subject contributes 0 rather than its fabricated reading. Measured
        // inert on the shipped corpus (spec §6: Akula and Tithonus are the only readers, both are
        // attackers, and every evaluation in the suite carries a live per-victim value).
        (sum, i) => sum + (evaluateCondition(ability.conditions[i], ctx) ?? 0),
        0
    );
    const bonus = count * ability.scaling.perUnit;
    return ability.scaling.cap != null ? Math.min(bonus, ability.scaling.cap) : bonus;
}
