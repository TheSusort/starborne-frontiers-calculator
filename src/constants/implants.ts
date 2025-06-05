import { RarityName } from './rarities';
import { Stat } from '../types/stats';

export interface ImplantData {
    id?: string;
    name: string;
    type: 'major' | 'alpha(minor)' | 'gamma(minor)' | 'sigma(minor)' | 'ultimate';
    variants: ImplantVariant[];
    imageKey?: string;
}

export interface ImplantVariant {
    rarity: RarityName;
    stats?: Stat[];
    description?: string;
}

export const IMPLANTS: Record<string, ImplantData> = {
    MARTYRDOM: {
        name: 'Martyrdom',
        type: 'ultimate',
        variants: [
            {
                rarity: 'legendary',
                stats: [],
                description: 'Applies Disable for 2 turns on the enemy that killed this Unit.',
            },
            {
                rarity: 'rare',
                stats: [],
                description: 'Applies Disable for 1 turn on the enemy that killed this Unit.',
            },
        ],
        imageKey: 'martyrdom-Photoroom',
    },
    ABUNDANT_RENEWAL: {
        name: 'Abundant Renewal',
        type: 'ultimate',
        variants: [
            {
                rarity: 'legendary',
                stats: [],
                description:
                    'Grants a sheild equal to 30% of the overrepaired amount on the target when overrepairing an ally',
            },
            {
                rarity: 'epic',
                stats: [],
                description:
                    'Grants a sheild equal to 20% of the overrepaired amount on the target when overrepairing an ally',
            },
        ],
        imageKey: 'abundantrenewal-Photoroom',
    },
    ARCANE_SIEGE: {
        name: 'Arcane Siege',
        type: 'ultimate',
        variants: [
            {
                rarity: 'common',
                stats: [],
                description: 'Increases outgoing Direct Damage by 3% while shielded',
            },
            {
                rarity: 'rare',
                stats: [],
                description: 'Increases outgoing Direct Damage by 10% while shielded',
            },
            {
                rarity: 'uncommon',
                stats: [],
                description: 'Increases outgoing Direct Damage by 6% while shielded',
            },
            {
                rarity: 'epic',
                stats: [],
                description: 'Increases outgoing direct damage by 15% while shielded.',
            },
            {
                rarity: 'legendary',
                stats: [],
                description: 'Increases outgoing direct damage by 20% while shielded.',
            },
        ],
        imageKey: 'arcanesiege-Photoroom',
    },
    CHRONO_REAVER: {
        name: 'Chrono Reaver',
        type: 'ultimate',
        variants: [
            {
                rarity: 'epic',
                stats: [],
                description: 'Every third turn, adds 1 charge to the Unit’s Charged skill.',
            },
            {
                rarity: 'legendary',
                stats: [],
                description: 'Every other turn, adds 1 charge to the Unit’s Charged skill.',
            },
        ],
        imageKey: 'chronoreaver-Photoroom',
    },
    CODE_GUARD: {
        name: 'Code Guard',
        type: 'ultimate',
        variants: [
            {
                rarity: 'rare',
                stats: [],
                description:
                    'This unit increases Security by 30% of its Hacking at the start of Combat.',
            },
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
        imageKey: 'codeguard-Photoroom',
    },
    HYPERION_GAZE: {
        name: 'Hyperion Gaze',
        type: 'ultimate',
        variants: [
            {
                rarity: 'common',
                stats: [],
                description:
                    'Decreases Damage by 7% when critically hit by an enemy that has stealth. Does not stack with similar effects',
            },
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    'Decreases Damage by 14% when critically hit by an enemy that has stealth. Does not stack with similar effects',
            },
            {
                rarity: 'rare',
                stats: [],
                description:
                    'Decreases Damage by 21% when critically hit by an enemy that has stealth. Does not stack with similar effects',
            },
            {
                rarity: 'epic',
                stats: [],
                description:
                    'Decreases Damage by 28% when critically hit by an enemy that has stealth. Does not stack with similar effects',
            },
            {
                rarity: 'legendary',
                stats: [],
                description:
                    'Decreases Damage by 35% when critically hit by an enemy that has stealth. Does not stack with similar effects',
            },
        ],
        imageKey: 'hyperiongaze-Photoroom',
    },
    INTRUSION: {
        name: 'Intrusion',
        type: 'ultimate',
        variants: [
            {
                rarity: 'common',
                stats: [],
                description:
                    'Increases damage dealt by 1% for each debuff on the target when directly damaging them.',
            },
            {
                rarity: 'legendary',
                stats: [],
                description:
                    'Increases damage dealt by 5% for each debuff on the target when directly damaging them.',
            },
            {
                rarity: 'epic',
                stats: [],
                description:
                    'Increases damage dealt by 4% for each debuff on the target when directly damaging them.',
            },
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
                    'Increases damage dealt by 3% for each debuff on the target when directly damaging them',
            },
        ],
        imageKey: 'intrusion-Photoroom',
    },
    LIFELINE: {
        name: 'Lifeline',
        type: 'ultimate',
        variants: [
            {
                rarity: 'common',
                stats: [],
                description:
                    "When direct damage would cause HP to drop below 30%, gain a shield equal to 4000 plus 100% of this unit's attack stat. This can occur once per battle",
            },
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    "When direct damage would cause HP to drop below 30%, gain a shield equal to 6000 plus 100% of this unit's attack stat. This can occur once per battle",
            },
            {
                rarity: 'rare',
                stats: [],
                description:
                    "When direct damage would cause HP to drop below 30%, gain a Shield equal to 8000 plus 100% of this unit's Attack stat (capped at max HP). This can occur once per battle.",
            },
            {
                rarity: 'epic',
                stats: [],
                description:
                    "When direct damage would cause HP to drop below 30%, gain a Shield equal to 10000 plus 100% of this unit's Attack stat (capped at max HP). This can occur once per battle.",
            },
            {
                rarity: 'legendary',
                stats: [],
                description:
                    "When direct damage would cause HP to drop below 30%, gain a Shield equal to 12000 plus 100% of this unit's Attack stat (capped at max HP). This can occur once per battle.",
            },
        ],
        imageKey: 'lifeline-Photoroom',
    },
    CIPHER_LINK: {
        name: 'Cipher Link',
        type: 'ultimate',
        imageKey: 'cipherlink-Photoroom',
        variants: [
            {
                rarity: 'common',
                stats: [],
                description:
                    'This unit increases Hacking by 20% of its own Security at the start of combat.',
            },
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    'This unit increases Hacking by 25% of its own Security at the start of combat.',
            },
            {
                rarity: 'rare',
                stats: [],
                description:
                    'This unit increases Hacking by 31% of its own Security at the start of combat.',
            },
            {
                rarity: 'epic',
                stats: [],
                description:
                    'This unit increases Security by 37% of its own Hacking at the start of combat.',
            },
            {
                rarity: 'legendary',
                stats: [],
                description:
                    'This unit increases Security by 45% of its own Hacking at the start of combat.',
            },
        ],
    },
    NEBULA_NULLIFIER: {
        name: 'Nebula Nullifier',
        type: 'ultimate',
        variants: [
            {
                rarity: 'common',
                stats: [],
                description:
                    'Decrease damage by 7% when directly damaged while under Stasis or Disable.',
            },
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    'Decrease damage by 14% when directly damaged while under Stasis or Disable.',
            },
            {
                rarity: 'rare',
                stats: [],
                description:
                    'Decrease damage by 21% when directly damaged while under Stasis or Disable.',
            },
            {
                rarity: 'epic',
                stats: [],
                description: 'Decrease Direct Damage by 28% when the unit is in Stasis or Disable',
            },
            {
                rarity: 'legendary',
                stats: [],
                description:
                    'Decrease damage by 35% when directly damaged while under Stasis or Disable.',
            },
        ],
        imageKey: 'nebulanullifier-Photoroom',
    },
    NOURISHMENT: {
        name: 'Nourishment',
        type: 'ultimate',
        variants: [
            {
                rarity: 'epic',
                stats: [],
                description: 'Increases repair by 20% when targeting an ally with lower HP',
            },
            {
                rarity: 'rare',
                stats: [],
                description: 'Increases repair by 15% when targeting an ally with lower HP',
            },
            {
                rarity: 'uncommon',
                stats: [],
                description: 'Increases repair by 10% when targeting an ally with lower HP',
            },
            {
                rarity: 'legendary',
                stats: [],
                description: 'Icreases repair by 30% when targeting an ally with lower HP',
            },
        ],
        imageKey: 'nourishment-Photoroom',
    },
    SYNAPTIC_RESONANCE: {
        name: 'Synaptic Resonance',
        type: 'ultimate',
        variants: [
            {
                rarity: 'common',
                stats: [],
                description:
                    'Gains Speed Up 3 for 1 turn when an enemy gets directly repaired. Increases the critDamage of the next crit by 2%',
            },
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    'Gains Speed Up 3 for 1 turn when an enemy gets directly repaired. Increases the critDamage of the next crit by 4%',
            },
            {
                rarity: 'rare',
                stats: [],
                description:
                    'Gains Speed Up 3 for 1 turn when an enemy gets directly repaired. Increases the critDamage of the next crit by 6%',
            },
            {
                rarity: 'epic',
                stats: [],
                description:
                    'Gains Speed Up 3 for 1 turn when an enemy gets directly repaired. Increases the critDamage of the next crit by 8%',
            },
            {
                rarity: 'legendary',
                stats: [],
                description:
                    'Gains Speed Up 3 for 1 turn when an enemy gets directly repaired. Increases the critDamage of the next crit by 10%',
            },
        ],
        imageKey: 'synapticresponse-Photoroom',
    },
    VOIDFIRE_CATALYST: {
        name: 'Voidfire Catalyst',
        type: 'ultimate',
        variants: [
            {
                rarity: 'common',
                stats: [],
                description:
                    'Deals 2% more detonation damage and bombs additionally deal 4% more splash damage.',
            },
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    'Deals 4% more detonation damage and bombs additionally deal 8% more splash damage.',
            },
            {
                rarity: 'rare',
                stats: [],
                description: 'Inflicts bombs that deal 24% more splash damage',
            },
            {
                rarity: 'epic',
                stats: [],
                description:
                    'Deals 8% more detonation damage and bombs additionally deal 16% more splash damage.',
            },
            {
                rarity: 'legendary',
                stats: [],
                description: 'Inflicts bombs that deal 40% more splash damage.',
            },
        ],
        imageKey: 'voidfirecatalyst-Photoroom',
    },
    VOIDSHADE: {
        name: 'Voidshade',
        type: 'ultimate',
        variants: [
            {
                rarity: 'common',
                stats: [],
                description:
                    'Decreases Damage Received by 4% When Directly Damaged While Stealth is Active.',
            },
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    'Decreases Damage Received by 8% When Directly Damaged While Stealth is Active.',
            },
            {
                rarity: 'rare',
                stats: [],
                description:
                    'Decreases Damage Received by 12% When Directly Damaged While Stealth is Active.',
            },
            {
                rarity: 'epic',
                stats: [],
                description:
                    'Decreases Damage Received by 16% When Directly Damaged While Stealth is Active.',
            },
            {
                rarity: 'legendary',
                stats: [],
                description:
                    'Decreases Damage Received by 20% When Directly Damaged While Stealth is Active.',
            },
        ],
        imageKey: 'voidshade-Photoroom',
    },
    VORTEX_VEIL: {
        name: 'Vortex Veil',
        type: 'ultimate',
        variants: [
            {
                rarity: 'common',
                stats: [],
                description: 'Reduces damage taken from Inferno or Corrosion by 6%.',
            },
            {
                rarity: 'uncommon',
                stats: [],
                description: 'Reduces damage taken from inferno and corrosion by 12%',
            },
            {
                rarity: 'rare',
                stats: [],
                description: 'Reduces damage taken from Inferno or Corrosion by 18%.',
            },
            {
                rarity: 'epic',
                stats: [],
                description: 'Reduces damage taken from Inferno or Corrosion by 24%.',
            },
            {
                rarity: 'legendary',
                stats: [],
                description: 'Reduces damage taken from Inferno or Corrosion by 30%.',
            },
        ],
        imageKey: 'vortexveil-Photoroom',
    },
    WARPSTRIKE: {
        name: 'Warpstrike',
        type: 'ultimate',
        variants: [
            {
                rarity: 'common',
                stats: [],
                description:
                    "Increases damage by 1% when directly damaging an enemy while debuffed, and reduces a random active debuff's duration by 1 turn",
            },
            {
                rarity: 'uncommon',
                stats: [],
                description:
                    "Increases damage by 2% when directly damaging an enemy while debuffed, and reduces a random active debuff's duration by 1 turn",
            },
            {
                rarity: 'rare',
                stats: [],
                description:
                    "Increases damage by 3% when directly damaging an enemy while debuffed, and reduces a random active debuff's duration by 1 turn",
            },
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
        imageKey: 'warpstrike-Photoroom',
    },
    CITADEL: {
        name: 'Citadel',
        type: 'sigma(minor)',
        variants: [
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'hp',
                        value: 190,
                        type: 'flat',
                    },
                ],
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'hp',
                        value: 1010,
                        type: 'flat',
                        min: 1010,
                        max: 1198,
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'hp',
                        value: 1612,
                        type: 'flat',
                        min: 1612,
                        max: 1672,
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'hp',
                        value: 704,
                        type: 'flat',
                        min: 704,
                        max: 770,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'hp',
                        value: 409,
                        type: 'flat',
                        min: 409,
                        max: 416,
                    },
                ],
            },
        ],
        imageKey: 'citadel-Photoroom',
    },
    HASTE: {
        name: 'Haste',
        type: 'sigma(minor)',
        variants: [
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'speed',
                        value: 2,
                        type: 'flat',
                    },
                ],
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'speed',
                        value: 8,
                        type: 'flat',
                        min: 8,
                        max: 9,
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'speed',
                        value: 6,
                        type: 'flat',
                        min: 6,
                        max: 7,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'speed',
                        value: 4,
                        type: 'flat',
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'speed',
                        value: 12,
                        type: 'flat',
                        min: 10,
                        max: 12,
                    },
                ],
            },
        ],
        imageKey: 'hastesigma-Photoroom',
    },
    HASTE_GAMMA: {
        name: 'Haste',
        type: 'gamma(minor)',
        variants: [
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'speed',
                        value: 10,
                        type: 'flat',
                        min: 10,
                        max: 12,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'speed',
                        value: 4,
                        type: 'flat',
                        min: 4,
                        max: 5,
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'speed',
                        value: 6,
                        type: 'flat',
                    },
                ],
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'speed',
                        value: 8,
                        type: 'flat',
                        min: 8,
                        max: 9,
                    },
                ],
            },
        ],
        imageKey: 'hastegamma-Photoroom',
    },
    ONSLAUGHT: {
        name: 'Onslaught',
        type: 'sigma(minor)',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'attack',
                        value: 11,
                        type: 'percentage',
                        min: 10,
                        max: 11,
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'attack',
                        value: 16,
                        type: 'percentage',
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'attack',
                        value: 7,
                        type: 'percentage',
                        min: 7,
                        max: 8,
                    },
                ],
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'attack',
                        value: 2,
                        type: 'percentage',
                        min: 2,
                        max: 3,
                    },
                ],
            },
        ],
        imageKey: 'onslaughtsigma-Photoroom',
    },
    ONSLAUGHT_ALPHA: {
        name: 'Onslaught',
        type: 'alpha(minor)',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'attack',
                        value: 7,
                        type: 'percentage',
                        min: 7,
                        max: 12,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'attack',
                        value: 4,
                        type: 'percentage',
                        min: 4,
                        max: 7,
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'attack',
                        value: 13,
                        type: 'percentage',
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'attack',
                        value: 6,
                        type: 'percentage',
                        min: 6,
                        max: 11,
                    },
                ],
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'attack',
                        value: 3,
                        type: 'percentage',
                    },
                ],
            },
        ],
        imageKey: 'onslaughtalpha-Photoroom',
    },
    PRECISION: {
        name: 'Precision',
        type: 'sigma(minor)',
        variants: [
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'crit',
                        value: 2,
                        type: 'percentage',
                    },
                ],
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'crit',
                        value: 9,
                        type: 'percentage',
                        min: 9,
                        max: 12,
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'crit',
                        value: 6,
                        type: 'percentage',
                        min: 6,
                        max: 8,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'crit',
                        value: 4,
                        type: 'percentage',
                        min: 4,
                        max: 5,
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'crit',
                        value: 14,
                        type: 'percentage',
                    },
                ],
            },
        ],
        imageKey: 'precisionsigma-Photoroom',
    },
    PRECISION_GAMMA: {
        name: 'Precision',
        type: 'gamma(minor)',
        variants: [
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'crit',
                        value: 2,
                        type: 'percentage',
                        min: 2,
                        max: 3,
                    },
                ],
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'crit',
                        value: 10,
                        type: 'percentage',
                        min: 10,
                        max: 11,
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'crit',
                        value: 14,
                        type: 'percentage',
                        min: 14,
                        max: 16,
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'crit',
                        value: 6,
                        type: 'percentage',
                        min: 6,
                        max: 8,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'crit',
                        value: 5,
                        type: 'percentage',
                        min: 4,
                        max: 5,
                    },
                ],
            },
        ],
        imageKey: 'precisiongamma-Photoroom',
    },
    SENTRY: {
        name: 'Sentry',
        type: 'gamma(minor)',
        variants: [
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'security',
                        value: 2,
                        type: 'flat',
                        min: 2,
                        max: 3,
                    },
                ],
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'security',
                        value: 8,
                        type: 'flat',
                        min: 8,
                        max: 9,
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'security',
                        value: 6,
                        type: 'flat',
                        min: 6,
                        max: 7,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'security',
                        value: 4,
                        type: 'flat',
                        min: 4,
                        max: 4,
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'security',
                        value: 11,
                        type: 'flat',
                        min: 11,
                        max: 12,
                    },
                ],
            },
        ],
        imageKey: 'sentry-Photoroom',
    },
    STRIKE: {
        name: 'Strike',
        type: 'sigma(minor)',
        variants: [
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'attack',
                        value: 30,
                        type: 'flat',
                    },
                ],
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'attack',
                        value: 182,
                        type: 'flat',
                        min: 182,
                        max: 220,
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'attack',
                        value: 289,
                        type: 'flat',
                        min: 289,
                        max: 313,
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'attack',
                        value: 115,
                        type: 'flat',
                        min: 112,
                        max: 130,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'attack',
                        value: 71,
                        type: 'flat',
                        min: 71,
                        max: 78,
                    },
                ],
            },
        ],
        imageKey: 'strike-Photoroom',
    },
    ADAPTIVE_PLATING: {
        name: 'Adaptive Plating',
        type: 'major',
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
                    {
                        name: 'hacking',
                        value: 22,
                        type: 'flat',
                    },
                    {
                        name: 'attack',
                        value: 359,
                        type: 'flat',
                        min: 359,
                        max: 361,
                    },
                ],
                description:
                    "When directly damaged, there's a 19% chance to gain a shield equal to 42% of the damage taken, limited to once per round.",
            },
            {
                rarity: 'uncommon',
                stats: [
                    { name: 'attack', value: 70, type: 'flat', min: 70, max: 100 },
                    { name: 'hacking', value: 5, type: 'flat', min: 5, max: 6 },
                ],
                description:
                    "When directly damaged, there's a 12% chance to gain a shield equal to 21% of the damage taken, limited to once per round.",
            },
        ],
        imageKey: 'adaptiveplating-Photoroom',
    },
    ALACRITY: {
        name: 'Alacrity',
        type: 'major',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'critDamage',
                        value: 11,
                        type: 'percentage',
                    },
                    {
                        name: 'crit',
                        value: 15,
                        type: 'percentage',
                    },
                ],
                description:
                    'At the end of the round, if not hit, there is a 16% chance to gain Speed Up 3 for 2 turns',
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'critDamage',
                        value: 8,
                        type: 'percentage',
                        min: 8,
                        max: 9,
                    },
                    {
                        name: 'crit',
                        value: 8,
                        type: 'percentage',
                        min: 8,
                        max: 8,
                    },
                ],
                description:
                    'At the end of the round, if not hit, there is a 14% chance to gain Speed Up 3 for 2 turns',
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'crit',
                        value: 18,
                        type: 'percentage',
                    },
                    {
                        name: 'critDamage',
                        value: 16,
                        type: 'percentage',
                    },
                ],
                description:
                    'At the end of the round, if not hit, there is a 20% chance to gain Speed Up 3 for 2 turns',
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'crit',
                        value: 5,
                        type: 'percentage',
                    },
                    {
                        name: 'critDamage',
                        value: 6,
                        type: 'percentage',
                    },
                ],
                description:
                    'At the end of the round, if not hit, there is a 12% chance to gain Speed Up 3 for 2 turns',
            },
        ],
        imageKey: 'alacrity-Photoroom',
    },
    AMBUSH: {
        name: 'Ambush',
        type: 'major',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'critDamage',
                        value: 10,
                        type: 'percentage',
                        min: 10,
                        max: 15,
                    },
                    {
                        name: 'defence',
                        value: 341,
                        type: 'flat',
                        min: 341,
                        max: 371,
                    },
                ],
                description:
                    'At the start of the round, if in stealth, there is a 12% chance to gain Crit Power Up 3 for 1 turn.',
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'critDamage',
                        value: 9,
                        type: 'percentage',
                    },
                    {
                        name: 'defence',
                        value: 223,
                        type: 'flat',
                    },
                ],
                description:
                    'At the start of the round, if in stealth, there is a 9% chance to gain Crit Power Up 3 for 1 turn.',
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'critDamage',
                        value: 5,
                        type: 'percentage',
                        min: 5,
                        max: 6,
                    },
                    {
                        name: 'defence',
                        value: 132,
                        type: 'flat',
                        min: 132,
                        max: 137,
                    },
                ],
                description:
                    'At the start of the round, if in stealth, there is a 7% chance to gain Crit Power Up 3 for 1 turn.',
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'critDamage',
                        value: 4,
                        type: 'percentage',
                    },
                    {
                        name: 'defence',
                        value: 59,
                        type: 'flat',
                    },
                ],
                description:
                    'At the start of the round, if in stealth, there is a 5% chance to gain Crit Power Up 3 for 1 turn',
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'critDamage',
                        value: 20,
                        type: 'percentage',
                        min: 18,
                        max: 20,
                    },
                    {
                        name: 'defence',
                        value: 495,
                        type: 'flat',
                        min: 483,
                        max: 545,
                    },
                ],
                description:
                    'At the start of a round, if this unit has Stealth, there is a 16% chance to gain Crit Power Up 3 for 1 turn.',
            },
        ],
        imageKey: 'ambush-Photoroom',
    },
    BATTLECRY: {
        name: 'Battlecry',
        type: 'major',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'defence',
                        value: 206,
                        type: 'flat',
                        min: 206,
                        max: 245,
                    },
                    {
                        name: 'defence',
                        value: 7,
                        type: 'percentage',
                        min: 7,
                        max: 9,
                    },
                ],
                description: 'Upon death, grans all allies Inc. Damage Down II for 2 turns',
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'defence',
                        value: 3,
                        type: 'percentage',
                    },
                    {
                        name: 'defence',
                        value: 56,
                        type: 'flat',
                    },
                ],
                description: 'Upon death, grans all allies Inc. Damage Down II for 1 turns',
            },
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
        imageKey: 'battlecry-Photoroom',
    },
    BLOODTHIRST: {
        name: 'Bloodthirst',
        type: 'major',
        variants: [
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'critDamage',
                        value: 5,
                        type: 'percentage',
                    },
                    {
                        name: 'attack',
                        value: 92,
                        type: 'flat',
                    },
                ],
                description:
                    'On a critical hit, there is a 12% chance for this unit to repair itself for 12% of the damage dealt',
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'critDamage',
                        value: 11,
                        type: 'percentage',
                        min: 11,
                        max: 15,
                    },
                    {
                        name: 'attack',
                        value: 230,
                        type: 'flat',
                        min: 230,
                        max: 262,
                    },
                ],
                description:
                    'On a critical hit, there is a 17% chance for this unit to repair itself for 17% of the damage dealt',
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'critDamage',
                        value: 15,
                        type: 'percentage',
                        min: 16,
                        max: 20,
                    },
                    { name: 'attack', value: 340, type: 'flat', min: 340, max: 400 },
                ],
                description:
                    'On a critical hit, there is a 20% chance for this unit to repair itself for 20% of the damage dealt',
            },
        ],
        imageKey: 'bloodthirst-Photoroom',
    },
    BULWARK: {
        name: 'Bulwark',
        type: 'major',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    { name: 'security', value: 11, type: 'flat' },
                    { name: 'hp', value: 1301, type: 'flat', min: 1207, max: 1301 },
                ],
                description:
                    'There is a 12% chance, when an adjacent ally is directly damaged, to apply Provoke to that enemy for 1 turn, once per round.',
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'hp',
                        value: 211,
                        type: 'flat',
                    },
                    {
                        name: 'security',
                        value: 2,
                        type: 'flat',
                    },
                ],
                description:
                    'There is a 5% chance, when an adjacent ally is directly damaged, to apply Provoke to that enemy for 1 turn. Once per round.',
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'hp',
                        value: 844,
                        type: 'flat',
                        min: 844,
                        max: 930,
                    },
                    {
                        name: 'security',
                        value: 7,
                        type: 'flat',
                        min: 7,
                        max: 9,
                    },
                ],
                description:
                    'There is a 9% chance, when an adjacent ally is directly damaged, to apply Provoke to that enemy for 1 turn. Once per round.',
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'hp',
                        value: 1886,
                        type: 'flat',
                        min: 1886,
                        max: 2093,
                    },
                    {
                        name: 'security',
                        value: 21,
                        type: 'flat',
                        min: 20,
                        max: 23,
                    },
                ],
                description:
                    'There is a 16% chance, when an adjacent ally is directly damaged, to apply Provoke to that enemy for 1 turn. Once per round.',
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'security',
                        value: 5,
                        type: 'flat',
                        min: 5,
                        max: 5,
                    },
                    {
                        name: 'hp',
                        value: 474,
                        type: 'flat',
                        min: 474,
                        max: 504,
                    },
                ],
                description:
                    'There is a 7% chance, when an adjacent ally is directly damaged, to apply Provoke to that enemy for 1 turn. Once per round.',
            },
        ],
        imageKey: 'bulwark-Photoroom',
    },
    DOOMSAYER: {
        name: 'Doomsayer',
        type: 'major',
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
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'critDamage',
                        value: 7,
                        type: 'percentage',
                        min: 7,
                        max: 8,
                    },
                    {
                        name: 'hacking',
                        value: 10,
                        type: 'flat',
                        min: 10,
                        max: 10,
                    },
                ],
                description:
                    'At the end of the round, if this unit was the first to activate, there is a 9% chance to apply Concentrate Fire to the enemy with the highest attack for 1 turn',
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'hacking',
                        value: 5,
                        type: 'flat',
                        min: 5,
                        max: 5,
                    },
                    {
                        name: 'critDamage',
                        value: 5,
                        type: 'percentage',
                        min: 5,
                        max: 6,
                    },
                ],
                description:
                    'At the end of the round, if this unit was the first to activate, there is a 7% chance to apply Concentrate Fire to the enemy with the highest attack for 1 turn',
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'critDamage',
                        value: 10,
                        type: 'percentage',
                        min: 10,
                        max: 15,
                    },
                    {
                        name: 'hacking',
                        value: 14,
                        type: 'flat',
                        min: 11,
                        max: 16,
                    },
                ],
                description:
                    'At the end of the round, if this unit was the first to activate, there is a 12% chance to apply Concentrate Fire to the enemy with the highest attack for 1 turn',
            },
        ],
        imageKey: 'doomsayer-Photoroom',
    },
    EXUBERANCE: {
        name: 'Exuberance',
        type: 'major',
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
                    {
                        name: 'defence',
                        value: 8,
                        type: 'percentage',
                        min: 8,
                        max: 8,
                    },
                    {
                        name: 'speed',
                        value: 6,
                        type: 'flat',
                        min: 6,
                        max: 7,
                    },
                ],
                description: 'When repaired, there is a 20% chance to increase that repair by 13%',
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
                    {
                        name: 'defence',
                        value: 18,
                        type: 'percentage',
                        min: 17,
                        max: 20,
                    },
                    {
                        name: 'speed',
                        value: 12,
                        type: 'flat',
                        min: 12,
                        max: 16,
                    },
                ],
                description: 'When repaired, there is a 30% chance to increase that repair by 15%',
            },
        ],
        imageKey: 'exuberance-Photoroom',
    },
    FIREWALL: {
        name: 'Firewall',
        type: 'major',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'attack',
                        value: 244,
                        type: 'flat',
                        min: 226,
                        max: 264,
                    },
                    {
                        name: 'security',
                        value: 12,
                        type: 'flat',
                        min: 12,
                        max: 16,
                    },
                ],
                description: 'When debuffed, there is a 12% chance to gain Block Debuff for 1 turn',
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'attack',
                        value: 372,
                        type: 'flat',
                        min: 372,
                        max: 395,
                    },
                    {
                        name: 'security',
                        value: 21,
                        type: 'flat',
                        min: 21,
                        max: 24,
                    },
                ],
                description: 'When debuffed, there is a 15% chance to gain Block Debuff for 1 turn',
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'security',
                        value: 5,
                        type: 'flat',
                    },
                    {
                        name: 'attack',
                        value: 86,
                        type: 'flat',
                    },
                ],
                description: 'When debuffed, there is an 8% chance to gain Block Debuff for 1 turn',
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'security',
                        value: 9,
                        type: 'flat',
                    },
                    {
                        name: 'attack',
                        value: 147,
                        type: 'flat',
                    },
                ],
                description: 'When debuffed, there is a 10% chance to gain Block Debuff for 1 turn',
            },
        ],
        imageKey: 'firewall-Photoroom',
    },
    FONT_OF_POWER: {
        name: 'Font of Power',
        type: 'major',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'crit',
                        value: 9,
                        type: 'percentage',
                        min: 9,
                        max: 9,
                    },
                    {
                        name: 'hp',
                        value: 894,
                        type: 'flat',
                        min: 894,
                        max: 928,
                    },
                ],
                description:
                    "When applying repair to another ally, there's a 9% chance to grand Power Infused Nanobots for 1 turn",
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'hp', value: 1886, type: 'flat' },
                    { name: 'crit', value: 20, type: 'percentage' },
                ],
                description:
                    'When applying repair to another ally, there is a 16% chance to grant Power Infused Nanobots for 1 turn.',
            },
            {
                rarity: 'epic',
                stats: [
                    { name: 'hp', value: 1200, type: 'flat', min: 1200, max: 1440 },
                    { name: 'crit', value: 10, type: 'percentage', min: 10, max: 15 },
                ],
                description:
                    'When applying repair to another ally, there is a 12% chance to grant Power Infused Nanobots for 1 turn.',
            },
        ],
        imageKey: 'fontofpower-Photoroom',
    },
    FORTIFYING_SHROUD: {
        name: 'Fortifying Shroud',
        type: 'major',
        variants: [
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'defence',
                        value: 574,
                        type: 'flat',
                        min: 468,
                        max: 574,
                    },
                    {
                        name: 'hp',
                        value: 20,
                        type: 'percentage',
                        min: 17,
                        max: 22,
                    },
                ],
                description:
                    'Every turn, there is a 32% chance to grant all adjacent allies Defense Up 1 for 1 turn',
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'defence',
                        value: 356,
                        type: 'flat',
                    },
                    {
                        name: 'hp',
                        value: 12,
                        type: 'percentage',
                    },
                ],
                description:
                    'Every turn, there is a 26% chance to grant all adjacent allies Defense Up 1 for 1 turn',
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'hp',
                        value: 8,
                        type: 'percentage',
                        min: 8,
                        max: 9,
                    },
                    {
                        name: 'defence',
                        value: 210,
                        type: 'flat',
                        min: 210,
                        max: 250,
                    },
                ],
                description:
                    'Every turn, there is a 21% chance to grant all adjacent allies Defense Up 1 for 1 turn',
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'hp',
                        value: 6,
                        type: 'percentage',
                    },
                    {
                        name: 'defence',
                        value: 126,
                        type: 'flat',
                    },
                ],
                description:
                    'Every turn, there is a 18% chance to grant all adjacent allies Defense Up 1 for 1 turn',
            },
        ],
        imageKey: 'fortifyingshroud-Photoroom',
    },
    GIANT_SLAYER: {
        name: 'Giant Slayer',
        type: 'major',
        variants: [
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'critDamage',
                        value: 5,
                        type: 'percentage',
                        min: 5,
                        max: 6,
                    },
                    {
                        name: 'speed',
                        value: 4,
                        type: 'flat',
                        min: 4,
                        max: 5,
                    },
                ],
                description:
                    "When directly damaging an enemy with a higher attack, there's a 12% chance to increase that damage by 50%",
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'critDamage',
                        value: 19,
                        type: 'percentage',
                        min: 18,
                        max: 19,
                    },
                    {
                        name: 'speed',
                        value: 11,
                        type: 'flat',
                        min: 11,
                        max: 14,
                    },
                ],
                description:
                    "When directly damaging an enemy with a higher attack, there's a 20% chance to increase that damage by 50%",
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'critDamage',
                        value: 7,
                        type: 'percentage',
                        min: 7,
                        max: 8,
                    },
                    {
                        name: 'speed',
                        value: 6,
                        type: 'flat',
                        min: 6,
                        max: 7,
                    },
                ],
                description:
                    "When directly damaging an enemy with a higher attack, there's a 14% chance to increase that damage by 50%",
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'critDamage',
                        value: 11,
                        type: 'percentage',
                        min: 10,
                        max: 15,
                    },
                    {
                        name: 'speed',
                        value: 8,
                        type: 'flat',
                        min: 8,
                        max: 10,
                    },
                ],
                description:
                    "When directly damaging an enemy with a higher attack, there's a 16% chance to increase that damage by 50%",
            },
        ],
        imageKey: 'giantslayer-Photoroom',
    },
    INSIDIOUSNESS: {
        name: 'Insidiousness',
        type: 'major',
        variants: [
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'crit',
                        value: 5,
                        type: 'percentage',
                        min: 5,
                        max: 6,
                    },
                    {
                        name: 'hacking',
                        value: 5,
                        type: 'flat',
                        min: 5,
                        max: 6,
                    },
                ],
                description: 'When debuffing an enemy, there is a 12% chance to deal 70% damage.',
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'crit',
                        value: 7,
                        type: 'percentage',
                        min: 7,
                        max: 8,
                    },
                    {
                        name: 'hacking',
                        value: 7,
                        type: 'flat',
                        min: 7,
                        max: 9,
                    },
                ],
                description: 'When debuffing an enemy, there is a 14% chance to deal 80% damage',
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'crit',
                        value: 19,
                        type: 'percentage',
                    },
                    {
                        name: 'hacking',
                        value: 18,
                        type: 'flat',
                        min: 18,
                        max: 23,
                    },
                ],
                description: 'When debuffing an enemy, there is a 21% chance to deal 100% damage.',
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'crit',
                        value: 3,
                        type: 'percentage',
                    },
                    {
                        name: 'hacking',
                        value: 3,
                        type: 'flat',
                    },
                ],
                description: 'When debuffing an enemy, there is a 10% chance to deal 60% damage',
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'hacking',
                        value: 12,
                        type: 'flat',
                        min: 12,
                        max: 15,
                    },
                    {
                        name: 'crit',
                        value: 15,
                        type: 'percentage',
                        min: 14,
                        max: 15,
                    },
                ],
                description: 'When debuffing an enemy, there is a 17% chance to deal 90% damage.',
            },
        ],
        imageKey: 'insidiousness-Photoroom',
    },
    IRONCLAD: {
        name: 'Ironclad',
        type: 'major',
        variants: [
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'hacking',
                        value: 4,
                        type: 'flat',
                    },
                    {
                        name: 'security',
                        value: 4,
                        type: 'flat',
                    },
                ],
                description:
                    'When directly damaged for the second and subsequent times in a round, there is a 10% chance to block 30% of the damage',
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'hacking',
                        value: 9,
                        type: 'flat',
                    },
                    {
                        name: 'security',
                        value: 9,
                        type: 'flat',
                    },
                ],
                description:
                    'When directly damaged for the second and subsequent times in a round, there is a 14% chance to block 40% of the damage',
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'hacking',
                        value: 15,
                        type: 'flat',
                    },
                    {
                        name: 'security',
                        value: 14,
                        type: 'flat',
                        min: 14,
                        max: 16,
                    },
                ],
                description:
                    'When directly damaged for the second and subsequent times in a round, there is a 16% chance to block 45% of the damage',
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'hacking',
                        value: 19,
                        type: 'flat',
                        min: 19,
                        max: 24,
                    },
                    {
                        name: 'security',
                        value: 22,
                        type: 'flat',
                        min: 21,
                        max: 23,
                    },
                ],
                description:
                    'When directly damaged for the second and subsequent times in a round, there is a 20% chance to block 50% of the damage',
            },
        ],
        imageKey: 'ironclad-Photoroom',
    },
    LAST_STAND: {
        name: 'Last Stand',
        type: 'major',
        variants: [
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'attack',
                        value: 348,
                        type: 'flat',
                        min: 348,
                        max: 367,
                    },
                    {
                        name: 'defence',
                        value: 482,
                        type: 'flat',
                        min: 482,
                        max: 501,
                    },
                ],
                description:
                    'When this unit becomes the last one standing, there is a 32% chance to gain Block Damage and Block Debuff for 1 turn',
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'attack',
                        value: 99,
                        type: 'flat',
                    },
                    {
                        name: 'defence',
                        value: 122,
                        type: 'flat',
                    },
                ],
                description:
                    'When this unit becomes the last one standing, there is a 18% chance to gain Block Damage and Block Debuff for 1 turn',
            },
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
        imageKey: 'laststand-Photoroom',
    },
    LAST_WISH: {
        name: 'Last Wish',
        type: 'major',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'attack',
                        value: 155,
                        type: 'flat',
                    },
                    {
                        name: 'defence',
                        value: 8,
                        type: 'percentage',
                    },
                ],
                description: "Upon death, repairs 19% of all allies' max HP.",
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'defence',
                        value: 5,
                        type: 'percentage',
                    },
                    {
                        name: 'attack',
                        value: 100,
                        type: 'flat',
                    },
                ],
                description: "Upon death, repairs 14% of all allies' max HP",
            },
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
        imageKey: 'lastwish-Photoroom',
    },
    LOCKDOWN: {
        name: 'Lockdown',
        type: 'major',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'defence',
                        value: 204,
                        type: 'flat',
                        min: 204,
                        max: 249,
                    },
                    {
                        name: 'security',
                        value: 8,
                        type: 'flat',
                        min: 8,
                        max: 10,
                    },
                ],
                description:
                    'When resisting a debuff, there is a 9% chance to grant Buff Protection to all allies for 1 turn',
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'security',
                        value: 5,
                        type: 'flat',
                        min: 5,
                        max: 6,
                    },
                    {
                        name: 'defence',
                        value: 130,
                        type: 'flat',
                        min: 130,
                        max: 135,
                    },
                ],
                description:
                    'When resisting a debuff, there is a 7% chance to grant Buff Protection to all allies for 1 turn',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'defence', value: 574, type: 'flat' },
                    { name: 'security', value: 23, type: 'flat' },
                ],
                description:
                    'When resisting a debuff, there is a 16% chance to grant Buff Protection to all allies for 1 turn.',
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'security',
                        value: 2,
                        type: 'flat',
                    },
                    {
                        name: 'defence',
                        value: 68,
                        type: 'flat',
                    },
                ],
                description:
                    'When resisting a debuff, there is a 5% chance to grant Buff Protection to all allies for 1 turn',
            },
            {
                rarity: 'epic',
                stats: [
                    { name: 'defence', value: 340, type: 'flat', min: 340, max: 400 },
                    { name: 'security', value: 11, type: 'flat', min: 11, max: 16 },
                ],
                description:
                    'When resisting a debuff, there is a 12% chance to grant Buff Protection to all allies for 1 turn.',
            },
        ],
        imageKey: 'lockdown-Photoroom',
    },
    MENACE: {
        name: 'Menace',
        type: 'major',
        variants: [
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'crit',
                        value: 3,
                        type: 'percentage',
                        min: 3,
                        max: 4,
                    },
                    {
                        name: 'attack',
                        value: 4,
                        type: 'percentage',
                        min: 3,
                        max: 4,
                    },
                ],
                description:
                    'When critically damaging an enemy, there is an 8% chance to increase that damage by 20%',
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'attack',
                        value: 5,
                        type: 'percentage',
                        min: 5,
                        max: 6,
                    },
                    {
                        name: 'crit',
                        value: 5,
                        type: 'percentage',
                        min: 5,
                        max: 6,
                    },
                ],
                description:
                    'When critically damaging an enemy, there is a 9% chance to increase that damage by 25%.',
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'attack',
                        value: 15,
                        type: 'percentage',
                        min: 10,
                        max: 15,
                    },
                    {
                        name: 'crit',
                        value: 12,
                        type: 'percentage',
                        min: 10,
                        max: 15,
                    },
                ],
                description:
                    'When critically damaging an enemy, there is an 11% chance to increase that damage by 35%',
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'attack',
                        value: 7,
                        type: 'percentage',
                        min: 7,
                        max: 8,
                    },
                    {
                        name: 'crit',
                        value: 7,
                        type: 'percentage',
                        min: 7,
                        max: 8,
                    },
                ],
                description:
                    'When critically damaging an enemy, there is a 10% chance to icnreawse that damage by 30%',
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'crit',
                        value: 16,
                        type: 'percentage',
                        min: 16,
                        max: 19,
                    },
                    {
                        name: 'attack',
                        value: 19,
                        type: 'percentage',
                        min: 17,
                        max: 19,
                    },
                ],
                description:
                    'When critically damaging an enemy, there is an 12% chance to increase that damage by 45%',
            },
        ],
        imageKey: 'menace-Photoroom',
    },
    REACTIVE_WARD: {
        name: 'Reactive Ward',
        type: 'major',
        variants: [
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'attack',
                        value: 5,
                        type: 'percentage',
                        min: 5,
                        max: 6,
                    },
                    {
                        name: 'hp',
                        value: 471,
                        type: 'flat',
                        min: 471,
                        max: 508,
                    },
                ],
                description:
                    'When directly damaged, there is a 7% chance to cleanse 1 debuff, but if the hit was a critical, 2 debuffs are cleansed instead.',
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'attack',
                        value: 12,
                        type: 'percentage',
                        min: 12,
                        max: 14,
                    },
                    {
                        name: 'hp',
                        value: 1205,
                        type: 'flat',
                        min: 1205,
                        max: 1411,
                    },
                ],
                description:
                    'When directly damaged, there  is a 12% chance to cleanse 1 debuff, but if the hit was a critical, 2 debuff are cleansed instead. ',
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'attack',
                        value: 17,
                        type: 'percentage',
                        min: 17,
                        max: 20,
                    },
                    {
                        name: 'hp',
                        value: 2102,
                        type: 'flat',
                        min: 2088,
                        max: 2102,
                    },
                ],
                description:
                    'When directly damaged, there  is a 16% chance to cleanse 1 debuff, but if the hit was a critical, 2 debuff are cleansed instead . ',
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'hp',
                        value: 252,
                        type: 'flat',
                    },
                    {
                        name: 'attack',
                        value: 3,
                        type: 'percentage',
                    },
                ],
                description:
                    'When directly damaged, there is a 5% chance to cleanse 1 debuff, but if the hit was a critical, 2 debuffs are cleansed instead',
            },
        ],
        imageKey: 'reactiveward-Photoroom',
    },
    RESONATING_FURY: {
        name: 'Resonating Fury',
        type: 'major',
        variants: [
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'critDamage',
                        value: 5,
                        type: 'percentage',
                        min: 5,
                        max: 6,
                    },
                    {
                        name: 'attack',
                        value: 5,
                        type: 'percentage',
                        min: 5,
                        max: 6,
                    },
                ],
                description:
                    'When applying a shield, there is a 7% chance to grant Crit Power Up 3 for 1 turn',
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'attack',
                        value: 8,
                        type: 'percentage',
                        min: 8,
                        max: 9,
                    },
                    {
                        name: 'critDamage',
                        value: 7,
                        type: 'percentage',
                        min: 7,
                        max: 8,
                    },
                ],
                description:
                    'When applying a shield, there is a 9% chance to grant Crit Power Up 3 for 1 turn',
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'critDamage',
                        value: 20,
                        type: 'percentage',
                    },
                    {
                        name: 'attack',
                        value: 19,
                        type: 'percentage',
                    },
                ],
                description:
                    'When applying a shield, there is a 16% chance to grant Crit Power Up 3 for 1 turn',
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'critDamage',
                        value: 4,
                        type: 'percentage',
                    },
                    {
                        name: 'attack',
                        value: 4,
                        type: 'percentage',
                    },
                ],
                description:
                    'When applying a shield, there is a 5% chance to grant Crit Power Up 3 for 1 turn',
            },
            {
                rarity: 'epic',
                stats: [
                    { name: 'critDamage', value: 15, type: 'percentage', min: 10, max: 15 },
                    { name: 'attack', value: 15, type: 'percentage', min: 10, max: 15 },
                ],
                description:
                    'When applying a shield, there is a 12% chance to grant Crit Power Up 3 for 1 turn',
            },
        ],
        imageKey: 'resonatingfury-Photoroom',
    },
    SECOND_WIND: {
        name: 'Second Wind',
        type: 'major',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'crit',
                        value: 11,
                        type: 'percentage',
                        min: 11,
                        max: 13,
                    },
                    {
                        name: 'defence',
                        value: 11,
                        type: 'percentage',
                        min: 11,
                        max: 14,
                    },
                ],
                description:
                    'Upon receiving critical direct damage, there is a 12% chance to repair 10% of this Unit’s max HP.',
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'crit',
                        value: 7,
                        type: 'percentage',
                    },
                    {
                        name: 'defence',
                        value: 7,
                        type: 'percentage',
                    },
                ],
                description:
                    'Upon receiving critical direct damage, there is a 9% chance to repair 10% of this Unit’s max HP.',
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'crit',
                        value: 5,
                        type: 'percentage',
                        min: 5,
                        max: 6,
                    },
                    {
                        name: 'defence',
                        value: 5,
                        type: 'percentage',
                        min: 5,
                        max: 6,
                    },
                ],
                description:
                    "Upon receiveing critical direct damage, there is a 7% chance to repair 10% of this unit's max HP",
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'crit',
                        value: 19,
                        type: 'percentage',
                        min: 17,
                        max: 20,
                    },
                    {
                        name: 'defence',
                        value: 20,
                        type: 'percentage',
                        min: 16,
                        max: 20,
                    },
                ],
                description:
                    "Upon recieving critical direct damage, there is a 16% chance to repair 10% of this Unit's Max HP",
            },
        ],
        imageKey: 'secondwind-Photoroom',
    },
    SHADOWGUARD: {
        name: 'Shadowguard',
        type: 'major',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'hp',
                        value: 12,
                        type: 'percentage',
                        min: 11,
                        max: 14,
                    },
                    {
                        name: 'speed',
                        value: 8,
                        type: 'flat',
                        min: 8,
                        max: 10,
                    },
                ],
                description:
                    'When directly damaged while in stealth, there is a 12% chance to block the damage, limited to once per round',
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'hp',
                        value: 6,
                        type: 'percentage',
                        min: 6,
                        max: 7,
                    },
                    {
                        name: 'speed',
                        value: 4,
                        type: 'flat',
                        min: 4,
                        max: 5,
                    },
                ],
                description:
                    'When directly damaged while in stealth, there is a 7% chance to block the damage, limited to once per round',
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'hp', value: 16, type: 'percentage', min: 16, max: 20 },
                    { name: 'speed', value: 11, type: 'flat', min: 11, max: 16 },
                ],
                description:
                    'When directly damaged while in stealth, there is a 16% chance to block the damage, limited to once per round',
            },
        ],
        imageKey: 'shadowguard-Photoroom',
    },
    SMOKESCREEN: {
        name: 'Smokescreen',
        type: 'major',
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
                    {
                        name: 'attack',
                        value: 16,
                        type: 'percentage',
                        min: 16,
                        max: 17,
                    },
                    {
                        name: 'speed',
                        value: 13,
                        type: 'flat',
                        min: 11,
                        max: 13,
                    },
                ],
                description:
                    'When directly damaged, there is a 16% change to gain Stealth for 1 turn. ',
            },
        ],
        imageKey: 'smokescreen-Photoroom',
    },
    SPEARHEAD: {
        name: 'Spearhead',
        type: 'major',
        variants: [
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'hacking',
                        value: 23,
                        type: 'flat',
                        min: 21,
                        max: 24,
                    },
                    {
                        name: 'hp',
                        value: 18,
                        type: 'percentage',
                        min: 17,
                        max: 18,
                    },
                ],
                description:
                    'After using the charged skill, there is a 32% chance to grant all allies Attack Up 1 for 1 turn.',
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'hacking',
                        value: 9,
                        type: 'flat',
                        min: 8,
                        max: 10,
                    },
                    {
                        name: 'hp',
                        value: 9,
                        type: 'percentage',
                        min: 7,
                        max: 9,
                    },
                ],
                description:
                    'After using the charged skill, there is a 21% chance to grant all allies Attack Up 1 for 1 Turn',
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'hp',
                        value: 12,
                        type: 'percentage',
                    },
                    {
                        name: 'hacking',
                        value: 13,
                        type: 'flat',
                    },
                ],
                description:
                    'After using the charged skill, there is a 26% chance to grant all allies Attack Up 1 for 1 turn.',
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'hp',
                        value: 3,
                        type: 'percentage',
                    },
                    {
                        name: 'hacking',
                        value: 3,
                        type: 'flat',
                    },
                ],
                description:
                    'After using the charged skill, there is a 15% chance to grant all allies Attack Up 1 for 1 Turn',
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'hp',
                        value: 6,
                        type: 'percentage',
                    },
                    {
                        name: 'hacking',
                        value: 5,
                        type: 'flat',
                    },
                ],
                description:
                    'After using the charged skill, there is a 18% chance to grant all allies Attack Up 1 for 1 Turn',
            },
        ],
        imageKey: 'spearhead-Photoroom',
    },
    TENACITY: {
        name: 'Tenacity',
        type: 'major',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'defence',
                        value: 8,
                        type: 'percentage',
                        min: 8,
                        max: 9,
                    },
                    {
                        name: 'security',
                        value: 7,
                        type: 'flat',
                        min: 7,
                        max: 9,
                    },
                ],
                description:
                    "Upon directly receiving damage exceeding 25% of max HP, there's a 10% chance to grant Buff Protection to all allies for 2 turns",
            },
            {
                rarity: 'legendary',
                stats: [
                    { name: 'security', value: 21, type: 'flat' },
                    { name: 'defence', value: 20, type: 'percentage' },
                ],
                description:
                    'Upon directly recieving damage exceeding 25% of max HP, there is a 16% chance to grant Buff Protection to all allies for 2 turns.',
            },
            {
                rarity: 'epic',
                stats: [
                    { name: 'security', value: 15, type: 'flat', min: 10, max: 15 },
                    { name: 'defence', value: 15, type: 'percentage', min: 11, max: 16 },
                ],
                description:
                    'Upon directly receiving damage exceeding 25% of max HP, there is a 12% chance to grant Buff Protection to all allies for 2 turns.',
            },
        ],
        imageKey: 'tenacity-Photoroom',
    },
    VIVACIOUS_REPAIR: {
        name: 'Vivacious Repair',
        type: 'major',
        variants: [
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'hp',
                        value: 1795,
                        type: 'flat',
                        min: 1795,
                        max: 2126,
                    },
                    {
                        name: 'hp',
                        value: 17,
                        type: 'percentage',
                        min: 17,
                        max: 20,
                    },
                ],
                description:
                    'When repairing an ally with less than 25% HP, there is a 32% chance to double the amount of repair',
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'hp',
                        value: 12,
                        type: 'percentage',
                    },
                    {
                        name: 'hp',
                        value: 1286,
                        type: 'flat',
                        min: 1286,
                        max: 1342,
                    },
                ],
                description:
                    'When repairing an ally with less that 25% HP, there is a 26% chance to double the amount of repair',
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'hp',
                        value: 8,
                        type: 'percentage',
                        min: 8,
                        max: 8,
                    },
                    {
                        name: 'hp',
                        value: 870,
                        type: 'flat',
                        min: 870,
                        max: 916,
                    },
                ],
                description:
                    'When repairing an ally with less than 25% HP, there is a 21% chance to double the amount of repair.',
            },
        ],
        imageKey: 'vivaciousrepair-Photoroom',
    },
    BARRIER: {
        name: 'Barrier',
        type: 'gamma(minor)',
        variants: [
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'defence',
                        value: 4,
                        type: 'percentage',
                        min: 4,
                        max: 5,
                    },
                ],
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'defence',
                        value: 9,
                        type: 'percentage',
                        min: 9,
                        max: 12,
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'defence',
                        value: 14,
                        type: 'percentage',
                        min: 14,
                        max: 15,
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'defence',
                        value: 6,
                        type: 'percentage',
                        min: 6,
                        max: 8,
                    },
                ],
            },
        ],
        imageKey: 'barrier-Photoroom',
    },
    OVERRIDE: {
        name: 'Override',
        type: 'gamma(minor)',
        variants: [
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'hacking',
                        value: 3,
                        type: 'flat',
                        min: 3,
                        max: 3,
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'hacking',
                        value: 6,
                        type: 'flat',
                        min: 6,
                        max: 7,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'hacking',
                        value: 4,
                        type: 'flat',
                        min: 4,
                        max: 5,
                    },
                ],
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'hacking',
                        value: 8,
                        type: 'flat',
                        min: 8,
                        max: 9,
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'hacking',
                        value: 11,
                        type: 'flat',
                        min: 10,
                        max: 12,
                    },
                ],
            },
        ],
        imageKey: 'overridegamma-Photoroom',
    },
    OVERRIDE_ALPHA: {
        name: 'Override',
        type: 'alpha(minor)',
        variants: [
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'hacking',
                        value: 6,
                        type: 'flat',
                        min: 6,
                        max: 7,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'hacking',
                        value: 4,
                        type: 'flat',
                        min: 4,
                        max: 5,
                    },
                ],
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'hacking',
                        value: 3,
                        type: 'flat',
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'hacking',
                        value: 11,
                        type: 'flat',
                        min: 10,
                        max: 12,
                    },
                ],
            },
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'hacking',
                        value: 8,
                        type: 'flat',
                        min: 8,
                        max: 9,
                    },
                ],
            },
        ],
        imageKey: 'overridealpha-Photoroom',
    },
    BASTION: {
        name: 'Bastion',
        type: 'alpha(minor)',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'hp',
                        value: 9,
                        type: 'percentage',
                        min: 9,
                        max: 12,
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'hp',
                        value: 13,
                        type: 'percentage',
                        min: 13,
                        max: 15,
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'hp',
                        value: 6,
                        type: 'percentage',
                        min: 6,
                        max: 8,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'hp',
                        value: 4,
                        type: 'percentage',
                        min: 4,
                        max: 5,
                    },
                ],
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'hp',
                        value: 3,
                        type: 'percentage',
                    },
                ],
            },
        ],
        imageKey: 'bastion-Photoroom',
    },
    DEVASTATION: {
        name: 'Devastation',
        type: 'alpha(minor)',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'critDamage',
                        value: 9,
                        type: 'percentage',
                        min: 9,
                        max: 11,
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'critDamage',
                        value: 6,
                        type: 'percentage',
                        min: 6,
                        max: 8,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'critDamage',
                        value: 5,
                        type: 'percentage',
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'critDamage',
                        value: 13,
                        type: 'percentage',
                        min: 13,
                        max: 16,
                    },
                ],
            },
        ],
        imageKey: 'devastationalpha-Photoroom',
    },
    GUARDIAN: {
        name: 'Guardian',
        type: 'alpha(minor)',
        variants: [
            {
                rarity: 'epic',
                stats: [
                    {
                        name: 'defence',
                        value: 284,
                        type: 'flat',
                        min: 284,
                        max: 327,
                    },
                ],
            },
            {
                rarity: 'legendary',
                stats: [
                    {
                        name: 'defence',
                        value: 402,
                        type: 'flat',
                        min: 402,
                        max: 474,
                    },
                ],
            },
            {
                rarity: 'rare',
                stats: [
                    {
                        name: 'defence',
                        value: 170,
                        type: 'flat',
                        min: 170,
                        max: 206,
                    },
                ],
            },
            {
                rarity: 'uncommon',
                stats: [
                    {
                        name: 'defence',
                        value: 103,
                        type: 'flat',
                        min: 103,
                        max: 119,
                    },
                ],
            },
            {
                rarity: 'common',
                stats: [
                    {
                        name: 'defence',
                        value: 49,
                        type: 'flat',
                    },
                ],
            },
        ],
        imageKey: 'guardian-Photoroom',
    },
};

export default IMPLANTS;

export type ImplantName = keyof typeof IMPLANTS;

export const IMPLANT_SLOTS = {
    implant_major: {
        label: 'Major',
    },
    implant_minor_alpha: {
        label: 'Alpha',
    },
    implant_minor_gamma: {
        label: 'Gamma',
    },
    implant_minor_sigma: {
        label: 'Sigma',
    },
    implant_ultimate: {
        label: 'Ultimate',
    },
};
