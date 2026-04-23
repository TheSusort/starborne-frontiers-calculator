import { StorageKey } from '../constants/storage';
import { setInIndexedDB, removeFromIndexedDB } from '../hooks/useStorage';
import type { GearPiece } from '../types/gear';
import type { Ship } from '../types/ship';
import type { EngineeringStats } from '../types/stats';

// -----------------------------------------------------------------------------
// Ship IDs (hardcoded UUIDs)
// -----------------------------------------------------------------------------

const SHIP_ID_1 = 'a1b2c3d4-e5f6-4789-ab12-cd34ef567890';
const SHIP_ID_2 = 'b2c3d4e5-f6a7-4890-bc23-de45fa678901';
const SHIP_ID_3 = 'c3d4e5f6-a7b8-4901-cd34-ef56ab789012';
const SHIP_ID_4 = 'd4e5f6a7-b8c9-4012-de45-fa67bc890123';
const SHIP_ID_5 = 'e5f6a7b8-c9d0-4123-ef56-ab78cd901234';

// -----------------------------------------------------------------------------
// Gear IDs (hardcoded UUIDs, grouped by equipped ship)
// -----------------------------------------------------------------------------

// Ship 1 (TERRAN_COMBINE legendary attacker)
const GEAR_S1_WEAPON = '11111111-1111-4111-a111-111111111101';
const GEAR_S1_HULL = '11111111-1111-4111-a111-111111111102';
const GEAR_S1_GENERATOR = '11111111-1111-4111-a111-111111111103';
const GEAR_S1_SENSOR = '11111111-1111-4111-a111-111111111104';
const GEAR_S1_SOFTWARE = '11111111-1111-4111-a111-111111111105';
const GEAR_S1_THRUSTERS = '11111111-1111-4111-a111-111111111106';

// Ship 2 (GELECEK epic defender)
const GEAR_S2_WEAPON = '22222222-2222-4222-a222-222222222201';
const GEAR_S2_HULL = '22222222-2222-4222-a222-222222222202';
const GEAR_S2_GENERATOR = '22222222-2222-4222-a222-222222222203';
const GEAR_S2_SENSOR = '22222222-2222-4222-a222-222222222204';
const GEAR_S2_SOFTWARE = '22222222-2222-4222-a222-222222222205';
const GEAR_S2_THRUSTERS = '22222222-2222-4222-a222-222222222206';

// Ship 3 (BINDERBURG epic supporter)
const GEAR_S3_WEAPON = '33333333-3333-4333-a333-333333333301';
const GEAR_S3_HULL = '33333333-3333-4333-a333-333333333302';
const GEAR_S3_GENERATOR = '33333333-3333-4333-a333-333333333303';
const GEAR_S3_SENSOR = '33333333-3333-4333-a333-333333333304';
const GEAR_S3_SOFTWARE = '33333333-3333-4333-a333-333333333305';
const GEAR_S3_THRUSTERS = '33333333-3333-4333-a333-333333333306';

// -----------------------------------------------------------------------------
// DEMO_SHIPS
// -----------------------------------------------------------------------------

export const DEMO_SHIPS: Ship[] = [
    {
        id: SHIP_ID_1,
        name: 'Vanguard Prime',
        rarity: 'legendary',
        faction: 'TERRAN_COMBINE',
        type: 'ATTACKER',
        affinity: 'chemical',
        level: 60,
        rank: 5,
        copies: 4,
        baseStats: {
            hp: 42000,
            attack: 3800,
            defence: 1900,
            hacking: 120,
            security: 140,
            crit: 25,
            critDamage: 160,
            speed: 118,
        },
        equipment: {
            weapon: GEAR_S1_WEAPON,
            hull: GEAR_S1_HULL,
            generator: GEAR_S1_GENERATOR,
            sensor: GEAR_S1_SENSOR,
            software: GEAR_S1_SOFTWARE,
            thrusters: GEAR_S1_THRUSTERS,
        },
        implants: {},
        refits: [
            {
                id: 'aaaa1111-1111-4111-a111-111111111111',
                stats: [
                    { name: 'attack', value: 8, type: 'percentage' },
                    { name: 'crit', value: 4, type: 'percentage' },
                ],
            },
            {
                id: 'aaaa1112-1111-4111-a111-222222222222',
                stats: [{ name: 'critDamage', value: 10, type: 'percentage' }],
            },
        ],
    },
    {
        id: SHIP_ID_2,
        name: 'Bulwark of Dawn',
        rarity: 'epic',
        faction: 'GELECEK',
        type: 'DEFENDER',
        affinity: 'electric',
        level: 45,
        rank: 4,
        copies: 2,
        baseStats: {
            hp: 55000,
            attack: 1500,
            defence: 3200,
            hacking: 80,
            security: 200,
            crit: 10,
            critDamage: 120,
            speed: 92,
        },
        equipment: {
            weapon: GEAR_S2_WEAPON,
            hull: GEAR_S2_HULL,
            generator: GEAR_S2_GENERATOR,
            sensor: GEAR_S2_SENSOR,
            software: GEAR_S2_SOFTWARE,
            thrusters: GEAR_S2_THRUSTERS,
        },
        implants: {},
        refits: [
            {
                id: 'bbbb2222-2222-4222-a222-111111111111',
                stats: [
                    { name: 'hp', value: 10, type: 'percentage' },
                    { name: 'defence', value: 8, type: 'percentage' },
                ],
            },
        ],
    },
    {
        id: SHIP_ID_3,
        name: 'Aegis Lumen',
        rarity: 'epic',
        faction: 'BINDERBURG',
        type: 'SUPPORTER',
        affinity: 'thermal',
        level: 50,
        rank: 4,
        copies: 2,
        baseStats: {
            hp: 38000,
            attack: 1800,
            defence: 2200,
            hacking: 110,
            security: 160,
            crit: 12,
            critDamage: 125,
            speed: 135,
            healModifier: 30,
        },
        equipment: {
            weapon: GEAR_S3_WEAPON,
            hull: GEAR_S3_HULL,
            generator: GEAR_S3_GENERATOR,
            sensor: GEAR_S3_SENSOR,
            software: GEAR_S3_SOFTWARE,
            thrusters: GEAR_S3_THRUSTERS,
        },
        implants: {},
        refits: [
            {
                id: 'cccc3333-3333-4333-a333-111111111111',
                stats: [{ name: 'speed', value: 6, type: 'percentage' }],
            },
            {
                id: 'cccc3334-3333-4333-a333-222222222222',
                stats: [
                    { name: 'healModifier', value: 10, type: 'percentage' },
                    { name: 'hp', value: 6, type: 'percentage' },
                ],
            },
        ],
    },
    {
        id: SHIP_ID_4,
        name: 'Rustshade Whisper',
        rarity: 'rare',
        faction: 'XAOC',
        type: 'DEBUFFER',
        affinity: 'antimatter',
        level: 35,
        rank: 3,
        copies: 1,
        baseStats: {
            hp: 22000,
            attack: 1400,
            defence: 1200,
            hacking: 220,
            security: 90,
            crit: 8,
            critDamage: 110,
            speed: 105,
        },
        equipment: {},
        implants: {},
        refits: [],
    },
    {
        id: SHIP_ID_5,
        name: 'Frontier Spark',
        rarity: 'uncommon',
        faction: 'FRONTIER_LEGION',
        type: 'ATTACKER',
        affinity: 'chemical',
        level: 20,
        rank: 2,
        copies: 1,
        baseStats: {
            hp: 9500,
            attack: 900,
            defence: 450,
            hacking: 50,
            security: 60,
            crit: 5,
            critDamage: 105,
            speed: 95,
        },
        equipment: {},
        implants: {},
        refits: [],
    },
];

// -----------------------------------------------------------------------------
// DEMO_INVENTORY (18 gear pieces, 6 per equipped ship)
// -----------------------------------------------------------------------------

export const DEMO_INVENTORY: GearPiece[] = [
    // --- Ship 1: ATTACK set weapon/hull/generator + CRITICAL set sensor/software/thrusters ---
    {
        id: GEAR_S1_WEAPON,
        slot: 'weapon',
        level: 16,
        stars: 5,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 180, type: 'flat' },
        subStats: [
            { name: 'crit', value: 8, type: 'percentage' },
            { name: 'critDamage', value: 12, type: 'percentage' },
            { name: 'attack', value: 10, type: 'percentage' },
            { name: 'speed', value: 6, type: 'flat' },
        ],
        setBonus: 'ATTACK',
        shipId: SHIP_ID_1,
    },
    {
        id: GEAR_S1_HULL,
        slot: 'hull',
        level: 16,
        stars: 5,
        rarity: 'legendary',
        mainStat: { name: 'hp', value: 2400, type: 'flat' },
        subStats: [
            { name: 'attack', value: 95, type: 'flat' },
            { name: 'crit', value: 6, type: 'percentage' },
            { name: 'defence', value: 40, type: 'flat' },
        ],
        setBonus: 'ATTACK',
        shipId: SHIP_ID_1,
    },
    {
        id: GEAR_S1_GENERATOR,
        slot: 'generator',
        level: 16,
        stars: 5,
        rarity: 'epic',
        mainStat: { name: 'defence', value: 160, type: 'flat' },
        subStats: [
            { name: 'attack', value: 80, type: 'flat' },
            { name: 'hp', value: 7, type: 'percentage' },
            { name: 'critDamage', value: 8, type: 'percentage' },
        ],
        setBonus: 'ATTACK',
        shipId: SHIP_ID_1,
    },
    {
        id: GEAR_S1_SENSOR,
        slot: 'sensor',
        level: 16,
        stars: 5,
        rarity: 'legendary',
        mainStat: { name: 'crit', value: 45, type: 'percentage' },
        subStats: [
            { name: 'attack', value: 12, type: 'percentage' },
            { name: 'critDamage', value: 14, type: 'percentage' },
            { name: 'speed', value: 8, type: 'flat' },
            { name: 'hp', value: 450, type: 'flat' },
        ],
        setBonus: 'CRITICAL',
        shipId: SHIP_ID_1,
    },
    {
        id: GEAR_S1_SOFTWARE,
        slot: 'software',
        level: 15,
        stars: 5,
        rarity: 'epic',
        mainStat: { name: 'attack', value: 50, type: 'percentage' },
        subStats: [
            { name: 'crit', value: 7, type: 'percentage' },
            { name: 'critDamage', value: 10, type: 'percentage' },
            { name: 'hp', value: 5, type: 'percentage' },
        ],
        setBonus: 'CRITICAL',
        shipId: SHIP_ID_1,
    },
    {
        id: GEAR_S1_THRUSTERS,
        slot: 'thrusters',
        level: 15,
        stars: 5,
        rarity: 'epic',
        mainStat: { name: 'speed', value: 32, type: 'percentage' },
        subStats: [
            { name: 'attack', value: 9, type: 'percentage' },
            { name: 'crit', value: 5, type: 'percentage' },
        ],
        setBonus: 'CRITICAL',
        shipId: SHIP_ID_1,
    },

    // --- Ship 2: DEFENSE set weapon/hull/generator + FORTITUDE set sensor/software/thrusters ---
    {
        id: GEAR_S2_WEAPON,
        slot: 'weapon',
        level: 12,
        stars: 4,
        rarity: 'epic',
        mainStat: { name: 'attack', value: 120, type: 'flat' },
        subStats: [
            { name: 'defence', value: 30, type: 'flat' },
            { name: 'hp', value: 6, type: 'percentage' },
            { name: 'speed', value: 4, type: 'flat' },
        ],
        setBonus: 'DEFENSE',
        shipId: SHIP_ID_2,
    },
    {
        id: GEAR_S2_HULL,
        slot: 'hull',
        level: 12,
        stars: 4,
        rarity: 'epic',
        mainStat: { name: 'hp', value: 1800, type: 'flat' },
        subStats: [
            { name: 'defence', value: 45, type: 'flat' },
            { name: 'security', value: 12, type: 'flat' },
            { name: 'hp', value: 8, type: 'percentage' },
            { name: 'hacking', value: 8, type: 'flat' },
        ],
        setBonus: 'DEFENSE',
        shipId: SHIP_ID_2,
    },
    {
        id: GEAR_S2_GENERATOR,
        slot: 'generator',
        level: 11,
        stars: 4,
        rarity: 'epic',
        mainStat: { name: 'defence', value: 140, type: 'flat' },
        subStats: [
            { name: 'hp', value: 450, type: 'flat' },
            { name: 'security', value: 15, type: 'flat' },
            { name: 'defence', value: 8, type: 'percentage' },
        ],
        setBonus: 'DEFENSE',
        shipId: SHIP_ID_2,
    },
    {
        id: GEAR_S2_SENSOR,
        slot: 'sensor',
        level: 12,
        stars: 4,
        rarity: 'rare',
        mainStat: { name: 'hp', value: 35, type: 'percentage' },
        subStats: [
            { name: 'defence', value: 9, type: 'percentage' },
            { name: 'hp', value: 600, type: 'flat' },
            { name: 'security', value: 10, type: 'flat' },
        ],
        setBonus: 'FORTITUDE',
        shipId: SHIP_ID_2,
    },
    {
        id: GEAR_S2_SOFTWARE,
        slot: 'software',
        level: 10,
        stars: 4,
        rarity: 'epic',
        mainStat: { name: 'defence', value: 35, type: 'percentage' },
        subStats: [
            { name: 'hp', value: 7, type: 'percentage' },
            { name: 'hacking', value: 12, type: 'flat' },
        ],
        setBonus: 'FORTITUDE',
        shipId: SHIP_ID_2,
    },
    {
        id: GEAR_S2_THRUSTERS,
        slot: 'thrusters',
        level: 11,
        stars: 4,
        rarity: 'rare',
        mainStat: { name: 'hp', value: 35, type: 'percentage' },
        subStats: [
            { name: 'speed', value: 12, type: 'flat' },
            { name: 'defence', value: 5, type: 'percentage' },
            { name: 'hp', value: 400, type: 'flat' },
        ],
        setBonus: 'FORTITUDE',
        shipId: SHIP_ID_2,
    },

    // --- Ship 3: SPEED set weapon/hull/generator + FORTITUDE set sensor/software/thrusters ---
    {
        id: GEAR_S3_WEAPON,
        slot: 'weapon',
        level: 13,
        stars: 4,
        rarity: 'epic',
        mainStat: { name: 'attack', value: 130, type: 'flat' },
        subStats: [
            { name: 'speed', value: 7, type: 'flat' },
            { name: 'hp', value: 5, type: 'percentage' },
            { name: 'hacking', value: 10, type: 'flat' },
        ],
        setBonus: 'SPEED',
        shipId: SHIP_ID_3,
    },
    {
        id: GEAR_S3_HULL,
        slot: 'hull',
        level: 13,
        stars: 4,
        rarity: 'rare',
        mainStat: { name: 'hp', value: 1900, type: 'flat' },
        subStats: [
            { name: 'speed', value: 6, type: 'flat' },
            { name: 'defence', value: 25, type: 'flat' },
        ],
        setBonus: 'SPEED',
        shipId: SHIP_ID_3,
    },
    {
        id: GEAR_S3_GENERATOR,
        slot: 'generator',
        level: 12,
        stars: 4,
        rarity: 'epic',
        mainStat: { name: 'defence', value: 135, type: 'flat' },
        subStats: [
            { name: 'speed', value: 8, type: 'flat' },
            { name: 'hp', value: 500, type: 'flat' },
            { name: 'hacking', value: 15, type: 'flat' },
            { name: 'defence', value: 7, type: 'percentage' },
        ],
        setBonus: 'SPEED',
        shipId: SHIP_ID_3,
    },
    {
        id: GEAR_S3_SENSOR,
        slot: 'sensor',
        level: 10,
        stars: 3,
        rarity: 'rare',
        mainStat: { name: 'hp', value: 30, type: 'percentage' },
        subStats: [
            { name: 'speed', value: 5, type: 'flat' },
            { name: 'defence', value: 6, type: 'percentage' },
        ],
        setBonus: 'FORTITUDE',
        shipId: SHIP_ID_3,
    },
    {
        id: GEAR_S3_SOFTWARE,
        slot: 'software',
        level: 8,
        stars: 3,
        rarity: 'uncommon',
        mainStat: { name: 'speed', value: 18, type: 'percentage' },
        subStats: [
            { name: 'hp', value: 4, type: 'percentage' },
            { name: 'hacking', value: 8, type: 'flat' },
        ],
        setBonus: 'FORTITUDE',
        shipId: SHIP_ID_3,
    },
    {
        id: GEAR_S3_THRUSTERS,
        slot: 'thrusters',
        level: 4,
        stars: 2,
        rarity: 'uncommon',
        mainStat: { name: 'speed', value: 14, type: 'percentage' },
        subStats: [{ name: 'hp', value: 200, type: 'flat' }],
        setBonus: 'FORTITUDE',
        shipId: SHIP_ID_3,
    },
];

// -----------------------------------------------------------------------------
// DEMO_ENGINEERING_STATS (ATTACKER + DEFENDER only)
// -----------------------------------------------------------------------------

export const DEMO_ENGINEERING_STATS: EngineeringStats = {
    stats: [
        {
            shipType: 'ATTACKER',
            stats: [
                { name: 'attack', value: 600, type: 'flat' },
                { name: 'hp', value: 4500, type: 'flat' },
                { name: 'crit', value: 8, type: 'percentage' },
                { name: 'critDamage', value: 12, type: 'percentage' },
            ],
        },
        {
            shipType: 'DEFENDER',
            stats: [
                { name: 'hp', value: 8000, type: 'flat' },
                { name: 'defence', value: 350, type: 'flat' },
                { name: 'attack', value: 200, type: 'flat' },
                { name: 'crit', value: 5, type: 'percentage' },
            ],
        },
    ],
};

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

export function isDemoDataLoaded(): boolean {
    return localStorage.getItem(StorageKey.DEMO_DATA_LOADED) === 'true';
}

export async function loadDemoData(): Promise<void> {
    localStorage.setItem(StorageKey.SHIPS, JSON.stringify(DEMO_SHIPS));
    await setInIndexedDB(StorageKey.INVENTORY, DEMO_INVENTORY);
    localStorage.setItem(StorageKey.ENGINEERING_STATS, JSON.stringify(DEMO_ENGINEERING_STATS));
    localStorage.setItem(StorageKey.DEMO_DATA_LOADED, 'true');
}

export async function clearDemoData(): Promise<void> {
    localStorage.removeItem(StorageKey.SHIPS);
    await removeFromIndexedDB(StorageKey.INVENTORY);
    localStorage.removeItem(StorageKey.ENGINEERING_STATS);
    localStorage.removeItem(StorageKey.DEMO_DATA_LOADED);
}
