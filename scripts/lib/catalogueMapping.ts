/**
 * Maps one catalogue unit onto the `ship_templates` row shape. Pure.
 *
 * An enum value with no mapping is reported in `mappingErrors` and left null — never guessed.
 * Affinity `None` is antimatter: the catalogue encodes purple as none and never emits `Purple`.
 */
import type { CatalogueSkill, CatalogueUnit, Segment } from './catalogueSchema';

export interface TemplateBaseStats {
    hp: number;
    attack: number;
    defence: number;
    hacking: number;
    security: number;
    crit_rate: number;
    crit_damage: number;
    speed: number;
}
export const BASE_STAT_KEYS = [
    'hp', 'attack', 'defence', 'hacking', 'security', 'crit_rate', 'crit_damage', 'speed',
] as const satisfies readonly (keyof TemplateBaseStats)[];

export interface AscensionStatRow {
    level: number;
    attribute: string;
    type: string;
    value: number;
}

export const SKILL_COLUMNS = [
    'active_skill_text',
    'charge_skill_text',
    'first_passive_skill_text',
    'second_passive_skill_text',
    'third_passive_skill_text',
] as const;
export type SkillColumn = (typeof SKILL_COLUMNS)[number];
export type SkillColumns = Record<SkillColumn, string | null>;

export interface CatalogueTemplate {
    definitionId: string;
    slug: string;
    name: string;
    rarity: string | null;
    faction: string | null;
    type: string | null;
    affinity: string | null;
    imageKey: string | null;
    images: { avatar: string; bigPortrait: string | null };
    baseStats: TemplateBaseStats;
    ascensionStats: AscensionStatRow[] | null;
    skills: SkillColumns;
    chargeSkillCharge: number | null;
    mappingErrors: string[];
}

const FACTIONS: Record<string, string> = {
    Atlas: 'ATLAS_SYNDICATE',
    Binderburg: 'BINDERBURG',
    Everliving: 'EVERLIVING',
    Gelecek: 'GELECEK',
    Legion: 'FRONTIER_LEGION',
    MPL: 'MPL',
    Marauders: 'MARAUDERS',
    Terran: 'TERRAN_COMBINE',
    Tianchao: 'TIANCHAO',
    Tianchen: 'TIANCHAO',
    XAOC: 'XAOC',
};
const ROLES: Record<string, string> = {
    Attacker: 'ATTACKER',
    Debuffer: 'DEBUFFER',
    Defender: 'DEFENDER',
    Supporter: 'SUPPORTER',
};
const RARITIES: Record<string, string> = {
    Common: 'common',
    Uncommon: 'uncommon',
    Rare: 'rare',
    Epic: 'epic',
    Legendary: 'legendary',
};
const AFFINITIES: Record<string, string> = {
    Red: 'thermal',
    Blue: 'electric',
    Green: 'chemical',
    None: 'antimatter',
};

const DAMAGE_COLOR = '#EE6F1A';
const AID_COLOR = '#FFE172';

/** Segments → the tagged text the skill parser reads (`<unit-skill>`/`<unit-damage>`/`<unit-aid>`, `<br />`). */
export const renderSkillText = (segments: Segment[]): string =>
    segments
        .map((s) => {
            if (s.text.trim() === '') return s.text;
            if (s.effectId) return `<unit-skill>${s.text}</unit-skill>`;
            const color = s.color?.toUpperCase();
            if (color === DAMAGE_COLOR) return `<unit-damage>${s.text}</unit-damage>`;
            if (color === AID_COLOR) return `<unit-aid>${s.text}</unit-aid>`;
            return s.text;
        })
        .join('')
        .replace(/\r?\n/g, '<br />');

const lookup = (
    table: Record<string, string>,
    raw: string,
    label: string,
    errors: string[]
): string | null => {
    if (Object.hasOwn(table, raw)) return table[raw];
    errors.push(`unknown ${label} "${raw}"`);
    return null;
};

const byLevel = (skill: CatalogueSkill) => [...skill.levels].sort((a, b) => a.level - b.level);
const maxLevel = (skill: CatalogueSkill) => byLevel(skill).at(-1)!;
const skillOfKind = (unit: CatalogueUnit, kind: 'Active' | 'Charged') =>
    unit.skills.find((s) => s.levels[0].kind === kind);

/** `.../Atlas_11_Loot.png?sv=...` → `Atlas_11`. */
const imageKeyOf = (avatarUrl: string): string | null =>
    avatarUrl.match(/\/([^/?]+)_Loot\.[a-z]+(?:\?|$)/i)?.[1] ?? null;

export const toCatalogueTemplate = (unit: CatalogueUnit): CatalogueTemplate => {
    const errors: string[] = [];
    const active = skillOfKind(unit, 'Active');
    const charged = skillOfKind(unit, 'Charged');
    if (!active) errors.push('no Active skill');
    if (unit.ascensionSkills.length > 1) errors.push('more than one passive skill track');
    const passives = unit.ascensionSkills[0] ? byLevel(unit.ascensionSkills[0]) : [];
    if (passives.length > 3) errors.push(`${passives.length} passive levels; only 3 columns`);
    const passiveText = (i: number) =>
        passives[i] ? renderSkillText(passives[i].descriptionSegments) : null;
    const chargedTop = charged ? maxLevel(charged) : null;
    const s = unit.stats;

    return {
        definitionId: unit.id,
        slug: unit.slug,
        name: unit.name,
        rarity: lookup(RARITIES, unit.rarity, 'rarity', errors),
        faction: lookup(FACTIONS, unit.faction, 'faction', errors),
        type: lookup(ROLES, unit.role, 'role', errors),
        affinity: lookup(AFFINITIES, unit.affinity, 'affinity', errors),
        imageKey: imageKeyOf(unit.images.avatar),
        images: { avatar: unit.images.avatar, bigPortrait: unit.images.bigPortrait ?? null },
        baseStats: {
            hp: Math.round(s.HullPoints),
            attack: Math.round(s.Power),
            defence: Math.round(s.Defense),
            hacking: Math.round(s.Manipulation),
            security: Math.round(s.Security),
            crit_rate: Math.round(s.CritChance * 100),
            crit_damage: Math.round(s.CritBoost * 100),
            speed: Math.round(s.Initiative),
        },
        ascensionStats: unit.ascensionStats.length > 0 ? unit.ascensionStats : null,
        skills: {
            active_skill_text: active ? renderSkillText(maxLevel(active).descriptionSegments) : null,
            charge_skill_text: chargedTop ? renderSkillText(chargedTop.descriptionSegments) : null,
            first_passive_skill_text: passiveText(0),
            second_passive_skill_text: passiveText(1),
            third_passive_skill_text: passiveText(2),
        },
        chargeSkillCharge: chargedTop?.chargesRequired ?? null,
        mappingErrors: errors,
    };
};
