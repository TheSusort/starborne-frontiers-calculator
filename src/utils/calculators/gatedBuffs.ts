/**
 * Which auto-filled kit buffs are CONDITIONALLY GATED, read off the already-built abilities.
 *
 * Deliberately NOT a second parse. Gates reach an Ability through at least three separate paths —
 * `detectGrantConditions` (buildShipAbilities.ts:3299), `crossing()`/`detectHpCrossingTrigger`
 * (:3136, the path Redeemer's below-60% gate actually takes), and `targetGate()` — so re-running any
 * one detector would miss the others and would rot as paths are added. Reading `conditions` off the
 * built object inherits every path, present and future.
 *
 * Verified: on the buff-merge path, a non-empty `conditions` really does mean "gated".
 * `detectGrantConditions` returns [] for unconditional clauses ("Only conditional clauses produce
 * conditions") and never emits `always`; `crossing()` emits only `hp-threshold`. The `always` filter
 * below is belt-and-braces, and the count-scaling subjects (`enemy-hp-pct`,
 * `enemy-hp-missing-pct`) live on the statModifiers path, not this one.
 */
import type { SelectedGameBuff } from '../../types/calculator';
import type { Ability, Condition, ShipSkills } from '../../types/abilities';
import { conditionSummary } from '../abilities/conditionSummary';
import { conditionsMet, type ConditionContext } from '../abilities/evaluateConditions';

export interface GatedBuff {
    buffId: string;
    buffName: string;
    /** e.g. "below 60% HP" — from conditionSummary. */
    reason: string;
}

/**
 * The page state Theoretical EHP's gate evaluation is answerable from. Deliberately narrow: only
 * the fields three condition SUBJECTS need (see `isAnswerableCondition`), not a general-purpose
 * combat context. Every other subject (self-crit, enemy-type, adjacent-ally, ally-on-team, …)
 * stays unanswerable regardless of what this carries — see `isAnswerableCondition`'s doc for why
 * that gate is enforced BEFORE the engine's evaluator ever sees a condition, not by leaving a
 * field blank and hoping the evaluator degrades safely.
 */
export interface GatedBuffsPageState {
    /** The ship being measured's own Speed. Feeds `lowest-speed-ally` (Chakara): this ship is
     *  the OWNER of the gate, so its own Speed is one of the values the "lowest among allies"
     *  comparison is taken over — an empty `allySpeeds` still resolves (trivially the sole, and
     *  therefore lowest, actor), matching the engine's own `lowestSpeedIds()` semantics
     *  (computed over ALL same-side actors, owner included — see `engine.ts`'s `bySide('player')`
     *  wiring, which folds the acting attacker into the same `actors` array it takes the min
     *  over). Sourced from `DefenseShipConfig.speed`. */
    selfSpeed: number;
    /** Speeds of the ships in the page's ally roster (`teamShips`), EXCLUDING the measured ship
     *  itself. An empty array is the page's own default state (no team ships added) and is not a
     *  missing-data case — it is a real, answerable roster of zero. Sourced from
     *  `TeamShipConfig.speed`, which is a required (non-optional) field auto-filled on ship pick,
     *  so every entry here is a real number, never a fabricated stand-in. */
    allySpeeds: number[];
    /** True when at least one enemy is configured (`enemies.length > 0`). Feeds `enemy-debuff`
     *  (Asphyxiator/Bayah's "while the enemy has N+ debuffs"). With no enemy configured, "the
     *  enemy's debuff count" has no referent — not a knowable zero, not a knowable N — so this
     *  is threaded to leave `enemyDebuffCount`/`enemyDebuffNames` UNDEFINED in the built
     *  `ConditionContext` rather than fabricating either extreme. `conditionMet` already treats
     *  an undefined count as NOT MET (never as an assumed match), so an absent enemy correctly
     *  keeps the gate dropped — the same conservative outcome as before this ruling, not a new
     *  one. */
    hasEnemy: boolean;
    /** Distinct debuff names the page's ally roster is configured to inflict on the enemy
     *  (`TeamShipConfig.enemyDebuffs[].buffName`, deduped). Deduped, not counted per applying
     *  ship, because the engine's own status model is name-keyed: a debuff NAME is one active
     *  status (highest tier wins), not one entry per ship that lands it — two team ships both
     *  configured to inflict "Attack Down" put exactly one "Attack Down" on the enemy, not two.
     *  Only consulted when `hasEnemy` is true. */
    enemyDebuffNames: string[];
}

/** Builds the `ConditionContext` this page can honestly answer from `GatedBuffsPageState`.
 *  Every field NOT documented above (crit rate, buffs/debuffs by name, adjacency, shields, …)
 *  is left at an inert default (0 / [] / false) — safe ONLY because `isAnswerableCondition`
 *  refuses every condition whose subject would read one of those fields before this context is
 *  ever handed to `conditionsMet`. This function does not enforce answerability; the filter in
 *  `gatedAutoFilledBuffs` does, and must run first. */
function buildPageConditionContext(state: GatedBuffsPageState): ConditionContext {
    const allSpeeds = [state.selfSpeed, ...state.allySpeeds];
    const lowestSpeed = Math.min(...allSpeeds);
    return {
        selfBuffNames: [],
        selfDebuffNames: [],
        enemyBuffNames: [],
        effectiveCritRate: 0,
        adjacentAllyCount: 0,
        enemyAdjacentCount: 0,
        enemyDestroyedCount: 0,
        // Theoretical EHP is resolved once for a ship at full health — not a live per-round
        // reading. Ties → all tied qualify, matching `lowestSpeedIds()`.
        selfHpPct: 100,
        isLowestSpeedAlly: state.selfSpeed <= lowestSpeed,
        enemyDebuffCount: state.hasEnemy ? state.enemyDebuffNames.length : undefined,
        enemyDebuffNames: state.hasEnemy ? state.enemyDebuffNames : undefined,
    };
}

/**
 * Whether the page can genuinely answer this SINGLE condition — the answerability allow-list.
 * Deliberately small: admitting a subject here means `buildPageConditionContext` populates a
 * REAL (not fabricated) reading for it. Every OTHER subject is refused here and therefore never
 * reaches `conditionsMet` — closing off the assume-met fallback in `evaluateCondition`
 * (`if (!cond.derivable) return Math.max(0, cond.manualCount ?? 1)`, and the `ally-on-team`
 * no-roster branch) that would otherwise make an unknowable gate silently COUNT. This check runs
 * on every condition in a grant path BEFORE `conditionsMet` sees any of them — a path with one
 * answerable and one unanswerable condition (an AND) is treated as wholly unanswerable, not
 * partially evaluated, per the ruling's "better to drop a gate you could theoretically answer
 * than to count one you cannot".
 *
 * NOT closed off for an ADMITTED subject carrying `derivable: false`: this switch keys only on
 * `cond.subject`, never on `cond.derivable`, so a hand-authored 'hp-threshold' (self)/
 * 'lowest-speed-ally'/'enemy-debuff' condition with `derivable: false` still passes this gate and
 * reaches `conditionsMet`, which lands it in `evaluateCondition`'s assume-met early return. That
 * IS reachable in the live app — the ability editor is also a producer of `Condition`s, not just
 * the skill-text parser: `ConditionRow.tsx`'s "Set manually (assume active)" checkbox sets
 * `derivable: false` (+ `manualCount`), and it renders on this very card (`DefenseShipCard.tsx`
 * -> `SkillSlotList` -> `AbilityCard` -> `ConditionRow`), wired back through `onShipSkillsChange`.
 * A `derivable: false` condition on an admitted subject is therefore treated as its AUTHORED
 * assumption, not a computed reading — deliberately; hardening it is a separate open ruling, not
 * something this comment should misstate as already closed.
 */
function isAnswerableCondition(cond: Condition): boolean {
    switch (cond.subject) {
        // hp-threshold with hpSubject 'self' is the Redeemer case: evaluated against the fixed
        // full-health assumption (`buildPageConditionContext`'s `selfHpPct: 100`). 'enemy' and
        // 'target' hpSubjects read fields (`enemyHpPct`, `targetHpPct`) this page has no
        // configured value for — those stay unanswerable.
        case 'hp-threshold':
            return cond.hpSubject === 'self';
        case 'lowest-speed-ally':
        case 'enemy-debuff':
            return true;
        default:
            return false;
    }
}

/** Theoretical-EHP-relevant: the buff's own `parsedEffects` carries a key Theoretical EHP
 *  actually reads (`computeBuffedStats`'s inputs — defense, incomingDamage, security). A buff
 *  that only moves e.g. `attack`/`critDamage`/`outgoingDamage` was never counted in that figure
 *  in the first place, so naming it under "Not counted (conditional)" beside Theoretical EHP
 *  falsely implies it WAS deducted from that number. Single source of truth shared by the
 *  disclosure render (DefenseShipCard) and the corpus audit (`scripts/auditGatedBuffs.ts`) so the
 *  two can't drift. */
export function isEhpRelevant(buff: SelectedGameBuff): boolean {
    return (
        'defense' in buff.parsedEffects ||
        'incomingDamage' in buff.parsedEffects ||
        'security' in buff.parsedEffects
    );
}

/** `always` is not a gate. Belt-and-braces: verified that neither `detectGrantConditions` nor
 *  `crossing()` emits it on the buff-merge path. */
const realGates = (conditions: Condition[] | undefined): Condition[] =>
    (conditions ?? []).filter((c) => c.subject !== 'always');

/** Groups consecutive `anyOf` conditions into OR-runs; a non-`anyOf` condition starts its own
 *  singleton run. Mirrors `evaluateConditions.ts`'s (unexported) `groupConditions` — duplicated
 *  here as a tiny pure helper rather than exporting that one for a single caller. Needed so the
 *  printed reason can join OR-alternatives with " or " instead of the AND-implying ", " —
 *  Panon's "If this Unit is Provoked or Taunted" is TWO conditions with `anyOf` linking them,
 *  and joining them with ", " prints "while Taunt is active, while affected by Provoke", which
 *  reads as a strictly stronger AND than the game's actual OR gate. */
const groupByAnyOf = (conditions: Condition[]): Condition[][] => {
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
};

/** One grant path's full reason phrase: OR-runs join with " or ", separate runs (an AND of
 *  distinct gates) join with ", ". A single-condition ability collapses to plain `conditionSummary`
 *  output, unchanged from before this fix. */
const reasonForConditions = (conditions: Condition[]): string =>
    groupByAnyOf(conditions)
        .map((group) => group.map(conditionSummary).join(' or '))
        .join(', ');

// Exported so the corpus reachability self-check (scripts/auditGatedBuffs.ts) can match buffs to
// their grant abilities the SAME way this predicate does, rather than re-deriving its own (and
// silently drifting from what "a grant for this buff" actually means).
export const isBuffGrantFor = (ability: Ability, buffName: string): boolean =>
    ability.config.type === 'buff' && ability.config.buffName === buffName;

export function gatedAutoFilledBuffs(
    buffs: SelectedGameBuff[],
    shipSkills: ShipSkills | undefined,
    pageState: GatedBuffsPageState
): GatedBuff[] {
    if (!shipSkills) return [];
    const result: GatedBuff[] = [];
    const ctx = buildPageConditionContext(pageState);

    for (const buff of buffs) {
        // A buff the user picked by hand is deliberate and always counts, gate or no gate.
        if (!buff.autoFilled) continue;
        if (!buff.skillSource) continue;

        // Searched across EVERY slot, not just the one `skillSource` nominally maps to: the same
        // buff NAME can be granted from more than one slot (e.g. Panon's Barrier — gated behind a
        // Taunt/Provoke check from the charge slot, unconditional from the passive slot), and a
        // gate on one grant path is meaningless if another path on the SAME ship hands out the
        // identical buff for free. The every-match rule below only holds if it sees every path.
        const matches = shipSkills.slots
            .flatMap((s) => s.abilities)
            .filter((a) => isBuffGrantFor(a, buff.buffName));

        if (!matches.length) continue;

        // Per grant path: unconditional, or gated-but-genuinely-satisfied paths make the buff
        // stand; a path is "genuinely satisfied" only when EVERY REAL condition on it is
        // answerable (isAnswerableCondition) AND the engine's own `conditionsMet` says the FULL,
        // UNFILTERED condition list is met. A path with any unanswerable condition never reaches
        // `conditionsMet` at all — see `isAnswerableCondition`'s doc for why that ordering is
        // load-bearing.
        //
        // `conditionsMet` is deliberately called with `a.conditions` (unfiltered), not `gates`
        // (the `always`-stripped list): `conditionsMet` groups conditions into AND-ed OR-runs by
        // CONSECUTIVE `anyOf`, so stripping a middle `always` before grouping can merge two
        // separate OR-groups into one — turning `A AND always AND B` (an AND) into `A OR B` once
        // `always` is gone from between them. `always` itself always evaluates to 1 (met), so
        // handing the engine the unfiltered list is equivalent everywhere else and never changes
        // the verdict on its own — it only preserves the grouping. `gates` (the filtered list)
        // stays reserved for the answerability check and the printed reason string, where an
        // `always` entry has no phrasing and isn't a real gate to name.
        const pathReasons = matches.map((a) => {
            const conditions = a.conditions ?? [];
            const gates = realGates(conditions);
            if (gates.length === 0) return null; // unconditional — this path stands
            if (gates.every(isAnswerableCondition) && conditionsMet(conditions, ctx)) return null;
            return reasonForConditions(gates);
        });

        // Any path standing (unconditional, or answerable-and-met) means the buff genuinely can
        // be counted — it is not dropped, and nothing is printed for it.
        if (pathReasons.some((r) => r === null)) continue;

        const reasons = [
            ...new Set(pathReasons.filter((r): r is string => r !== null && r.length > 0)),
        ];
        result.push({ buffId: buff.id, buffName: buff.buffName, reason: reasons.join(', ') });
    }

    return result;
}
