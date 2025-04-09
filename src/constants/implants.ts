import { RarityName } from './rarities';
import { Stat } from '../types/stats';

export interface ImplantData {
    id?: string;
    name: string;
    type: 'major' | 'minor' | 'ultimate';
    variants: ImplantVariant[];
    imageKey?: string;
}

export interface ImplantVariant {
    rarity: RarityName;
    stats?: Stat[];
    description: string;
}

export const IMPLANTS: Record<string, ImplantData> = {
    // Example implant - add more as needed
    menace: {
        id: 'menace',
        name: 'Menace',
        type: 'major',
        imageKey: 'menace-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    { name: 'attack', value: 8, type: 'percentage' },
                    { name: 'crit', value: 8, type: 'percentage' },
                ],
                description:
                    'When critically damaging an enemy, there is a 10% chance to increase that damage by 30%.',
            },
            {
                rarity: 'epic',
                stats: [
                    { name: 'attack', value: 14, type: 'percentage' },
                    { name: 'crit', value: 12, type: 'percentage' },
                ],
                description:
                    'When critically damaging an enemy, there is an 11% chance to increase that damage by 35%.',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'attack', value: 17, type: 'percentage' },
                    { name: 'crit', value: 19, type: 'percentage' },
                ],
                description:
                    'When critically damaging an enemy, there is a 12% chance to increase that damage by 45%.',
            },
        ],
    },
    // Add more implants here
    spearhead: {
        name: 'Spearhead',
        type: 'major',
        imageKey: 'spearhead-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    { name: 'hp', value: 7, type: 'percentage' },
                    { name: 'hacking', value: 8, type: 'flat' },
                ],
                description:
                    'After using the charged skill, there is a 21% chance to grant all allies Attack Up 1 for 1 turn.',
            },
            {
                rarity: 'epic',
                stats: [
                    { name: 'hp', value: 12, type: 'percentage' },
                    { name: 'hacking', value: 13, type: 'flat' },
                ],
                description:
                    'After using the charged skill, there is a 26% chance to grant all allies Attack Up 1 for 1 turn.',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'hp', value: 17, type: 'percentage' },
                    { name: 'hacking', value: 21, type: 'flat' },
                ],
                description:
                    'After using the charged skill, there is a 32% chance to grant all allies Attack Up 1 for 1 turn.',
            },
        ],
    },
    giant_slayer: {
        name: 'Giant Slayer',
        type: 'major',
        imageKey: 'giantslayer-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    { name: 'critDamage', value: 8, type: 'percentage' },
                    { name: 'speed', value: 7, type: 'flat' },
                ],
                description:
                    "When directly damaging an enemy, with a higher attack, there's a 14% chance to increase that damage by 50%.",
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'critDamage', value: 18, type: 'percentage' },
                    { name: 'speed', value: 14, type: 'flat' },
                ],
                description:
                    "When directly damaging an enemy, with a higher attack, there's a 20% chance to increase that damage by 50%.",
            },
        ],
    },
    insidiousness: {
        name: 'Insidiousness',
        type: 'major',
        imageKey: 'insidiousness-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    { name: 'crit', value: 7, type: 'percentage' },
                    { name: 'hacking', value: 9, type: 'flat' },
                ],
                description: 'When debuffing an enemy, there is a 14% chance to deal 80% damage.',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'crit', value: 19, type: 'percentage' },
                    { name: 'hacking', value: 23, type: 'flat' },
                ],
                description: 'When debuffing an enemy, there is a 21% chance to deal 100% damage.',
            },
        ],
    },
    ambush: {
        name: 'Ambush',
        type: 'major',
        imageKey: 'ambush-Photoroom',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    { name: 'defence', value: 341, type: 'flat' },
                    { name: 'critDamage', value: 14, type: 'percentage' },
                ],
                description:
                    'At the start of a round, if this unit has Stealth, there is a 12% chance to gain Crit Power Up 3 for 1 turn.',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'defence', value: 564, type: 'flat' },
                    { name: 'critDamage', value: 19, type: 'percentage' },
                ],
                description:
                    'At the start of a round, if this unit has Stealth, there is a 16% chance to gain Crit Power Up 3 for 1 turn.',
            },
        ],
    },
    bulwark: {
        name: 'Bulwark',
        type: 'major',
        imageKey: 'bulwark-Photoroom',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    { name: 'security', value: 11, type: 'flat' },
                    { name: 'hp', value: 1301, type: 'flat' },
                ],
                description:
                    'There is a 12% chance, when an adjacent ally is directly damaged, to apply Provoke to that enemy for 1 turn, once per round.',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'security', value: 20, type: 'flat' },
                    { name: 'hp', value: 2074, type: 'flat' },
                ],
                description:
                    'There is a 16% chance, when an adjacent ally is directly damaged, to apply Provoke to that enemy for 1 turn, once per round.',
            },
        ],
    },
    reactive_ward: {
        name: 'Reactive Ward',
        type: 'major',
        imageKey: 'reactiveward-Photoroom',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    { name: 'attack', value: 12, type: 'percentage' },
                    { name: 'hp', value: 1207, type: 'flat' },
                ],
                description:
                    'When directly damaged, there is a 12% chance to cleanse 1 debuff, but if the hit was critical, 2 debuffs are cleased instead.',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'attack', value: 20, type: 'percentage' },
                    { name: 'hp', value: 2088, type: 'flat' },
                ],
                description:
                    'When directly damaged, there is a 16% chance to cleanse 1 debuff, but if the hit was critical, 2 debuffs are cleased instead.',
            },
        ],
    },
    doomsayer: {
        name: 'Doomsayer',
        type: 'major',
        imageKey: 'doomsayer-Photoroom',
        variants: [
            {
                rarity: 'legendary',
                stats: [
                    { name: 'critDamage', value: 18, type: 'percentage' },
                    { name: 'hacking', value: 22, type: 'flat' },
                ],
                description:
                    'At the end of the round, if this unit was the first to activate, there is a 16% change to apply Concentrate Fire to the enemy with highest attack for 1 turn.',
            },
        ],
    },
    firewall: {
        name: 'Firewall',
        type: 'major',
        imageKey: 'firewall-Photoroom',
        variants: [
            {
                rarity: 'legendary',
                stats: [
                    { name: 'security', value: 22, type: 'flat' },
                    { name: 'attack', value: 376, type: 'flat' },
                ],
                description:
                    'When an enemy inflicts a debuff on this unit, there is a 15% chance to gain Block Debuff for 1 turn.',
            },
        ],
    },
    lockdown: {
        name: 'Lockdown',
        type: 'major',
        imageKey: 'lockdown-Photoroom',
        variants: [
            {
                rarity: 'legendary',
                stats: [
                    { name: 'defence', value: 574, type: 'flat' },
                    { name: 'security', value: 23, type: 'flat' },
                ],
                description:
                    'When resisting a debuff, there is a 16% chance to grant Buff Protection to all allies for 1 turn.',
            },
        ],
    },
    second_wind: {
        name: 'Second Wind',
        type: 'major',
        imageKey: 'secondwind-Photoroom',
        variants: [
            {
                rarity: 'legendary',
                stats: [
                    { name: 'defence', value: 17, type: 'percentage' },
                    { name: 'crit', value: 19, type: 'percentage' },
                ],
                description:
                    "Upon recieving critical direct damage, there is a 16% change to repair 10% of this unit's max HP.",
            },
        ],
    },
    ironclad: {
        name: 'Ironclad',
        type: 'major',
        imageKey: 'ironclad-Photoroom',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    { name: 'hacking', value: 15, type: 'flat' },
                    { name: 'security', value: 16, type: 'flat' },
                ],
                description:
                    'When this unit is directly damaged for the second and subsequent times, there is a 16% chance to block 45% of the damage.',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'hacking', value: 21, type: 'flat' },
                    { name: 'security', value: 21, type: 'flat' },
                ],
                description:
                    'When this unit is directly damaged for the second and subsequent times, there is a 20% chance to block 50% of the damage.',
            },
        ],
    },
    tenacity: {
        name: 'Tenacity',
        type: 'major',
        imageKey: 'tenacity-Photoroom',
        variants: [
            {
                rarity: 'legendary',
                stats: [
                    { name: 'security', value: 21, type: 'flat' },
                    { name: 'defence', value: 20, type: 'percentage' },
                ],
                description:
                    'Upon directly recieving damage exceeding 25% of max HP, there is a 16% chance to grant Buff Protection to all allies for 2 turns.',
            },
        ],
    },
    vivacious_repair: {
        name: 'Vivacious Repair',
        type: 'major',
        imageKey: 'vivaciousrepair-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    { name: 'hp', value: 8, type: 'percentage' },
                    { name: 'hp', value: 916, type: 'flat' },
                ],
                description:
                    'When repairing an ally with less than 25% HP, there is a 21% chance to double the amount of repair.',
            },
            {
                rarity: 'epic',
                stats: [
                    { name: 'hp', value: 12, type: 'percentage' },
                    { name: 'hp', value: 1342, type: 'flat' },
                ],
                description:
                    'When repairing an ally with less than 25% HP, there is a 26% chance to double the amount of repair.',
            },
        ],
    },
    // Add more implants here
    // Add more implants here
    // Add more implants here
};
