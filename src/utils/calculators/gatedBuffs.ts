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

export interface GatedBuff {
    buffId: string;
    buffName: string;
    /** e.g. "below 60% HP" — from conditionSummary. */
    reason: string;
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

const isBuffGrantFor = (ability: Ability, buffName: string): boolean =>
    ability.config.type === 'buff' && ability.config.buffName === buffName;

export function gatedAutoFilledBuffs(
    buffs: SelectedGameBuff[],
    shipSkills: ShipSkills | undefined
): GatedBuff[] {
    if (!shipSkills) return [];
    const result: GatedBuff[] = [];

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
        // If ANY grant path is unconditional the buff genuinely can stand always-on.
        if (!matches.every((a) => realGates(a.conditions).length > 0)) continue;

        const reasons = [
            ...new Set(
                matches
                    .map((a) => reasonForConditions(realGates(a.conditions)))
                    .filter((r) => r.length > 0)
            ),
        ];
        result.push({ buffId: buff.id, buffName: buff.buffName, reason: reasons.join(', ') });
    }

    return result;
}
