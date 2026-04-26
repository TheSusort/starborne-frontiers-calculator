import { ExportedPlayData } from '../../types/exportedPlayData';

// ---------------------------------------------------------------------------
// Fixture helpers — minimal valid objects that satisfy ExportedPlayData shape
// ---------------------------------------------------------------------------

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const baseAttributes = (
    overrides: Partial<ExportedPlayData['Units'][0]['Attributes']['BaseWithLevelAndRank']> = {}
): ExportedPlayData['Units'][0]['Attributes']['BaseWithLevelAndRank'] => ({
    Initiative: 300,
    HullPoints: 50000,
    ShieldPoints: 0,
    Security: 3000,
    Manipulation: 5000,
    Power: 10000,
    CritChance: 0.5,
    CritBoost: 1.5,
    Defense: 8000,
    CritResistance: 0,
    DefensePenetration: 0,
    ShieldPenetration: 0,
    ...overrides,
});

export const makeUnit = (
    overrides: Partial<ExportedPlayData['Units'][0]> = {}
): ExportedPlayData['Units'][0] => ({
    Id: 'unit-aaa-111',
    DefinitionId: 'def-1',
    Name: 'Vanguard',
    Faction: 'Terran',
    Rarity: 'Epic',
    ShipType: 'Attacker',
    Affinity: 'Red',
    Rank: 5,
    Level: 60,
    Refit: 0,
    Attributes: {
        BaseWithLevelAndRank: baseAttributes(),
        WithRefitAndEngineering: baseAttributes(),
        Total: baseAttributes(),
        Refit: [],
        Engineering: [],
    },
    Skills: [],
    ...overrides,
});

export const makeGearItem = (
    overrides: Partial<ExportedPlayData['Equipment'][0]> = {}
): ExportedPlayData['Equipment'][0] => ({
    Id: 'gear-aaa-111',
    EquippedOnUnit: null,
    Name: 'Weapon Mk I',
    Level: 16,
    Rank: 6,
    Slot: 'Weapon',
    Set: 'Attack',
    Rarity: 'Epic',
    Locked: false,
    CalibratedForUnitId: null,
    CalibrationLevel: null,
    MainStats: [{ Level: 16, Attribute: { Attribute: 'Power', Type: 'Flat', Value: 1000 } }],
    SubStats: [
        { Level: 1, Attribute: { Attribute: 'HullPoints', Type: 'Flat', Value: 500 } },
        { Level: 1, Attribute: { Attribute: 'Defense', Type: 'Flat', Value: 200 } },
    ],
    ...overrides,
});

export const makeImplantItem = (
    overrides: Partial<ExportedPlayData['Equipment'][0]> = {}
): ExportedPlayData['Equipment'][0] => ({
    Id: 'implant-aaa-111',
    EquippedOnUnit: null,
    Name: 'Minor Alpha Implant',
    Level: 1,
    Rank: 1,
    Slot: 'minor_alpha',
    Set: 'Implant_Minor_Alpha_Power_Perc',
    Rarity: 'Epic',
    Locked: false,
    CalibratedForUnitId: null,
    CalibrationLevel: null,
    MainStats: [{ Level: 1, Attribute: { Attribute: 'Power', Type: 'Percentage', Value: 0.1 } }],
    SubStats: [],
    ...overrides,
});

export const makeEngineeringStat = (
    overrides: Partial<ExportedPlayData['Engineering'][0]> = {}
): ExportedPlayData['Engineering'][0] => ({
    Type: 'Attacker',
    Attribute: 'Power',
    ModifierType: 'Flat',
    Level: 100,
    ...overrides,
});

export const makeExportData = (overrides: Partial<ExportedPlayData> = {}): ExportedPlayData => ({
    Units: [],
    Equipment: [],
    Engineering: [],
    ...overrides,
});
