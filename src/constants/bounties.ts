import type { RarityName } from './rarities';

/**
 * Bounty reward data, transcribed from the in-game "Briefing - Rewards" screens (2026-10-16).
 * Drop tables are identical across all four bounties; only the set pool differs. Every set
 * available at a level has an equal roll chance.
 */

export type BountyId = 'fenri' | 'colosso' | 'eelun' | 'maglienza';
export type StarRank = 1 | 2 | 3 | 4 | 5 | 6;

export interface Bounty {
    id: BountyId;
    name: string;
    sets: string[];
    /** Extra set added to the pool at `ABYSSAL_LEVEL`. */
    abyssalSet: string;
    /** False while the bounty's abyssal level is unreleased; the level is then not offered. */
    abyssalAvailable: boolean;
}

export interface BountyDrop {
    stars: StarRank;
    rarity: RarityName;
    /** Percent chance per run. */
    chance: number;
}

export interface BountyLevel {
    level: number;
    /** Fixed credits per win, before credit bonuses. */
    credits: number;
    energy: number;
    /** Percent chance that a run drops gear at all (the in-game "Total chance"). */
    totalGearChance: number;
    drops: BountyDrop[];
}

export const ABYSSAL_LEVEL = 33;

export type BackgroundTierId = 'r1' | 'r3' | 'r5' | 'r10' | 'win';

/** An in-game Auto-Battle tier: minutes per battle and the bonus-gear cadence it earns. */
export interface BackgroundTier {
    id: BackgroundTierId;
    label: string;
    minutes: number;
    /** One extra gear drop per this many battles; null when the tier earns none. */
    bonusGearEvery: number | null;
}

export const BACKGROUND_TIERS: BackgroundTier[] = [
    { id: 'r1', label: 'Win in 1 round', minutes: 1, bonusGearEvery: 10 },
    { id: 'r3', label: 'Win in 3 rounds', minutes: 1.5, bonusGearEvery: 15 },
    { id: 'r5', label: 'Win in 5 rounds', minutes: 3, bonusGearEvery: 20 },
    { id: 'r10', label: 'Win in 10 rounds', minutes: 4, bonusGearEvery: null },
    { id: 'win', label: 'Win the battle', minutes: 6, bonusGearEvery: null },
];

/** Background battles cost this share of the normal energy, unrounded. */
export const BACKGROUND_ENERGY_FACTOR = 0.9;

export const BOUNTIES: Bounty[] = [
    {
        id: 'fenri',
        name: 'Fenri Khaliriz',
        sets: ['Attack', 'Speed', 'Critical'],
        abyssalSet: 'Burner',
        abyssalAvailable: true,
    },
    {
        id: 'colosso',
        name: 'General Colosso',
        sets: ['Fortitude', 'Defense', 'Reflect'],
        abyssalSet: 'Hardened',
        abyssalAvailable: true,
    },
    {
        id: 'eelun',
        name: 'Eelun Naphula',
        sets: ['Shield', 'Repair', 'Boost'],
        abyssalSet: 'Viral',
        abyssalAvailable: false,
    },
    {
        id: 'maglienza',
        name: 'Mamma Maglienza',
        sets: ['Hacking', 'Protection', 'Decimation'],
        abyssalSet: 'Piercer',
        abyssalAvailable: true,
    },
];

const RARITY_LETTERS: Record<'c' | 'u' | 'r' | 'e' | 'l', RarityName> = {
    c: 'common',
    u: 'uncommon',
    r: 'rare',
    e: 'epic',
    l: 'legendary',
};

/** Parses `'4r15.6 6l1.6'` → 4★ rare 15.6%, 6★ legendary 1.6%. */
export function parseDrops(spec: string): BountyDrop[] {
    return spec
        .trim()
        .split(/\s+/)
        .map((token) => {
            const m = /^([1-6])([cuerl])(\d+(?:\.\d+)?)$/.exec(token);
            if (!m) throw new Error(`Bad drop token: ${token}`);
            return {
                stars: Number(m[1]) as StarRank,
                rarity: RARITY_LETTERS[m[2] as keyof typeof RARITY_LETTERS],
                chance: Number(m[3]),
            };
        });
}

const T = {
    l33: '4r15.6 4e7.2 4l3.3 5r36.9 5e16.9 5l7.7 6r7.5 6e3.4 6l1.6',
    l32: '4r19.1 4e7.7 4l3.2 5r38.0 5e15.2 5l6.3 6r6.7 6e2.7 6l1.1',
    l29: '4r24.3 4e9.0 4l2.7 5r38.1 5e14.1 5l4.2 6r5.1 6e1.9 6l0.6',
    l28: '4r28.0 4e10.0 4l2.0 5r37.8 5e13.5 5l2.7 6r4.2 6e1.5 6l0.3',
    l25: '4r31.5 4e11.3 4l2.3 5r35.0 5e12.5 5l2.5 6r3.5 6e1.3 6l0.3',
    l24: '4r38.5 4e13.8 4l2.8 5r31.5 5e11.3 5l2.3',
    l21: '4r46.2 4e12.0 4l1.8 5r30.8 5e8.0 5l1.2',
    l20: '4r53.1 4e13.8 4l2.1 5r23.9 5e6.2 5l0.9',
    l17: '3r15.4 3e4.0 3l0.6 4r43.9 4e11.4 4l1.7 5r17.7 5e4.6 5l0.7',
    l16: '3r22.1 3e4.5 3l0.4 4r45.1 4e9.1 4l0.8 5r14.8 5e3.0',
    l13: '3r28.3 3e5.7 3l0.5 4r43.5 4e8.7 4l0.8 5r10.3 5e2.1',
    l12: '3r41.0 3e8.3 3l0.8 4r41.0 4e8.3 4l0.8',
    l9: '3r37.1 3e8.8 3l0.5 4r26.9 4e6.4 4l0.3',
    l8: '2r8.4 2e2.0 2l0.1 3r33.6 3e8.0 3l0.4 4r14.0 4e3.3 4l0.2',
    l5: '2r21.6 2e5.1 2l0.3 3r26.4 3e6.3 3l0.3',
    l4: '1r12.0 1e2.9 1l0.2 2r24.0 2e5.7 2l0.3 3r4.0 3e1.0',
    l1: '1r19.2 1e4.6 1l0.2 2r12.8 2e3.0 2l0.2',
};

/** [level, credits, totalGearChance, drop table] */
const ROWS: [number, number, number, string][] = [
    [1, 2000, 40, T.l1],
    [2, 2080, 40, T.l1],
    [3, 2160, 40, T.l1],
    [4, 2240, 50, T.l4],
    [5, 3100, 60, T.l5],
    [6, 3210, 60, T.l5],
    [7, 3310, 60, T.l5],
    [8, 3420, 70, T.l8],
    [9, 4410, 80, T.l9],
    [10, 4550, 80, T.l9],
    [11, 4680, 80, T.l9],
    [12, 4820, 100, T.l12],
    [13, 5940, 100, T.l13],
    [14, 6100, 100, T.l13],
    [15, 6270, 100, T.l13],
    [16, 6430, 100, T.l16],
    [17, 7690, 100, T.l17],
    [18, 7880, 100, T.l17],
    [19, 8070, 100, T.l17],
    [20, 8260, 100, T.l20],
    [21, 9650, 100, T.l21],
    [22, 9870, 100, T.l21],
    [23, 10100, 100, T.l21],
    [24, 10300, 100, T.l24],
    [25, 11830, 100, T.l25],
    [26, 12070, 100, T.l25],
    [27, 12320, 100, T.l25],
    [28, 12560, 100, T.l28],
    [29, 14230, 100, T.l29],
    [30, 14500, 100, T.l29],
    [31, 14770, 100, T.l29],
    [32, 15000, 100, T.l32],
    [33, 17000, 100, T.l33],
];

function energyForLevel(level: number): number {
    if (level >= 33) return 11;
    if (level >= 30) return 10;
    if (level >= 26) return 9;
    if (level >= 22) return 8;
    if (level >= 18) return 7;
    if (level >= 13) return 6;
    if (level >= 9) return 5;
    if (level >= 5) return 4;
    return 3;
}

export const BOUNTY_LEVELS: BountyLevel[] = ROWS.map(([level, credits, totalGearChance, spec]) => ({
    level,
    credits,
    energy: energyForLevel(level),
    totalGearChance,
    drops: parseDrops(spec),
}));
