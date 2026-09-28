import { toAffinityName } from '../../constants/affinities';
import { isRarityName } from '../../constants/rarities';
import { isShipTypeName } from '../../constants/shipTypes';
import type { Ship } from '../../types/ship';

/** A `ship_templates` row as `select('*')` returns it. */
export interface ShipTemplate {
    id: string;
    name: string;
    rarity: string;
    faction: string;
    type: string;
    // `ship_templates.affinity` is nullable; coerced by `toAffinityName` below.
    affinity: string | null;
    image_key: string;
    active_skill_text?: string;
    charge_skill_text?: string;
    charge_skill_charge?: number;
    first_passive_skill_text?: string;
    second_passive_skill_text?: string;
    third_passive_skill_text?: string;
    active_target?: string | null;
    active_pattern?: string | null;
    charged_target?: string | null;
    charged_pattern?: string | null;
    bio?: string;
    quote?: string;
    quote_author?: string;
    ascension_stats?: unknown;
    base_stats: {
        hp: number;
        attack: number;
        defence: number;
        hacking: number;
        security: number;
        crit_rate: number;
        crit_damage: number;
        speed: number;
        shield: number;
        shield_penetration: number;
        defense_penetration: number;
    };
}

// `ship_templates` is a Supabase system table (`CLAUDE.md`) — a row's `type` crosses that trust
// boundary, so a row whose value fell out of the `ShipTypeName` union is dropped rather than
// carried into a `Ship` with a role the rest of the app can't classify.
export const transformShipTemplate = (template: ShipTemplate): Ship | null => {
    if (!isShipTypeName(template.type)) {
        console.warn(
            `Unrecognised ship type "${template.type}" — skipping template ${template.id}`
        );
        return null;
    }

    const rarity = template.rarity.toLowerCase();
    if (!isRarityName(rarity)) {
        console.warn(
            `Unrecognised ship rarity "${template.rarity}" — skipping template ${template.id}`
        );
        return null;
    }

    return {
        id: template.id,
        name: template.name,
        rarity,
        faction: template.faction,
        type: template.type,
        baseStats: {
            hp: template.base_stats.hp,
            attack: template.base_stats.attack,
            defence: template.base_stats.defence,
            hacking: template.base_stats.hacking,
            security: template.base_stats.security,
            crit: template.base_stats.crit_rate,
            critDamage: template.base_stats.crit_damage,
            speed: template.base_stats.speed,
            healModifier: 0,
            hpRegen: 0,
            shield: template.base_stats.shield,
            shieldPenetration: template.base_stats.shield_penetration,
            defensePenetration: template.base_stats.defense_penetration,
        },
        equipment: {},
        refits: [],
        implants: {},
        affinity: toAffinityName(template.affinity),
        imageKey: template.image_key,
        activeSkillText: template.active_skill_text,
        chargeSkillText: template.charge_skill_text,
        chargeSkillCharge: template.charge_skill_charge,
        firstPassiveSkillText: template.first_passive_skill_text,
        secondPassiveSkillText: template.second_passive_skill_text,
        thirdPassiveSkillText: template.third_passive_skill_text,
        activeTarget: template.active_target ?? undefined,
        activePattern: template.active_pattern ?? undefined,
        chargedTarget: template.charged_target ?? undefined,
        chargedPattern: template.charged_pattern ?? undefined,
        bio: template.bio,
        quote: template.quote,
        quoteAuthor: template.quote_author,
    };
};
