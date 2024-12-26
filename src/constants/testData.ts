export const testData = {
    ships: [
        {
            "id": "1733481184006",
            "name": "Judge",
            "faction": "FRONTIER_LEGION",
            "type": "ATTACKER",
            "rarity": "legendary",
            "baseStats": {
                "hp": 10793,
                "attack": 4935,
                "defence": 1627,
                "hacking": 82,
                "security": 9,
                "crit": 19,
                "critDamage": 50,
                "speed": 87,
                "healModifier": 0
            },
            "equipment": {
            },
            "refits": [
                {
                    "name": "",
                    "stats": [
                        {
                            "name": "attack",
                            "type": "percentage",
                            "value": 15
                        }
                    ]
                },
                {
                    "name": "",
                    "stats": [
                        {
                            "name": "critDamage",
                            "type": "percentage",
                            "value": 20
                        }
                    ]
                }
            ],
            "implants": [
                {
                    "name": "",
                    "stats": [
                        {
                            "name": "attack",
                            "type": "percentage",
                            "value": 11
                        }
                    ]
                },
                {
                    "name": "",
                    "stats": [
                        {
                            "name": "attack",
                            "type": "percentage",
                            "value": 7
                        }
                    ]
                },
                {
                    "name": "",
                    "stats": [
                        {
                            "name": "speed",
                            "type": "flat",
                            "value": 8
                        }
                    ]
                },
                {
                    "name": "",
                    "stats": [
                        {
                            "name": "attack",
                            "type": "percentage",
                            "value": 20
                        },
                        {
                            "name": "speed",
                            "type": "flat",
                            "value": 16
                        }
                    ]
                }
            ]
        },
        {
            "id": "1733826045345",
            "name": "Anemone",
            "faction": "GELECEK",
            "type": "DEFENDER",
            "rarity": "legendary",
            "baseStats": {
                "hp": 22045,
                "attack": 3224,
                "defence": 3591,
                "hacking": 100,
                "security": 41,
                "crit": 0,
                "critDamage": 0,
                "speed": 69,
                "healModifier": 0
            },
            "equipment": {},
            "refits": [],
            "implants": []
        },
        {
            "id": "1733826060089",
            "name": "Yazid",
            "faction": "EVERLIVING",
            "type": "DEFENDER",
            "rarity": "epic",
            "baseStats": {
                "hp": 17912,
                "attack": 2158,
                "defence": 3174,
                "hacking": 87,
                "security": 21,
                "crit": 4,
                "critDamage": 12,
                "speed": 71,
                "healModifier": 0
            },
            "equipment": {},
            "refits": [
                {
                    "stats": [
                        {
                            "name": "hp",
                            "type": "percentage",
                            "value": 15
                        }
                    ]
                }
            ],
            "implants": []
        },
        {
            "id": "1733946833823",
            "name": "Butcher",
            "faction": "MARAUDERS",
            "type": "ATTACKER",
            "rarity": "epic",
            "baseStats": {
                "hp": 12056,
                "attack": 4216,
                "defence": 1587,
                "hacking": 82,
                "security": 0,
                "crit": 23,
                "critDamage": 38,
                "speed": 83,
                "healModifier": 0
            },
            "equipment": {},
            "refits": [],
            "implants": []
        },
        {
            "id": "1733946946164",
            "name": "Salvation",
            "faction": "BINDERBURG",
            "type": "SUPPORTER",
            "rarity": "epic",
            "baseStats": {
                "hp": 15156,
                "attack": 1438,
                "defence": 2500,
                "hacking": 94,
                "security": 36,
                "crit": 3,
                "critDamage": 20,
                "speed": 87,
                "healModifier": 0
            },
            "equipment": {},
            "refits": [],
            "implants": []
        },
        {
            "id": "1734081000244",
            "name": "Sentinel",
            "faction": "FRONTIER_LEGION",
            "type": "SUPPORTER",
            "rarity": "legendary",
            "baseStats": {
                "hp": 13434,
                "attack": 3373,
                "defence": 2797,
                "hacking": 80,
                "security": 26,
                "crit": 15,
                "critDamage": 20,
                "speed": 95,
                "healModifier": 0
            },
            "equipment": {},
            "refits": [],
            "implants": []
        },
        {
            "id": "1734081075588",
            "name": "Hayyan",
            "faction": "EVERLIVING",
            "type": "SUPPORTER",
            "rarity": "legendary",
            "baseStats": {
                "hp": 15616,
                "attack": 2282,
                "defence": 2420,
                "hacking": 90,
                "security": 33,
                "crit": 8,
                "critDamage": 20,
                "speed": 91,
                "healModifier": 0
            },
            "equipment": {
                "generator": "1733931860703",
                "software": "1733931978464"
            },
            "refits": [],
            "implants": []
        },
        {
            "id": "1734191124248",
            "name": "Apex",
            "faction": "ATLAS_SYNDICATE",
            "type": "DEBUFFER",
            "rarity": "legendary",
            "baseStats": {
                "hp": 11826,
                "attack": 3993,
                "defence": 1924,
                "hacking": 108,
                "security": 28,
                "crit": 6,
                "critDamage": 22,
                "speed": 85,
                "healModifier": 0
            },
            "equipment": {
                "weapon": "1733760259012",
                "hull": "1733760326632"
            },
            "refits": [],
            "implants": []
        }
    ],
    gear: [
        {
            "id": "1733395194601",
            "slot": "weapon",
            "mainStat": {
                "name": "attack",
                "value": 800,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "hacking",
                    "value": 12,
                    "type": "flat"
                },
                {
                    "name": "crit",
                    "value": 12,
                    "type": "percentage"
                },
                {
                    "name": "attack",
                    "value": 6,
                    "type": "percentage"
                },
                {
                    "name": "defence",
                    "value": 18,
                    "type": "percentage"
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733395262029",
            "slot": "hull",
            "mainStat": {
                "name": "hp",
                "value": 2000,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "speed",
                    "value": 5,
                    "type": "flat"
                },
                {
                    "name": "hp",
                    "value": 6,
                    "type": "percentage"
                },
                {
                    "name": "critDamage",
                    "value": 27,
                    "type": "percentage"
                },
                {
                    "name": "attack",
                    "value": 12,
                    "type": "percentage"
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 3,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733395314366",
            "slot": "generator",
            "mainStat": {
                "name": "defence",
                "value": 800,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "crit",
                    "value": 20,
                    "type": "percentage"
                },
                {
                    "name": "hp",
                    "value": 849,
                    "type": "flat"
                },
                {
                    "name": "critDamage",
                    "value": 15,
                    "type": "percentage"
                },
                {
                    "name": "attack",
                    "value": 115,
                    "type": "flat"
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733395418098",
            "slot": "sensor",
            "mainStat": {
                "name": "attack",
                "value": 50,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "crit",
                    "value": 12,
                    "type": "percentage"
                },
                {
                    "name": "hacking",
                    "value": 15,
                    "type": "flat"
                },
                {
                    "name": "critDamage",
                    "value": 7,
                    "type": "percentage"
                },
                {
                    "name": "defence",
                    "value": 222,
                    "type": "flat"
                }
            ],
            "setBonus": "ABYSSAL_ASSAULT",
            "stars": 6,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733395472692",
            "slot": "software",
            "mainStat": {
                "name": "hp",
                "value": 0,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "hp",
                    "value": 842,
                    "type": "flat"
                },
                {
                    "name": "attack",
                    "value": 46,
                    "type": "flat"
                },
                {
                    "name": "crit",
                    "value": 4,
                    "type": "percentage"
                },
                {
                    "name": "critDamage",
                    "value": 5,
                    "type": "percentage"
                }
            ],
            "setBonus": "ATTACK",
            "stars": 5,
            "rarity": "rare",
            "level": 16
        },
        {
            "id": "1733395556905",
            "slot": "thrusters",
            "mainStat": {
                "name": "attack",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "crit",
                    "value": 11,
                    "type": "percentage"
                },
                {
                    "name": "speed",
                    "value": 7,
                    "type": "flat"
                },
                {
                    "name": "hp",
                    "value": 10,
                    "type": "percentage"
                },
                {
                    "name": "hp",
                    "value": 256,
                    "type": "flat"
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733395701823",
            "slot": "weapon",
            "mainStat": {
                "name": "attack",
                "value": 600,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "critDamage",
                    "value": 6,
                    "type": "percentage"
                },
                {
                    "name": "hacking",
                    "value": 6,
                    "type": "flat"
                },
                {
                    "name": "attack",
                    "value": 20,
                    "type": "percentage"
                },
                {
                    "name": "defence",
                    "value": 5,
                    "type": "percentage"
                }
            ],
            "setBonus": "ABYSSAL_ASSAULT",
            "stars": 4,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733395896424",
            "slot": "hull",
            "mainStat": {
                "name": "hp",
                "value": 0,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "critDamage",
                    "value": 14,
                    "type": "percentage"
                },
                {
                    "name": "security",
                    "value": 7,
                    "type": "flat"
                },
                {
                    "name": "crit",
                    "value": 16,
                    "type": "percentage"
                },
                {
                    "name": "attack",
                    "value": 18,
                    "type": "percentage"
                }
            ],
            "setBonus": "ABYSSAL_ASSAULT",
            "stars": 4,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733476926597",
            "slot": "sensor",
            "mainStat": {
                "name": "crit",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "critDamage",
                    "value": 7,
                    "type": "percentage"
                },
                {
                    "name": "attack",
                    "value": 291,
                    "type": "flat"
                },
                {
                    "name": "speed",
                    "value": 9,
                    "type": "flat"
                },
                {
                    "name": "attack",
                    "value": 11,
                    "type": "percentage"
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733476999932",
            "slot": "thrusters",
            "mainStat": {
                "name": "attack",
                "value": 30,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "hp",
                    "value": 802,
                    "type": "flat"
                },
                {
                    "name": "critDamage",
                    "value": 8,
                    "type": "percentage"
                },
                {
                    "name": "crit",
                    "value": 11,
                    "type": "percentage"
                },
                {
                    "name": "defence",
                    "value": 5,
                    "type": "percentage"
                }
            ],
            "setBonus": "ATTACK",
            "stars": 4,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733500763531",
            "slot": "generator",
            "mainStat": {
                "name": "defence",
                "value": 800,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "defence",
                    "value": 10,
                    "type": "percentage"
                },
                {
                    "name": "crit",
                    "value": 5,
                    "type": "percentage"
                },
                {
                    "name": "attack",
                    "value": 16,
                    "type": "percentage"
                },
                {
                    "name": "speed",
                    "value": 3,
                    "type": "flat"
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733500872269",
            "slot": "software",
            "mainStat": {
                "name": "attack",
                "value": 50,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "critDamage",
                    "value": 13,
                    "type": "percentage"
                },
                {
                    "name": "hp",
                    "value": 4,
                    "type": "percentage"
                },
                {
                    "name": "attack",
                    "value": 120,
                    "type": "flat"
                },
                {
                    "name": "hacking",
                    "value": 6,
                    "type": "flat"
                }
            ],
            "setBonus": "ATTACK",
            "stars": 6,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733760086370",
            "slot": "generator",
            "mainStat": {
                "name": "defence",
                "value": 800,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 218
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 20
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 14
                },
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 7
                }
            ],
            "setBonus": "ABYSSAL_ASSAULT",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733760162146",
            "slot": "sensor",
            "mainStat": {
                "name": "crit",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 12
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 5
                },
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 194
                },
                {
                    "name": "defence",
                    "type": "flat",
                    "value": 50
                }
            ],
            "setBonus": "ABYSSAL_ASSAULT",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733760259012",
            "slot": "weapon",
            "mainStat": {
                "name": "attack",
                "value": 800,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 720
                },
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 18
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 7
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 14
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733760326632",
            "slot": "hull",
            "mainStat": {
                "name": "hp",
                "value": 4000,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 6
                },
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 322
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 8
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 20
                }
            ],
            "setBonus": "SPEED",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733760383466",
            "slot": "generator",
            "mainStat": {
                "name": "defence",
                "value": 1000,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "defence",
                    "type": "flat",
                    "value": 12
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 6
                },
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 19
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 13
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 6,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733760443908",
            "slot": "sensor",
            "mainStat": {
                "name": "critDamage",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 8
                },
                {
                    "name": "speed",
                    "type": "flat",
                    "value": 7
                },
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 4
                },
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 56
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 5,
            "rarity": "rare",
            "level": 16
        },
        {
            "id": "1733760502005",
            "slot": "software",
            "mainStat": {
                "name": "attack",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 10
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 7
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 1056
                },
                {
                    "name": "speed",
                    "type": "flat",
                    "value": 4
                }
            ],
            "setBonus": "SPEED",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733760579754",
            "slot": "weapon",
            "mainStat": {
                "name": "attack",
                "value": 600,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 8
                },
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 5
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 648
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 26
                }
            ],
            "setBonus": "SPEED",
            "stars": 4,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733760652161",
            "slot": "hull",
            "mainStat": {
                "name": "hp",
                "value": 5000,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 14
                },
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 10
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 6
                },
                {
                    "name": "speed",
                    "type": "flat",
                    "value": 6
                }
            ],
            "setBonus": "ATTACK",
            "stars": 6,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733836655839",
            "slot": "generator",
            "mainStat": {
                "name": "defence",
                "value": 800,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 7
                },
                {
                    "name": "speed",
                    "type": "flat",
                    "value": 4
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 19
                },
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 4
                }
            ],
            "setBonus": "ATTACK",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733836957878",
            "slot": "sensor",
            "mainStat": {
                "name": "crit",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "security",
                    "type": "flat",
                    "value": 7
                },
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 183
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 14
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 1365
                }
            ],
            "setBonus": "ATTACK",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733837022886",
            "slot": "software",
            "mainStat": {
                "name": "hp",
                "value": 0,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 221
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 6
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 10
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 261
                }
            ],
            "setBonus": "SPEED",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733837073604",
            "slot": "thrusters",
            "mainStat": {
                "name": "attack",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 6
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 21
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 11
                },
                {
                    "name": "speed",
                    "type": "flat",
                    "value": 10
                }
            ],
            "setBonus": "ATTACK",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733837187688",
            "slot": "sensor",
            "mainStat": {
                "name": "attack",
                "value": 30,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "defence",
                    "type": "flat",
                    "value": 182
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 10
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 5
                },
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 5
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 4,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733837324503",
            "slot": "hull",
            "mainStat": {
                "name": "hp",
                "value": 4000,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 9
                },
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 17
                },
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 4
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 6
                }
            ],
            "setBonus": "ATTACK",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733837399965",
            "slot": "thrusters",
            "mainStat": {
                "name": "attack",
                "value": 30,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 16
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 11
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 414
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 6
                }
            ],
            "setBonus": "ABYSSAL_ASSAULT",
            "stars": 4,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733837472316",
            "slot": "sensor",
            "mainStat": {
                "name": "attack",
                "value": 30,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "speed",
                    "type": "flat",
                    "value": 4
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 22
                },
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 17
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 7
                }
            ],
            "setBonus": "SPEED",
            "stars": 4,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733837539500",
            "slot": "software",
            "mainStat": {
                "name": "hacking",
                "value": 80,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "defence",
                    "type": "flat",
                    "value": 161
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 11
                },
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 6
                },
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 76
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733837610584",
            "slot": "software",
            "mainStat": {
                "name": "defence",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 16
                },
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 9
                },
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 5
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 6
                }
            ],
            "setBonus": "ABYSSAL_ASSAULT",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733931729549",
            "slot": "weapon",
            "mainStat": {
                "name": "attack",
                "value": 800,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 18
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 14
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 6
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 861
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733931806375",
            "slot": "hull",
            "mainStat": {
                "name": "hp",
                "value": 5000,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "defence",
                    "type": "flat",
                    "value": 158
                },
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 7
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 22
                },
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 12
                }
            ],
            "setBonus": "FORTITUDE",
            "stars": 6,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733931860703",
            "slot": "generator",
            "mainStat": {
                "name": "defence",
                "value": 800,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 80
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 20
                },
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 13
                },
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 13
                }
            ],
            "setBonus": "REPAIR",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1733931914753",
            "slot": "sensor",
            "mainStat": {
                "name": "crit",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 10
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 412
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 18
                },
                {
                    "name": "defence",
                    "type": "flat",
                    "value": 64
                }
            ],
            "setBonus": "FORTITUDE",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733931978464",
            "slot": "software",
            "mainStat": {
                "name": "hp",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "defence",
                    "type": "flat",
                    "value": 110
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 5
                },
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 16
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 6
                }
            ],
            "setBonus": "REPAIR",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733932031232",
            "slot": "thrusters",
            "mainStat": {
                "name": "hp",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "security",
                    "type": "flat",
                    "value": 12
                },
                {
                    "name": "speed",
                    "type": "flat",
                    "value": 4
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 16
                },
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 4
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733932192009",
            "slot": "generator",
            "mainStat": {
                "name": "defence",
                "value": 800,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 12
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 5
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 1228
                },
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 81
                }
            ],
            "setBonus": "FORTITUDE",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733932256269",
            "slot": "sensor",
            "mainStat": {
                "name": "critDamage",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "security",
                    "type": "flat",
                    "value": 12
                },
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 151
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 11
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 6
                }
            ],
            "setBonus": "ABYSSAL_SAFEGUARD",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1733932336408",
            "slot": "software",
            "mainStat": {
                "name": "hp",
                "value": 30,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 6
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 900
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 20
                },
                {
                    "name": "speed",
                    "type": "flat",
                    "value": 8
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 4,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1734003064279",
            "slot": "thrusters",
            "mainStat": {
                "name": "hp",
                "value": 4000,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 119
                },
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 13
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 15
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 19
                }
            ],
            "setBonus": "ABYSSAL_SAFEGUARD",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1734003158657",
            "slot": "weapon",
            "mainStat": {
                "name": "attack",
                "value": 800,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "defence",
                    "type": "flat",
                    "value": 109
                },
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 5
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 932
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 7
                }
            ],
            "setBonus": "ABYSSAL_SAFEGUARD",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1734003217261",
            "slot": "hull",
            "mainStat": {
                "name": "hp",
                "value": 4000,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 19
                },
                {
                    "name": "speed",
                    "type": "flat",
                    "value": 4
                },
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 251
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 14
                }
            ],
            "setBonus": "ABYSSAL_WARD",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1734003275401",
            "slot": "generator",
            "mainStat": {
                "name": "defence",
                "value": 800,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "speed",
                    "type": "flat",
                    "value": 8
                },
                {
                    "name": "defence",
                    "type": "flat",
                    "value": 11
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 13
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 1086
                }
            ],
            "setBonus": "ABYSSAL_SAFEGUARD",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1734003328763",
            "slot": "sensor",
            "mainStat": {
                "name": "hp",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 11
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 423
                },
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 14
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 5
                }
            ],
            "setBonus": "FORTITUDE",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1734003382845",
            "slot": "software",
            "mainStat": {
                "name": "hp",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 3
                },
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 14
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 283
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 4
                }
            ],
            "setBonus": "FORTITUDE",
            "stars": 5,
            "rarity": "rare",
            "level": 16
        },
        {
            "id": "1734003439566",
            "slot": "thrusters",
            "mainStat": {
                "name": "hp",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 4
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 13
                },
                {
                    "name": "defence",
                    "type": "flat",
                    "value": 41
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 5
                }
            ],
            "setBonus": "ABYSSAL_WARD",
            "stars": 5,
            "rarity": "rare",
            "level": 16
        },
        {
            "id": "1734003501766",
            "slot": "weapon",
            "mainStat": {
                "name": "attack",
                "value": 1000,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 1316
                },
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 6
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 5
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 6
                }
            ],
            "setBonus": "ABYSSAL_WARD",
            "stars": 6,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1734003555895",
            "slot": "hull",
            "mainStat": {
                "name": "hp",
                "value": 4000,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 14
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 7
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 15
                },
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 18
                }
            ],
            "setBonus": "ABYSSAL_WARD",
            "stars": 5,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1734003600634",
            "slot": "generator",
            "mainStat": {
                "name": "defence",
                "value": 800,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 617
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 4
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 20
                },
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 5
                }
            ],
            "setBonus": "ABYSSAL_SAFEGUARD",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1734003653269",
            "slot": "sensor",
            "mainStat": {
                "name": "defence",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 5
                },
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 9
                },
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 1056
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 7
                }
            ],
            "setBonus": "ABYSSAL_SAFEGUARD",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1734003707240",
            "slot": "software",
            "mainStat": {
                "name": "hp",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 152
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 14
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 5
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 6
                }
            ],
            "setBonus": "ABYSSAL_WARD",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1734003762359",
            "slot": "thrusters",
            "mainStat": {
                "name": "defence",
                "value": 40,
                "type": "percentage"
            },
            "subStats": [
                {
                    "name": "hp",
                    "type": "flat",
                    "value": 443
                },
                {
                    "name": "speed",
                    "type": "flat",
                    "value": 11
                },
                {
                    "name": "defence",
                    "type": "flat",
                    "value": 144
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 7
                }
            ],
            "setBonus": "ABYSSAL_WARD",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1734004049756",
            "slot": "thrusters",
            "mainStat": {
                "name": "speed",
                "value": 40,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "hp",
                    "type": "percentage",
                    "value": 14
                },
                {
                    "name": "security",
                    "type": "flat",
                    "value": 13
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 7
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 5
                }
            ],
            "setBonus": "BOOST",
            "stars": 5,
            "rarity": "epic",
            "level": 16
        },
        {
            "id": "1734004132433",
            "slot": "hull",
            "mainStat": {
                "name": "hp",
                "value": 5000,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 7
                },
                {
                    "name": "attack",
                    "type": "flat",
                    "value": 316
                },
                {
                    "name": "hacking",
                    "type": "flat",
                    "value": 20
                },
                {
                    "name": "defence",
                    "type": "percentage",
                    "value": 6
                }
            ],
            "setBonus": "ABYSSAL_BREACH",
            "stars": 6,
            "rarity": "legendary",
            "level": 16
        },
        {
            "id": "1734256091713",
            "slot": "generator",
            "mainStat": {
                "name": "defence",
                "value": 1000,
                "type": "flat"
            },
            "subStats": [
                {
                    "name": "attack",
                    "type": "percentage",
                    "value": 7
                },
                {
                    "name": "critDamage",
                    "type": "percentage",
                    "value": 14
                },
                {
                    "name": "crit",
                    "type": "percentage",
                    "value": 12
                },
                {
                    "name": "speed",
                    "type": "flat",
                    "value": 13
                }
            ],
            "setBonus": "CRITICAL",
            "stars": 6,
            "rarity": "legendary",
            "level": 16
        }
    ]
}