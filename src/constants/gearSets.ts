import { GearSetBonus } from '../types/gear';

export const GEAR_SETS: Record<string, GearSetBonus> = {
    FORTITUDE: {
        name: 'Fortitude',
        stats: [{ name: 'hp', value: 15, type: 'percentage' }],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063652031766618.webp',
    },
    ATTACK: {
        name: 'Attack',
        stats: [{ name: 'attack', value: 15, type: 'percentage' }],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063625150468236.webp',
    },
    DEFENSE: {
        name: 'Defense',
        stats: [{ name: 'defence', value: 15, type: 'percentage' }],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063636605116507.webp',
    },
    PROTECTION: {
        name: 'Protection',
        stats: [
            { name: 'defence', value: 10, type: 'percentage' },
            { name: 'security', value: 20, type: 'flat' },
        ],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063640333590609.webp',
    },
    AMBUSH: {
        name: 'Ambush',
        stats: [
            { name: 'attack', value: 10, type: 'percentage' },
            { name: 'speed', value: 5, type: 'percentage' },
        ],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063875424452688.webp',
    },
    CRITICAL: {
        name: 'Critical',
        stats: [
            { name: 'crit', value: 5, type: 'percentage' },
            { name: 'critDamage', value: 10, type: 'percentage' },
        ],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063633668964373.webp',
    },
    SPEED: {
        name: 'Speed',
        stats: [{ name: 'speed', value: 15, type: 'percentage' }],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063621723586580.webp',
    },
    BOOST: {
        name: 'Boost',
        stats: [],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063630842011678.webp',
        minPieces: 4,
        description: 'All buffs lasts an extra turn',
    },
    BURNER: {
        name: 'Burner',
        stats: [{ name: 'attack', value: 15, type: 'percentage' }],
        iconUrl: 'https://cdn.discordapp.com/emojis/1312034712268832808.webp',
        description: 'Applies inferno',
    },
    DECIMATION: {
        name: 'Decimation',
        stats: [],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063643328577546.webp',
        description: '10% extra DoT damage',
    },
    HACKING: {
        name: 'Hacking',
        stats: [{ name: 'hacking', value: 30, type: 'flat' }],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063646541152276.webp',
    },
    LEECH: {
        name: 'Leech',
        stats: [],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063612789858395.webp',
        description: 'Leach 15% from damage dealt',
    },
    REPAIR: {
        name: 'Repair',
        stats: [{ name: 'healModifier', value: 20, type: 'percentage' }],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063614698127410.webp',
    },
    REFLECT: {
        name: 'Reflect',
        stats: [],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063615918546985.webp',
        description: 'Reflect 10% of damage dealt',
    },
    REVENGE: {
        name: 'Revenge',
        stats: [],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063617839800361.webp',
    },
    SHIELD: {
        name: 'Shield',
        stats: [{ name: 'shield', value: 4, type: 'percentage' }],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063619739816037.webp',
        description: 'Generate 4% shield each turn',
    },
    CLOAKING: {
        name: 'Cloaking',
        stats: [],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063623661486090.webp',
        description: '2 turns stealth',
    },
    ABYSSAL_ASSAULT: {
        name: 'Abyssal Assault',
        stats: [
            { name: 'attack', value: 15, type: 'percentage' },
            { name: 'critDamage', value: 5, type: 'percentage' },
        ],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063626899357716.webp',
    },
    ABYSSAL_SAFEGUARD: {
        name: 'Abyssal Safeguard',
        stats: [
            { name: 'hp', value: 15, type: 'percentage' },
            { name: 'security', value: 10, type: 'flat' },
        ],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063611531427850.webp',
    },
    ABYSSAL_WARD: {
        name: 'Abyssal Ward',
        stats: [
            { name: 'defence', value: 15, type: 'percentage' },
            { name: 'hp', value: 5, type: 'percentage' },
        ],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212063876863238214.webp',
    },
    ABYSSAL_BREACH: {
        name: 'Abyssal Breach',
        stats: [
            { name: 'hacking', value: 30, type: 'flat' },
            { name: 'crit', value: 5, type: 'percentage' },
        ],
        iconUrl: 'https://cdn.discordapp.com/emojis/1212064208011657272.webp',
    },
    OMNICORE: {
        name: 'Omnicore',
        stats: [
            { name: 'attack', value: 10, type: 'percentage' },
            { name: 'defence', value: 10, type: 'percentage' },
            { name: 'hacking', value: 10, type: 'percentage' },
            { name: 'security', value: 10, type: 'percentage' },
            { name: 'crit', value: 10, type: 'percentage' },
            { name: 'critDamage', value: 10, type: 'percentage' },
            { name: 'speed', value: 10, type: 'percentage' },
            { name: 'hp', value: 10, type: 'percentage' },
        ],
        iconUrl: 'https://cdn.discordapp.com/emojis/1312034714919505920.webp',
    },
    SWIFTNESS: {
        name: 'Swiftness',
        stats: [
            { name: 'speed', value: 15, type: 'percentage' },
            { name: 'hacking', value: 10, type: 'flat' },
        ],
        iconUrl: 'https://cdn.discordapp.com/emojis/1312034718010834965.webp',
    },
    RECOVERY: {
        name: 'Recovery',
        stats: [
            { name: 'hp', value: 10, type: 'percentage' },
            { name: 'healModifier', value: 10, type: 'percentage' },
        ],
        iconUrl: 'https://cdn.discordapp.com/emojis/1312034716295368785.webp',
    },
    EXPLOIT: {
        name: 'Exploit',
        stats: [
            { name: 'hacking', value: 20, type: 'flat' },
            { name: 'attack', value: 10, type: 'percentage' },
        ],
        iconUrl: 'https://cdn.discordapp.com/emojis/1312034713745227796.webp',
    },
} satisfies Record<string, GearSetBonus>;

export type GearSetName = keyof typeof GEAR_SETS;
