/**
 * Skill-text slots whose CURRENT text the user ruled correct over the catalogue's. The sync never
 * writes catalogue text into a pinned slot and lists every pin it applied in its report, so a pin
 * whose catalogue text later changes again is re-reviewed rather than silently kept.
 *
 * A pin is keyed on the catalogue's `definitionId` (equal to `ship_templates.definition_id` for
 * every matched ship) and one skill column. `withPinnedText` is the one place a pin is applied to
 * a set of skill columns; `planSync` and `build-catalogue-skills-csv` both go through it.
 */
import type { SkillColumn, SkillColumns } from './catalogueMapping';

export interface TextPin {
    definitionId: string;
    column: SkillColumn;
    reason: string;
}

export const TEXT_PINS: readonly TextPin[] = [
    {
        definitionId: 'Marauder_Defender_Epic_1',
        column: 'active_skill_text',
        reason: "User ruling 2026-10-01 (R2): Tormenter's active grants Out. Damage Up I to itself and adjacent allies; catalogue text omits itself",
    },
    {
        definitionId: 'Tianchao_Supporter_Legendary_1',
        column: 'first_passive_skill_text',
        reason: "User ruling 2026-10-01 (R4a): Chimei's over-repair goes to the lowest-HP ally; catalogue text drops that sentence from her base passive",
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
