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
    // Major Implants
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
    font_of_power: {
        name: 'Font of Power',
        type: 'major',
        imageKey: 'fontofpower-Photoroom',
        variants: [
            {
                rarity: 'legendary',
                stats: [
                    { name: 'hp', value: 1886, type: 'flat' },
                    { name: 'crit', value: 20, type: 'percentage' },
                ],
                description:
                    'When applying repair to another ally, there is a 16% chance to grant Power Infused Nanobots for 1 turn.',
            },
        ],
    },
    fortifying_shroud: {
        name: 'Fortifying Shroud',
        type: 'major',
        imageKey: 'fortifyingshroud-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    { name: 'defence', value: 240, type: 'flat' },
                    { name: 'hp', value: 9, type: 'percentage' },
                ],
                description:
                    'Every turn, there is a 21% chance to grant all adjacent allies Defence Up 1 for 1 turn.',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'defence', value: 468, type: 'flat' },
                    { name: 'hp', value: 17, type: 'percentage' },
                ],
                description:
                    'Every turn, there is a 32% chance to grant all adjacent allies Defence Up 1 for 1 turn.',
            },
        ],
    },
    last_stand: {
        name: 'Last Stand',
        type: 'major',
        imageKey: 'laststand-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    { name: 'defence', value: 230, type: 'flat' },
                    { name: 'attack', value: 148, type: 'flat' },
                ],
                description:
                    'When this unit becomes the last one standing, there is a 21% chance to gain Block Damage and Block Debuff for 1 turn.',
            },
            {
                rarity: 'epic',
                stats: [
                    { name: 'defence', value: 355, type: 'flat' },
                    { name: 'attack', value: 244, type: 'flat' },
                ],
                description:
                    'When this unit is at 25% or less HP, there is a 26% chance to grant Buff Protection to all allies for 1 turn.',
            },
        ],
    },
    last_wish: {
        name: 'Last Wish',
        type: 'major',
        imageKey: 'lastwish-Photoroom',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    { name: 'defence', value: 15, type: 'percentage' },
                    { name: 'attack', value: 264, type: 'flat' },
                ],
                description: "Upon death, repairs 25% of all allies' max HP.",
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'defence', value: 17, type: 'percentage' },
                    { name: 'attack', value: 391, type: 'flat' },
                ],
                description: "Upon death, repairs 32% of all allies' max HP.",
            },
        ],
    },
    bloodthirst: {
        name: 'Bloodthirst',
        type: 'major',
        imageKey: 'bloodthirst-Photoroom',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    { name: 'critDamage', value: 11, type: 'percentage' },
                    { name: 'attack', value: 262, type: 'flat' },
                ],
                description:
                    'On a critical hit, there is a 17% chance for this unit to repair itself for 17% of the damage dealt.',
            },
        ],
    },
    adaptive_plating: {
        name: 'Adaptive Plating',
        type: 'major',
        imageKey: 'adaptiveplating-Photoroom',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    { name: 'attack', value: 252, type: 'flat' },
                    { name: 'hacking', value: 15, type: 'flat' },
                ],
                description:
                    'When directly damaged, there is a 16% chance to gain a Shield equal to 34% of the damage taken, limited to once per round.',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'attack', value: 361, type: 'flat' },
                    { name: 'hacking', value: 22, type: 'flat' },
                ],
                description:
                    'When directly damaged, there is a 19% chance to gain a Shield equal to 42% of the damage taken, limited to once per round.',
            },
        ],
    },
    resonating_fury: {
        name: 'Resonating Fury',
        type: 'major',
        imageKey: 'resonatingfury-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    { name: 'attack', value: 9, type: 'percentage' },
                    { name: 'critDamage', value: 8, type: 'percentage' },
                ],
                description:
                    'When applying a shield, there is a 9% chance to grant Crit Power Up 3 for 1 turn.',
            },
        ],
    },
    smokescreen: {
        name: 'Smokescreen',
        type: 'major',
        imageKey: 'smokescreen-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    { name: 'speed', value: 6, type: 'flat' },
                    { name: 'attack', value: 9, type: 'percentage' },
                ],
                description:
                    'When directly damaged, there is a 9% chance to gain Stealth for 1 turn.',
            },
            {
                rarity: 'epic',
                stats: [
                    { name: 'speed', value: 9, type: 'flat' },
                    { name: 'attack', value: 14, type: 'percentage' },
                ],
                description:
                    'When directly damaged, there is a 12% chance to gain Stealth for 1 turn.',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'speed', value: 11, type: 'flat' },
                    { name: 'attack', value: 17, type: 'percentage' },
                ],
                description:
                    'When directly damaged, there is a 16% chance to gain Stealth for 1 turn.',
            },
        ],
    },
    shadowguard: {
        name: 'Shadowguard',
        type: 'major',
        imageKey: 'shadowguard-Photoroom',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    { name: 'speed', value: 9, type: 'flat' },
                    { name: 'hp', value: 11, type: 'percentage' },
                ],
                description:
                    'When directly damaged while in stealth, there is a 12% chance to block the damage, limited to once per round.',
            },
        ],
    },
    battlecry: {
        name: 'Battlecry',
        type: 'major',
        imageKey: 'battlecry-Photoroom',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    { name: 'defence', value: 14, type: 'percentage' },
                    { name: 'defence', value: 396, type: 'flat' },
                ],
                description: 'Upon death, grants all allies Inc. Damage Down 2 for 2 turns.',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'defence', value: 19, type: 'percentage' },
                    { name: 'defence', value: 552, type: 'flat' },
                ],
                description: 'Upon death, grants all allies Inc. Damage Down 2 for 3 turns.',
            },
        ],
    },
    exuberance: {
        name: 'Exuberance',
        type: 'major',
        imageKey: 'exuberance-Photoroom',
        variants: [
            {
                rarity: 'uncommon',
                stats: [
                    { name: 'defence', value: 6, type: 'percentage' },
                    { name: 'speed', value: 4, type: 'flat' },
                ],
                description: 'When repaired, there is a 17% chance to increase that repair by 12%.',
            },
            {
                rarity: 'rare',
                stats: [
                    { name: 'defence', value: 9, type: 'percentage' },
                    { name: 'speed', value: 6, type: 'flat' },
                ],
                description: 'When repaired, there is a 20% chance to increase that repair by 13%.',
            },
            {
                rarity: 'epic',
                stats: [
                    { name: 'defence', value: 14, type: 'percentage' },
                    { name: 'speed', value: 9, type: 'flat' },
                ],
                description: 'When repaired, there is a 24% chance to increase that repair by 14%.',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'defence', value: 17, type: 'percentage' },
                    { name: 'speed', value: 12, type: 'flat' },
                ],
                description: 'When repaired, there is a 30% chance to increase that repair by 15%.',
            },
        ],
    },
    alacrity: {
        name: 'Alacrity',
        type: 'major',
        imageKey: 'alacrity-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    { name: 'crit', value: 8, type: 'percentage' },
                    { name: 'critDamage', value: 8, type: 'percentage' },
                ],
                description:
                    'At the end of the round, if not hit, there is a 14% chance to gain Speed Up 3 for 2 rounds.',
            },
        ],
    },
    // Ultimate Implants
    intrusion: {
        name: 'Intrusion',
        type: 'ultimate',
        imageKey: 'intrusion-Photoroom',
        variants: [
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    'Increases damage dealt by 2% for each debuff on the target when directly damaging them.',
            },
            {
                rarity: 'rare',
                stats: [],
                description:
                    'Increases damage dealt by 3% for each debuff on the target when directly damaging them.',
            },
        ],
    },
    nourishment: {
        name: 'Nourishment',
        type: 'ultimate',
        imageKey: 'nourishment-Photoroom',
        variants: [
            {
                rarity: 'uncommon',
                stats: [],
                description: 'Increase repair by 10% when repairing an ally with lower HP.',
            },
            {
                rarity: 'rare',
                stats: [],
                description: 'Increase repair by 15% when repairing an ally with lower HP.',
            },
        ],
    },
    arcance_siege: {
        name: 'Arcance Siege',
        type: 'ultimate',
        imageKey: 'arcancesiege-Photoroom',
        variants: [
            {
                rarity: 'uncommon',
                stats: [],
                description: 'Increases outgoing direct damage by 6% while shielded.',
            },
            {
                rarity: 'epic',
                stats: [],
                description: 'Increases outgoing direct damage by 15% while shielded.',
            },
        ],
    },
    warpstrike: {
        name: 'Warpstrike',
        type: 'ultimate',
        imageKey: 'warpstrike-Photoroom',
        variants: [
            {
                rarity: 'epic',
                stats: [],
                description:
                    "Increases damage by 4% when directly damaging an enemy while debuffed, and reduces a random active debuff's duration by 1 turn.",
            },
            {
                rarity: 'legendary',
                stats: [],
                description:
                    "Increases damage by 5% when directly damaging an enemy while debuffed, and reduces a random active debuff's duration by 1 turn.",
            },
        ],
    },
    voidshade: {
        name: 'Voidshade',
        type: 'ultimate',
        imageKey: 'voidshade-Photoroom',
        variants: [
            {
                rarity: 'uncommon',
                stats: [],
                description: 'Decreases direct damage by 8% while self has Stealth.',
            },
            {
                rarity: 'rare',
                stats: [],
                description: 'Decreases direct damage by 12% while self has Stealth.',
            },
        ],
    },
    nebula_nullifier: {
        name: 'Nebula Nullifier',
        type: 'ultimate',
        imageKey: 'nebulanullifier-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [],
                description:
                    'Decrease damage by 21% when directly damaged while under Stasis or Disable.',
            },
        ],
    },
    voidfire_catalyst: {
        name: 'Voidfire Catalyst',
        type: 'ultimate',
        imageKey: 'voidfirecatalyst-Photoroom',
        variants: [
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    'Deals 4% more detonation damage and bombs additionally deal 8% more splash damage.',
            },
            {
                rarity: 'rare',
                stats: [],
                description:
                    'Deals 6% more detonation damage and bombs additionally deal 12% more splash damage.',
            },
            {
                rarity: 'epic',
                stats: [],
                description:
                    'Deals 8% more detonation damage and bombs additionally deal 16% more splash damage.',
            },
        ],
    },
    vortex_veil: {
        name: 'Vortex Veil',
        type: 'ultimate',
        imageKey: 'vortexveil-Photoroom',
        variants: [
            {
                rarity: 'uncommon',
                stats: [],
                description: 'Reduces damage taken from Inferno or Corrosion by 12%.',
            },
            {
                rarity: 'rare',
                stats: [],
                description: 'Reduces damage taken from Inferno or Corrosion by 18%.',
            },
        ],
    },
    synaptic_response: {
        name: 'Synaptic Response',
        type: 'ultimate',
        imageKey: 'synapticresponse-Photoroom',
        variants: [
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    'Gains Speed Up 3 for 1 turn when an enemy gets directly repaired. Increases the Crit Power for the next crit by 4%.',
            },
            {
                rarity: 'rare',
                stats: [],
                description:
                    'Gains Speed Up 3 for 1 turn when an enemy gets directly repaired. Increases the Crit Power for the next crit by 6%.',
            },
        ],
    },
    lifeline: {
        name: 'Lifeline',
        type: 'ultimate',
        imageKey: 'lifeline-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [],
                description:
                    "When direct damage would cause HP to drop below 30%, gain a Shield equal to 8000 plus 100% of this unit's Attack stat (capped at max HP). This can occur once per battle.",
            },
            {
                rarity: 'legendary',
                stats: [],
                description:
                    "When direct damage would cause HP to drop below 30%, gain a Shield equal to 12000 plus 100% of this unit's Attack stat (capped at max HP). This can occur once per battle.",
            },
        ],
    },
    cipher_link: {
        name: 'Cipher Link',
        type: 'ultimate',
        imageKey: 'cipherlink-Photoroom',
        variants: [
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    'This unit increases Hacking by 25% of its own Security at the start of combat.',
            },
            {
                rarity: 'epic',
                stats: [],
                description:
                    'This unit increases Security by 35% of its own Hacking at the start of combat.',
            },
        ],
    },
    code_guard: {
        name: 'Code Guard',
        type: 'ultimate',
        imageKey: 'codeguard-Photoroom',
        variants: [
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    'This unit increases Security by 25% of its own Hacking at the start of combat.',
            },
            {
                rarity: 'epic',
                stats: [],
                description:
                    'This unit increases Security by 35% of its own Hacking at the start of combat.',
            },
        ],
    },
    hyperion_gaze: {
        name: 'Hyperion Gaze',
        type: 'ultimate',
        imageKey: 'hyperiongaze-Photoroom',
        variants: [
            {
                rarity: 'rare',
                stats: [],
                description:
                    'Decreases damage by 21% when critically hit by an enemy that has Stealth. Does not stack with similar effects.',
            },
        ],
    },
    chrono_reaver: {
        name: 'Chrono Reaver',
        type: 'ultimate',
        imageKey: 'chronoreaver-Photoroom',
        variants: [
            {
                rarity: 'epic',
                stats: [],
                description: "Adds 1 charge to this unit's charged skill every third round.",
            },
            {
                rarity: 'legendary',
                stats: [],
                description: "Adds 1 charge to this unit's charged skill every other round.",
            },
        ],
    },
};
