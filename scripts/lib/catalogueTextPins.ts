/**
 * Skill-text slots whose CURRENT text the user ruled correct over the catalogue's. The sync never
 * writes catalogue text into a pinned slot and lists every pin it applied in its report, so a pin
 * whose catalogue text later changes again is re-reviewed rather than silently kept: `ruledAgainst`
 * is the catalogue text (as `toCatalogueTemplate` renders it) the ruling was made on, and a run
 * whose catalogue text for the slot differs from it raises `attention` (see `planSync`). After
 * re-asking the ruling, update `ruledAgainst` to the new text or drop the pin.
 *
 * A pin is keyed on the catalogue's `definitionId` (equal to `ship_templates.definition_id` for
 * every matched ship) and one skill column. `withPinnedText` is the one place a pin is applied to
 * a set of skill columns; `planSync` and `build-catalogue-skills-csv` both go through it.
 * A `reason`'s ruling id (R2, R4a) refers to the 2026-10-01 catalogue rulings record.
 */
import type { SkillColumn, SkillColumns } from './catalogueMapping';

export interface TextPin {
    definitionId: string;
    column: SkillColumn;
    reason: string;
    ruledAgainst: string;
}

export const TEXT_PINS: readonly TextPin[] = [
    {
        definitionId: 'Marauder_Defender_Epic_1',
        column: 'active_skill_text',
        reason: "User ruling 2026-10-01 (R2): Tormenter's active grants Out. Damage Up I to itself and adjacent allies; catalogue text omits itself",
        ruledAgainst: 'This Unit deals <unit-damage>160% damage</unit-damage> and grants all adjacent allies <unit-skill>Out. Damage Up I</unit-skill> for 1 turn.',
    },
    {
        definitionId: 'Tianchao_Supporter_Legendary_1',
        column: 'first_passive_skill_text',
        reason: "User ruling 2026-10-01 (R4a): Chimei's over-repair goes to the lowest-HP ally; catalogue text drops that sentence from her base passive",
        ruledAgainst: 'At the end of the round, non-defender allies below 40% HP are granted <unit-skill>Stealth</unit-skill> for 1 turn.<br /><br />At the start of the round, all allies with <unit-skill>Stealth</unit-skill> <unit-damage>repair 10%</unit-damage> of this Unit’s max HP.',
    },
];

export const pinsFor = (definitionId: string, pins: readonly TextPin[]): TextPin[] =>
    pins.filter((p) => p.definitionId === definitionId);

/** `catalogue` with every column pinned for `definitionId` replaced by `current`'s text. */
export const withPinnedText = (
    definitionId: string,
    current: SkillColumns,
    catalogue: SkillColumns,
    pins: readonly TextPin[]
): SkillColumns => {
    const out = { ...catalogue };
    for (const p of pinsFor(definitionId, pins)) out[p.column] = current[p.column];
    return out;
};
