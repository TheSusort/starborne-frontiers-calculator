import { encodeGearStats } from '../../utils/gear/statsCodec';
import { AUTH_USER, templateRow } from './fixtures';

/** The one gear piece in `simTables`: a weapon worn by `s1`. */
export const GEAR_ID = '00000000-0000-4000-8000-000000000001';

/** A plain single-target hit: the minimum kit that makes stats observable in combat. */
const KIT = {
    image_key: '',
    active_skill_text: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    active_target: 'front',
    active_pattern: 'Pattern-Base',
};

/** A `ships` row as `fetchShips` reads it, owned by `AUTH_USER`: attack 2000 before gear. */
export const shipRow = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name,
    user_id: AUTH_USER,
    rarity: 'legendary',
    faction: 'ATLAS_SYNDICATE',
    type: 'ATTACKER',
    affinity: 'thermal',
    level: 60,
    rank: 6,
    ship_base_stats: {
        hp: 20000,
        attack: 2000,
        defence: 500,
        crit: 50,
        crit_damage: 150,
        speed: 120,
    },
    ship_equipment: [],
    ship_implants: [],
    ship_refits: [],
    ship_templates: KIT,
    ...overrides,
});

/**
 * Tables for the simulator tools, read as `AUTH_USER`.
 *
 * - `s1` "Geared": attack 2000 plus the `GEAR_ID` weapon's flat attack (`weaponAttack`).
 * - `s2` "Bare": attack 2000, no gear.
 * - `s3` "Base 5000": attack 5000, no gear, otherwise identical to `s1` and `s2`.
 * - `m1`, `m2`: bare Marauders, for squad-leader boards.
 * - the `Atlas` template: attack 3000, ATLAS_SYNDICATE.
 */
export const simTables = ({ weaponAttack = 3000 }: { weaponAttack?: number } = {}) => ({
    users: [{ id: AUTH_USER, username: 'main', in_game_id: '1', owner_auth_user_id: null }],
    ships: [
        shipRow('s1', 'Geared', { ship_equipment: [{ slot: 'weapon', gear_id: GEAR_ID }] }),
        shipRow('s2', 'Bare'),
        shipRow('s3', 'Base 5000', {
            ship_base_stats: {
                hp: 20000,
                attack: 5000,
                defence: 500,
                crit: 50,
                crit_damage: 150,
                speed: 120,
            },
        }),
        shipRow('m1', 'Marauder', { faction: 'MARAUDERS' }),
        shipRow('m2', 'Other Marauder', { faction: 'MARAUDERS' }),
    ],
    inventory_items: [
        {
            id: GEAR_ID,
            user_id: AUTH_USER,
            slot: 'weapon',
            level: 16,
            stars: 6,
            rarity: 'legendary',
            set_bonus: null,
            calibration_ship_id: null,
            stats: encodeGearStats({
                mainStat: { name: 'attack', value: weaponAttack, type: 'flat' },
                subStats: [],
            }),
        },
    ],
    engineering_stats: [],
    ship_templates: [
        templateRow({
            id: 't1',
            name: 'Atlas',
            active_target: 'front',
            active_pattern: 'Pattern-Base',
            ascension_stats: [
                { level: 1, attribute: 'HullPoints', type: 'Percentage', value: 0.15 },
            ],
        }),
    ],
});

/** One of your ships at T1 against the Atlas template at T1. */
export const vsAtlas = (shipId: string, extra: Record<string, unknown> = {}) => ({
    player: [{ position: 'T1', ship_id: shipId }],
    enemy: [{ position: 'T1', template: 'Atlas', variant: 'r0' }],
    ...extra,
});
