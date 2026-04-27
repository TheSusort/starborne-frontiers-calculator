import type { GearSetBonus } from '../types/gear';
import { ImplantName } from './implants';

export const GEAR_SETS: Record<string, GearSetBonus> = {
    FORTITUDE: {
        name: 'Fortitude',
        stats: [{ name: 'hp', value: 15, type: 'percentage' }],
        iconUrl: '/images/gear-sets/fortitude.webp',
    },
    ATTACK: {
        name: 'Attack',
        stats: [{ name: 'attack', value: 15, type: 'percentage' }],
        iconUrl: '/images/gear-sets/attack.webp',
    },
    DEFENSE: {
        name: 'Defense',
        stats: [{ name: 'defence', value: 15, type: 'percentage' }],
        iconUrl: '/images/gear-sets/defense.webp',
    },
    PROTECTION: {
        name: 'Protection',
        stats: [
            { name: 'defence', value: 10, type: 'percentage' },
            { name: 'security', value: 20, type: 'flat' },
        ],
        iconUrl: '/images/gear-sets/protection.webp',
    },
    AMBUSH: {
        name: 'Ambush',
        stats: [
            { name: 'attack', value: 10, type: 'percentage' },
            { name: 'speed', value: 5, type: 'percentage' },
        ],
        iconUrl: '/images/gear-sets/ambush.webp',
    },
    CRITICAL: {
        name: 'Critical',
        stats: [
            { name: 'crit', value: 5, type: 'percentage' },
            { name: 'critDamage', value: 10, type: 'percentage' },
        ],
        iconUrl: '/images/gear-sets/critical.webp',
    },
    SPEED: {
        name: 'Speed',
        stats: [{ name: 'speed', value: 15, type: 'percentage' }],
        iconUrl: '/images/gear-sets/speed.webp',
    },
    BOOST: {
        name: 'Boost',
        stats: [],
        iconUrl: '/images/gear-sets/boost.webp',
        minPieces: 4,
        description: 'All buffs last an extra turn',
    },
    BURNER: {
        name: 'Burner',
        stats: [{ name: 'attack', value: 15, type: 'percentage' }],
        iconUrl: '/images/gear-sets/burner.webp',
        minPieces: 4,
        description: 'Applies Inferno 1 for 2 turns.',
    },
    DECIMATION: {
        name: 'Decimation',
        stats: [],
        iconUrl: '/images/gear-sets/decimation.webp',
        description: '10% extra DoT damage',
    },
    HACKING: {
        name: 'Hacking',
        stats: [{ name: 'hacking', value: 30, type: 'flat' }],
        iconUrl: '/images/gear-sets/hacking.webp',
    },
    LEECH: {
        name: 'Leech',
        stats: [],
        iconUrl: '/images/gear-sets/leech.webp',
        description: 'Leach 15% from damage dealt',
    },
    REPAIR: {
        name: 'Repair',
        stats: [{ name: 'healModifier', value: 20, type: 'percentage' }],
        iconUrl: '/images/gear-sets/repair.webp',
    },
    REFLECT: {
        name: 'Reflect',
        stats: [],
        iconUrl: '/images/gear-sets/reflect.webp',
        description: 'Reflect 10% of damage dealt',
    },
    REVENGE: {
        name: 'Revenge',
        stats: [],
        iconUrl: '/images/gear-sets/revenge.webp',
    },
    SHIELD: {
        name: 'Shield',
        stats: [{ name: 'shield', value: 4, type: 'percentage' }],
        iconUrl: '/images/gear-sets/shield.webp',
        description: 'Generate 4% shield each turn',
    },
    CLOAKING: {
        name: 'Cloaking',
        stats: [],
        iconUrl: '/images/gear-sets/cloaking.webp',
        description: '2 turns stealth',
    },
    ABYSSAL_ASSAULT: {
        name: 'Abyssal Assault',
        stats: [
            { name: 'attack', value: 15, type: 'percentage' },
            { name: 'critDamage', value: 5, type: 'percentage' },
        ],
        iconUrl: '/images/gear-sets/abyssal_assault.webp',
    },
    ABYSSAL_SAFEGUARD: {
        name: 'Abyssal Safeguard',
        stats: [
            { name: 'hp', value: 15, type: 'percentage' },
            { name: 'security', value: 10, type: 'flat' },
        ],
        iconUrl: '/images/gear-sets/abyssal_safeguard.webp',
    },
    ABYSSAL_WARD: {
        name: 'Abyssal Ward',
        stats: [
            { name: 'defence', value: 15, type: 'percentage' },
            { name: 'hp', value: 5, type: 'percentage' },
        ],
        iconUrl: '/images/gear-sets/abyssal_ward.webp',
    },
    ABYSSAL_BREACH: {
        name: 'Abyssal Breach',
        stats: [
            { name: 'hacking', value: 30, type: 'flat' },
            { name: 'crit', value: 5, type: 'percentage' },
        ],
        iconUrl: '/images/gear-sets/abyssal_breach.webp',
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
        minPieces: 4,
        iconUrl: '/images/gear-sets/omnicore.webp',
    },
    SWIFTNESS: {
        name: 'Swiftness',
        stats: [
            { name: 'speed', value: 15, type: 'percentage' },
            { name: 'hacking', value: 10, type: 'flat' },
        ],
        iconUrl: '/images/gear-sets/swiftness.webp',
    },
    RECOVERY: {
        name: 'Recovery',
        stats: [
            { name: 'hp', value: 10, type: 'percentage' },
            { name: 'healModifier', value: 10, type: 'percentage' },
        ],
        iconUrl: '/images/gear-sets/recovery.webp',
    },
    EXPLOIT: {
        name: 'Exploit',
        stats: [
            { name: 'hacking', value: 20, type: 'flat' },
            { name: 'attack', value: 10, type: 'percentage' },
        ],
        iconUrl: '/images/gear-sets/exploit.webp',
    },
    PIERCER: {
        name: 'Piercer',
        stats: [{ name: 'defensePenetration', value: 7, type: 'percentage' }],
        iconUrl: '/images/gear-sets/piercer.webp',
    },
    HARDENED: {
        name: 'Hardened',
        stats: [{ name: 'damageReduction', value: 5, type: 'percentage' }],
        description: 'Reduces critical damage taken by 5%',
        iconUrl: '/images/gear-sets/hardened.webp',
    },
} satisfies Record<string, GearSetBonus>;

// eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- ImplantName intentionally kept for clarity even though currently subsumed
export type GearSetName = keyof typeof GEAR_SETS | ImplantName;
