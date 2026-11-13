import type { Position } from '../types/encounters';
import type { AffinityName, Ship } from '../types/ship';
import type { BaseStats } from '../types/stats';
import type { BountyId } from './bounties';
import type { ShipTypeName } from './shipTypes';

export interface BountyBoss {
    id: BountyId;
    name: string;
    affinity: AffinityName;
    type: ShipTypeName;
    /** Occupied board cells; the first is the anchor. */
    footprint: readonly Position[];
    activeTarget: string;
    activePattern: string;
    chargedTarget: string;
    chargedPattern: string;
    activeSkillText: string;
    chargeSkillText: string;
    chargeSkillCharge: number;
    passiveSkillText: string;
    statsByLevel: Partial<Record<number, BaseStats>>;
}

export const BOUNTY_BOSSES: readonly BountyBoss[] = [
    {
        id: 'fenri',
        name: 'Fenri Khaliriz',
        affinity: 'antimatter',
        type: 'ATTACKER',
        footprint: ['M1', 'M2'],
        activeTarget: 'front',
        activePattern: 'Pattern-Line-Range-2',
        chargedTarget: 'front',
        chargedPattern: 'Pattern-Line-Range-2',
        activeSkillText:
            'The Boss deals <unit-damage>350% damage</unit-damage> and inflicts <unit-skill>Inferno II</unit-skill> for 3 turns.',
        chargeSkillText:
            "The Boss deals <unit-damage>400% damage</unit-damage> and inflicts <unit-skill>White Phosphorus III</unit-skill> for 3 turns.<br />When the Boss's HP drops below 66%, the damage increases by 50%.<br />When the Boss's HP falls below 33%, <unit-skill>White Phosphorus III</unit-skill> duration increases to 4 turns.",
        chargeSkillCharge: 2,
        passiveSkillText:
            'The Boss is immune to Control debuffs and Charge Loss effects and takes <unit-damage>50% less damage</unit-damage> from DoTs.<br />Every turn, the Boss gains <unit-skill>Pressing Onslaught</unit-skill>.<br />Whenever any enemy unit dies, the Boss <unit-damage>repairs 10%</unit-damage> of its MAX HP and gains <unit-skill>Attack Up II</unit-skill> for 2 turns.<br />Additionally, on kill, the Boss clears <unit-skill>Pressing Onslaught</unit-skill>.',
        statsByLevel: {
            32: {
                hp: 327000,
                // Attack and defence are fitted to measured in-game hits (#519): attack to his
                // Disintegration Cannon on a known-defence ship, defence to three player hits at
                // two defence-penetration values, which agree within 2 points.
                attack: 26390,
                defence: 14675,
                hacking: 270,
                security: 160,
                crit: 22,
                critDamage: 71,
                speed: 130,
                hpRegen: 0,
                shield: 0,
                shieldPenetration: 0,
                defensePenetration: 0,
                damageReduction: 0,
            },
        },
    },
    {
        id: 'maglienza',
        name: 'Mamma Maglienza',
        affinity: 'electric',
        type: 'DEBUFFER',
        footprint: ['T1', 'M2', 'M3', 'B1'],
        activeTarget: 'row-most',
        activePattern: 'Pattern-Row',
        chargedTarget: 'row-most',
        chargedPattern: 'Pattern-Row',
        activeSkillText:
            'The Boss targets the row with the most enemies, dealing <unit-damage>120% damage</unit-damage> and inflicting <unit-skill>Inferno II</unit-skill> twice for 12 turns each.',
        chargeSkillText:
            'The Boss deals <unit-damage>155% damage</unit-damage> to all enemies in the row with the most enemies, <unit-aid>purges 3</unit-aid> buffs from each enemy, and inflicts <unit-skill>Reverse Repairs</unit-skill> on them for 3 turns.',
        chargeSkillCharge: 2,
        passiveSkillText:
            'The Boss has infinite Hacking, is immune to Control debuffs and Charge Loss effects, and takes <unit-damage>50% less damage</unit-damage> from DoTs and Detonations. Whenever any ship dies, the Boss gains <unit-skill>Repair Self Over Time I</unit-skill> for 6 turns, and after attacking, gains <unit-skill>Enrage Attack III</unit-skill>.',
        statsByLevel: {
            32: {
                hp: 225450,
                // Attack, defence and crit damage are fitted to measured in-game hits (#519).
                attack: 21958,
                defence: 14675,
                hacking: 270,
                security: 160,
                crit: 22,
                critDamage: 32,
                speed: 121,
                hpRegen: 0,
                shield: 0,
                shieldPenetration: 0,
                defensePenetration: 0,
                damageReduction: 0,
            },
        },
    },
];

/** A non-boss unit an encounter places beside its boss: one hex, fixed level. */
export interface BountyAdd {
    id: string;
    name: string;
    affinity: AffinityName;
    type: ShipTypeName;
    /** The unit's portrait: a Cloudinary public id of full-size art, scaled on delivery like a
     *  bounty boss's (`bountyPortraitUrl`). */
    imageKey: string;
    level: number;
    activeTarget: string;
    activePattern: string;
    chargedTarget: string;
    chargedPattern: string;
    activeSkillText: string;
    chargeSkillText: string;
    chargeSkillCharge: number;
    passiveSkillText: string;
    stats: BaseStats;
}

export const BOUNTY_ADDS: readonly BountyAdd[] = [
    {
        id: 'capo',
        name: 'Capo',
        affinity: 'electric',
        type: 'DEFENDER',
        imageKey: 'Capo',
        level: 124,
        activeTarget: 'row-least',
        activePattern: 'Pattern-Row',
        chargedTarget: 'row-least',
        chargedPattern: 'Pattern-Row',
        activeSkillText:
            'This Unit deals <unit-damage>damage equal to 100%</unit-damage> of its Defense to all enemies in the row with the least enemies and <unit-skill>removes 2 charges</unit-skill> from the enemy.',
        chargeSkillText:
            'This Unit deals <unit-damage>damage equal to 120%</unit-damage> of its Defense to all enemies in the row with the least enemies and inflicts <unit-skill>Disable</unit-skill> on them for 1 turn.',
        chargeSkillCharge: 2,
        passiveSkillText:
            'This Unit inflicts <unit-skill>Stasis</unit-skill> for 2 turns when killed by direct Damage.',
        stats: {
            hp: 60170,
            // Its damage scales with defence, so attack never reaches a hit.
            attack: 10000,
            defence: 10943,
            hacking: 270,
            security: 160,
            crit: 22,
            critDamage: 71,
            speed: 83,
            hpRegen: 0,
            shield: 0,
            shieldPenetration: 0,
            defensePenetration: 0,
            damageReduction: 0,
        },
    },
];

export interface BountyEncounter {
    bountyId: BountyId;
    level: number;
    /** Each add stands on one cell. */
    adds: readonly { addId: string; position: Position }[];
}

export const BOUNTY_ENCOUNTERS: readonly BountyEncounter[] = [
    { bountyId: 'fenri', level: 32, adds: [] },
    {
        bountyId: 'maglienza',
        level: 32,
        adds: [
            { addId: 'capo', position: 'T2' },
            { addId: 'capo', position: 'M4' },
            { addId: 'capo', position: 'B2' },
        ],
    },
];

const BOSS_ID_PREFIX = 'boss:';
const NPC_ID_PREFIX = 'npc:';

/** True for the id of a bounty boss; adds and owned ships are not bosses. */
export const isBossShipId = (shipId: string): boolean => parseBossShipId(shipId) !== null;

export const npcShipId = (id: string, level: number): string => `${NPC_ID_PREFIX}${id}:${level}`;

/** `null` for any id that is not an npc id of a known add with an integer level. */
export function parseNpcShipId(shipId: string): { id: string; level: number } | null {
    if (!shipId.startsWith(NPC_ID_PREFIX)) return null;
    const [id, levelText, ...extra] = shipId.slice(NPC_ID_PREFIX.length).split(':');
    if (extra.length > 0 || !/^\d+$/.test(levelText ?? '')) return null;
    const add = BOUNTY_ADDS.find((candidate) => candidate.id === id);
    return add ? { id: add.id, level: Number(levelText) } : null;
}

/** `null` when the add does not exist at that level. */
export function npcShip(id: string, level: number): Ship | null {
    const add = BOUNTY_ADDS.find((candidate) => candidate.id === id);
    if (!add || add.level !== level) return null;
    return {
        id: npcShipId(id, level),
        name: add.name,
        rarity: 'legendary',
        faction: '',
        type: add.type,
        affinity: add.affinity,
        baseStats: { ...add.stats },
        equipment: {},
        implants: {},
        refits: [],
        level: 60,
        activeSkillText: add.activeSkillText,
        chargeSkillText: add.chargeSkillText,
        chargeSkillCharge: add.chargeSkillCharge,
        firstPassiveSkillText: add.passiveSkillText,
        activeTarget: add.activeTarget,
        activePattern: add.activePattern,
        chargedTarget: add.chargedTarget,
        chargedPattern: add.chargedPattern,
    };
}

export const bossShipId = (id: BountyId, level: number): string =>
    `${BOSS_ID_PREFIX}${id}:${level}`;

/** `null` for any id that is not a boss id of a known bounty with an integer level. */
export function parseBossShipId(shipId: string): { id: BountyId; level: number } | null {
    if (!shipId.startsWith(BOSS_ID_PREFIX)) return null;
    const [id, levelText, ...extra] = shipId.slice(BOSS_ID_PREFIX.length).split(':');
    if (extra.length > 0 || !/^\d+$/.test(levelText ?? '')) return null;
    const boss = BOUNTY_BOSSES.find((candidate) => candidate.id === id);
    return boss ? { id: boss.id, level: Number(levelText) } : null;
}

/** `null` when the boss has no stats at that level. */
export function bossShip(id: BountyId, level: number): Ship | null {
    const boss = BOUNTY_BOSSES.find((candidate) => candidate.id === id);
    const stats = boss?.statsByLevel[level];
    if (!boss || !stats) return null;
    return {
        id: bossShipId(id, level),
        name: boss.name,
        rarity: 'legendary',
        faction: '',
        type: boss.type,
        affinity: boss.affinity,
        baseStats: { ...stats },
        equipment: {},
        implants: {},
        refits: [],
        level: 60,
        activeSkillText: boss.activeSkillText,
        chargeSkillText: boss.chargeSkillText,
        chargeSkillCharge: boss.chargeSkillCharge,
        firstPassiveSkillText: boss.passiveSkillText,
        activeTarget: boss.activeTarget,
        activePattern: boss.activePattern,
        chargedTarget: boss.chargedTarget,
        chargedPattern: boss.chargedPattern,
    };
}

/** The cells a boss ship occupies; `undefined` for any ship whose id is not a boss id. */
export function bossFootprint(ship: Ship): readonly Position[] | undefined {
    return bossFootprintOfId(ship.id);
}

/** The cells a boss occupies, by ship id; `undefined` for any id that is not a boss id. */
export function bossFootprintOfId(shipId: string): readonly Position[] | undefined {
    const parsed = parseBossShipId(shipId);
    if (!parsed) return undefined;
    return BOUNTY_BOSSES.find((boss) => boss.id === parsed.id)?.footprint;
}
