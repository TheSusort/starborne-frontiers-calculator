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
                attack: 26800,
                defence: 14900,
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
];

const BOSS_ID_PREFIX = 'boss:';

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
    const parsed = parseBossShipId(ship.id);
    if (!parsed) return undefined;
    return BOUNTY_BOSSES.find((boss) => boss.id === parsed.id)?.footprint;
}

/** The cells a boss occupies, by ship id; `undefined` for any id that is not a boss id. */
export function bossFootprintOfId(shipId: string): readonly Position[] | undefined {
    const parsed = parseBossShipId(shipId);
    if (!parsed) return undefined;
    return BOUNTY_BOSSES.find((boss) => boss.id === parsed.id)?.footprint;
}
