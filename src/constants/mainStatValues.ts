type StatTable = Record<number, Record<number, number>>;

// Percentage stats (ATK%, DEF%, HP%, CRT%, CPR%)
export const PERCENTAGE_STATS: StatTable = {
    1: {
        0: 1,
        1: 2,
        2: 3,
        3: 4,
        4: 5,
        5: 6,
        6: 7,
        7: 8,
        8: 8,
        9: 9,
        10: 10,
        11: 11,
        12: 12,
        13: 14,
        14: 16,
        15: 18,
        16: 20,
    },
    2: {
        0: 2,
        1: 3,
        2: 4,
        3: 5,
        4: 6,
        5: 7,
        6: 8,
        7: 9,
        8: 9,
        9: 10,
        10: 11,
        11: 12,
        12: 14,
        13: 17,
        14: 20,
        15: 22,
        16: 25,
    },
    3: {
        0: 3,
        1: 4,
        2: 5,
        3: 6,
        4: 6,
        5: 8,
        6: 10,
        7: 12,
        8: 13,
        9: 14,
        10: 15,
        11: 16,
        12: 18,
        13: 20,
        14: 22,
        15: 24,
        16: 25,
    },
    4: {
        0: 5,
        1: 6,
        2: 7,
        3: 8,
        4: 10,
        5: 11,
        6: 12,
        7: 13,
        8: 15,
        9: 17,
        10: 19,
        11: 20,
        12: 21,
        13: 24,
        14: 27,
        15: 29,
        16: 30,
    },
    5: {
        0: 8,
        1: 9,
        2: 10,
        3: 11,
        4: 14,
        5: 15,
        6: 16,
        7: 17,
        8: 20,
        9: 22,
        10: 24,
        11: 26,
        12: 29,
        13: 31,
        14: 33,
        15: 35,
        16: 40,
    },
    6: {
        0: 12,
        1: 14,
        2: 16,
        3: 18,
        4: 21,
        5: 23,
        6: 25,
        7: 27,
        8: 30,
        9: 32,
        10: 34,
        11: 36,
        12: 39,
        13: 42,
        14: 45,
        15: 47,
        16: 50,
    },
};

// Flat ATK/DEF values
export const FLAT_ATK_DEF: StatTable = {
    1: {
        0: 10,
        1: 12,
        2: 14,
        3: 16,
        4: 20,
        5: 23,
        6: 26,
        7: 29,
        8: 35,
        9: 40,
        10: 45,
        11: 50,
        12: 55,
        13: 65,
        14: 75,
        15: 85,
        16: 100,
    },
    2: {
        0: 20,
        1: 24,
        2: 28,
        3: 32,
        4: 40,
        5: 46,
        6: 52,
        7: 58,
        8: 70,
        9: 80,
        10: 90,
        11: 100,
        12: 110,
        13: 130,
        14: 150,
        15: 170,
        16: 200,
    },
    3: {
        0: 40,
        1: 48,
        2: 56,
        3: 64,
        4: 80,
        5: 92,
        6: 104,
        7: 116,
        8: 140,
        9: 160,
        10: 180,
        11: 200,
        12: 220,
        13: 260,
        14: 300,
        15: 340,
        16: 400,
    },
    4: {
        0: 60,
        1: 72,
        2: 84,
        3: 96,
        4: 120,
        5: 138,
        6: 156,
        7: 174,
        8: 210,
        9: 234,
        10: 258,
        11: 282,
        12: 330,
        13: 360,
        14: 390,
        15: 420,
        16: 600,
    },
    5: {
        0: 80,
        1: 96,
        2: 112,
        3: 128,
        4: 160,
        5: 184,
        6: 208,
        7: 232,
        8: 280,
        9: 312,
        10: 344,
        11: 376,
        12: 440,
        13: 480,
        14: 520,
        15: 560,
        16: 800,
    },
    6: {
        0: 100,
        1: 120,
        2: 140,
        3: 160,
        4: 200,
        5: 230,
        6: 260,
        7: 290,
        8: 350,
        9: 390,
        10: 430,
        11: 470,
        12: 550,
        13: 600,
        14: 650,
        15: 700,
        16: 1000,
    },
};

// Flat HP values
export const FLAT_HP: StatTable = {
    1: {
        0: 0,
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        7: 0,
        8: 0,
        9: 0,
        10: 0,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
    },
    2: {
        0: 0,
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        7: 0,
        8: 0,
        9: 0,
        10: 0,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
    },
    3: {
        0: 200,
        1: 240,
        2: 280,
        3: 320,
        4: 400,
        5: 464,
        6: 528,
        7: 592,
        8: 720,
        9: 816,
        10: 912,
        11: 1008,
        12: 1200,
        13: 1320,
        14: 1440,
        15: 1560,
        16: 2000,
    },
    4: {
        0: 300,
        1: 360,
        2: 420,
        3: 480,
        4: 600,
        5: 696,
        6: 792,
        7: 888,
        8: 1080,
        9: 1224,
        10: 1368,
        11: 1512,
        12: 1800,
        13: 1980,
        14: 2160,
        15: 2340,
        16: 3000,
    },
    5: {
        0: 400,
        1: 480,
        2: 560,
        3: 640,
        4: 800,
        5: 928,
        6: 1056,
        7: 1184,
        8: 1440,
        9: 1632,
        10: 1824,
        11: 2016,
        12: 2400,
        13: 2640,
        14: 2880,
        15: 3120,
        16: 4000,
    },
    6: {
        0: 500,
        1: 600,
        2: 700,
        3: 800,
        4: 1000,
        5: 1160,
        6: 1320,
        7: 1480,
        8: 1800,
        9: 2040,
        10: 2280,
        11: 2520,
        12: 3000,
        13: 3300,
        14: 3600,
        15: 3900,
        16: 5000,
    },
};

// HACK and SEC stats
export const HACK_SEC_STATS: StatTable = {
    1: {
        0: 2,
        1: 4,
        2: 6,
        3: 8,
        4: 10,
        5: 11,
        6: 12,
        7: 13,
        8: 13,
        9: 14,
        10: 15,
        11: 16,
        12: 24,
        13: 26,
        14: 28,
        15: 30,
        16: 20,
    },
    2: {
        0: 0,
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        7: 0,
        8: 0,
        9: 0,
        10: 0,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
    },
    3: {
        0: 4,
        1: 6,
        2: 8,
        3: 10,
        4: 12,
        5: 14,
        6: 16,
        7: 18,
        8: 26,
        9: 29,
        10: 32,
        11: 35,
        12: 41,
        13: 44,
        14: 47,
        15: 50,
        16: 40,
    },
    4: {
        0: 6,
        1: 8,
        2: 10,
        3: 12,
        4: 15,
        5: 18,
        6: 21,
        7: 24,
        8: 26,
        9: 29,
        10: 32,
        11: 35,
        12: 41,
        13: 44,
        14: 47,
        15: 50,
        16: 60,
    },
    5: {
        0: 8,
        1: 10,
        2: 12,
        3: 14,
        4: 18,
        5: 21,
        6: 24,
        7: 27,
        8: 33,
        9: 36,
        10: 39,
        11: 42,
        12: 48,
        13: 52,
        14: 56,
        15: 60,
        16: 80,
    },
    6: {
        0: 10,
        1: 12,
        2: 14,
        3: 16,
        4: 20,
        5: 24,
        6: 28,
        7: 32,
        8: 33,
        9: 36,
        10: 39,
        11: 42,
        12: 55,
        13: 60,
        14: 65,
        15: 70,
        16: 100,
    },
};

// SPD stats
export const SPD_STATS: StatTable = {
    3: {
        0: 5,
        1: 6,
        2: 7,
        3: 8,
        4: 10,
        5: 11,
        6: 12,
        7: 13,
        8: 14,
        9: 15,
        10: 16,
        11: 17,
        12: 20,
        13: 22,
        14: 24,
        15: 26,
        16: 30,
    },
    4: {
        0: 6,
        1: 7,
        2: 8,
        3: 9,
        4: 11,
        5: 12,
        6: 13,
        7: 14,
        8: 16,
        9: 18,
        10: 20,
        11: 22,
        12: 25,
        13: 27,
        14: 29,
        15: 31,
        16: 35,
    },
    5: {
        0: 8,
        1: 9,
        2: 10,
        3: 11,
        4: 14,
        5: 15,
        6: 16,
        7: 17,
        8: 20,
        9: 22,
        10: 24,
        11: 26,
        12: 29,
        13: 31,
        14: 33,
        15: 35,
        16: 40,
    },
    6: {
        0: 10,
        1: 11,
        2: 12,
        3: 13,
        4: 16,
        5: 17,
        6: 18,
        7: 19,
        8: 22,
        9: 24,
        10: 26,
        11: 28,
        12: 34,
        13: 37,
        14: 39,
        15: 42,
        16: 45,
    },
};
