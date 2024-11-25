import { GearSetBonus, Stat } from '../types/gear';

export const GEAR_SETS: Record<string, GearSetBonus> = {
    FORTITUDE: {
        name: 'Fortitude',
        stats: [
            { name: 'hp', value: 15, type: 'percentage' },
        ]
    },
    ATTACK: {
        name: 'Attack',
        stats: [
            { name: 'attack', value: 15, type: 'percentage' }
        ]
    },
    DEFENSE: {
        name: 'Defense',
        stats: [
            { name: 'defence', value: 15, type: 'percentage' }
        ]
    },
    SPEED: {
        name: 'Speed',
            stats: [
            { name: 'speed', value: 15, type: 'percentage' },
        ]
    },
    HACKING: {
        name: 'Hacking',
        stats: [
            { name: 'hacking', value: 30, type: 'flat' },
        ]
    },
    PROTECTION: {
        name: 'Protection',
        stats: [
            { name: 'security', value: 20, type: 'flat' },
            { name: 'defence', value: 10, type: 'percentage' },
        ]
    },
    AMBUSH: {
        name: 'Ambush',
        stats: [
            { name: 'attack', value: 10, type: 'percentage' },
            { name: 'speed', value: 5, type: 'percentage' },
        ]
    },
    CRITICAL: {
        name: 'Critical',
        stats: [
            { name: 'crit', value: 5, type: 'percentage' },
            { name: 'critDamage', value: 10, type: 'percentage' },
        ]
    },
    REPAIR: {
        name: 'Repair',
        stats: [
            { name: 'healModifier', value: 20, type: 'percentage' },
        ]
    },
    ABYSSAL_ASSAULT: {
        name: 'Abyssal Assault',
        stats: [
            { name: 'attack', value: 15, type: 'percentage' },
            { name: 'critDamage', value: 5, type: 'percentage' },
        ]
    },
    ABYSSAL_SAFEGUARD: {
        name: 'Abyssal Guard',
        stats: [
            { name: 'hp', value: 15, type: 'percentage' },
            { name: 'security', value: 10, type: 'flat' },
        ]
    },
    ABYSSAL_WARD: {
        name: 'Abyssal Ward',
        stats: [
            { name: 'defence', value: 15, type: 'percentage' },
            { name: 'hp', value: 5, type: 'percentage' },
        ]
    },
    ABYSSAL_BREACH: {
        name: 'Abyssal Breach',
        stats: [
            { name: 'hacking', value: 30, type: 'flat' },
            { name: 'crit', value: 5, type: 'percentage' },
        ]
    }
} as const;

export type GearSetName = keyof typeof GEAR_SETS; 