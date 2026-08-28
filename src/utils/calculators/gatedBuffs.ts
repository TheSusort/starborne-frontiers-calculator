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
import type { Ability, Condition, ShipSkills, SkillSlot } from '../../types/abilities';
import { conditionSummary } from '../abilities/conditionSummary';

export interface GatedBuff {
    buffId: string;
    buffName: string;
    /** e.g. "below 60% HP" — from conditionSummary. */
    reason: string;
}

/** `SelectedGameBuff.skillSource` has FIVE values; `Skill.slot` has THREE. The join is lossy in
 *  two ways — `charge` becomes `charged`, and all three passives collapse into one slot — which is
 *  why the every-match rule below is conservative. Mitigating fact: only the refit-active passive
 *  applies in-game (resolved via `getShipSkillRows()`), so a multi-match is rare in practice. */
const SLOT_OF: Record<NonNullable<SelectedGameBuff['skillSource']>, SkillSlot> = {
    active: 'active',
    charge: 'charged',
    passive1: 'passive',
    passive2: 'passive',
    passive3: 'passive',
};

/** `always` is not a gate. Belt-and-braces: verified that neither `detectGrantConditions` nor
 *  `crossing()` emits it on the buff-merge path. */
const realGates = (conditions: Condition[] | undefined): Condition[] =>
    (conditions ?? []).filter((c) => c.subject !== 'always');

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

        const slot = SLOT_OF[buff.skillSource];
        const matches = shipSkills.slots
            .filter((s) => s.slot === slot)
            .flatMap((s) => s.abilities)
            .filter((a) => isBuffGrantFor(a, buff.buffName));

        if (!matches.length) continue;
        // If ANY grant path is unconditional the buff genuinely can stand always-on.
        if (!matches.every((a) => realGates(a.conditions).length > 0)) continue;

        const reasons = [
            ...new Set(matches.flatMap((a) => realGates(a.conditions).map(conditionSummary))),
        ];
        result.push({ buffId: buff.id, buffName: buff.buffName, reason: reasons.join(', ') });
    }

    return result;
}
