import { ShipSkills } from '../../types/abilities';

// Selenite: Active deals 200% + 10% max HP; adds 1 charge if enemy Stealthed. Charge cost 4.
export const SELENITE: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 's1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 200 },
                },
                {
                    id: 's2',
                    type: 'additional-damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'additional-damage', stat: 'hp', pct: 10 },
                },
                {
                    id: 's3',
                    type: 'charge',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [
                        {
                            subject: 'enemy-buff',
                            derivable: false,
                            manualCount: 1,
                            buffName: 'Stealth',
                        },
                    ],
                    config: { type: 'charge', amount: 1 },
                },
            ],
        },
        {
            slot: 'charged',
            abilities: [
                {
                    id: 's4',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 300 },
                },
            ],
        },
    ],
};

// Lodolite: +X% damage scaling, OR-grouped over Defender / Stealth / Concentrate Fire.
export const LODOLITE: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'l1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [
                        {
                            subject: 'enemy-type',
                            derivable: true,
                            requiredEnemyType: 'Defender',
                            anyOf: true,
                        },
                        {
                            subject: 'enemy-buff',
                            derivable: false,
                            manualCount: 1,
                            buffName: 'Stealth',
                            anyOf: true,
                        },
                        {
                            subject: 'enemy-debuff',
                            derivable: true,
                            buffName: 'Concentrate Fire',
                            anyOf: true,
                        },
                    ],
                    scaling: { conditionIndex: 0, perUnit: 10, cap: 30 },
                    config: { type: 'damage', multiplier: 200 },
                },
            ],
        },
    ],
};

// Lionheart: the REAL parser-output shape (PR F4) for the pre-fight passive
// "At the start of combat, this Unit grants all adjacent allies 10% of its HP."
// — a donor-scaled permanent HP grant to adjacent allies, applied to plan stats
// by the battle sim's pre-fight layer (F5). Asserted equal to buildShipAbilities
// output (modulo generated id) in src/types/__tests__/abilities.test.ts.
export const LIONHEART: ShipSkills = {
    slots: [
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'h1',
                    type: 'pre-combat-stat',
                    target: 'adjacent-allies',
                    trigger: 'pre-combat',
                    conditions: [],
                    config: {
                        type: 'pre-combat-stat',
                        stat: 'hp',
                        value: 10,
                        valueKind: 'percent-of-donor',
                    },
                    autoFilled: true,
                },
            ],
        },
    ],
};
