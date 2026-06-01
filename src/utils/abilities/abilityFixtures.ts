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

// Lionheart: ILLUSTRATIVE hand-built shape only (a +10% HP all-allies aura) to
// lock the `modifier` shape. The real Lionheart text is a start-of-combat grant
// of 10% HP to *adjacent* allies — do NOT use this as a parser-output assertion.
export const LIONHEART: ShipSkills = {
    slots: [
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'h1',
                    type: 'modifier',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'modifier', channel: 'hp', value: 10, isMultiplicative: true },
                },
            ],
        },
    ],
};
