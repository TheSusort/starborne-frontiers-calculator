import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    makeUnit,
    makeGearItem,
    makeImplantItem,
    makeExportData,
} from '../../src/utils/__tests__/importPlayerData.fixtures';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'fixtures', 'gameData.json');

// 5 ships with unique Ids. Mix of levels; at least one at Level 60 to exercise
// the template-proposal branch during import.
const units = [
    makeUnit({
        Id: 'e2e-ship-1',
        DefinitionId: 'def-e2e-1',
        Name: 'E2E Vanguard',
        Level: 60,
        Rank: 6,
        Refit: 2,
    }),
    makeUnit({
        Id: 'e2e-ship-2',
        DefinitionId: 'def-e2e-2',
        Name: 'E2E Sentinel',
        Faction: 'Terran',
        Rarity: 'Rare',
        ShipType: 'Defender',
        Level: 45,
        Rank: 4,
        Refit: 1,
    }),
    makeUnit({
        Id: 'e2e-ship-3',
        DefinitionId: 'def-e2e-3',
        Name: 'E2E Mender',
        Faction: 'Octavian',
        Rarity: 'Epic',
        ShipType: 'Supporter',
        Level: 50,
        Rank: 5,
        Refit: 0,
    }),
    makeUnit({
        Id: 'e2e-ship-4',
        DefinitionId: 'def-e2e-4',
        Name: 'E2E Saboteur',
        Faction: 'Lunarii',
        Rarity: 'Epic',
        ShipType: 'Debuffer',
        Level: 55,
        Rank: 5,
        Refit: 0,
    }),
    makeUnit({
        Id: 'e2e-ship-5',
        DefinitionId: 'def-e2e-5',
        Name: 'E2E Skirmisher',
        Faction: 'Terran',
        Rarity: 'Rare',
        ShipType: 'Attacker',
        Level: 30,
        Rank: 3,
        Refit: 0,
    }),
];

// 10 gear pieces with unique Ids, covering the six gear slots and varied sets.
const gearSlots = [
    'Weapon',
    'Hull',
    'Generator',
    'Sensor',
    'Software',
    'Thrusters',
    'Weapon',
    'Hull',
    'Generator',
    'Sensor',
];
const gearPieces = gearSlots.map((slot, index) =>
    makeGearItem({
        Id: `e2e-gear-${index + 1}`,
        Name: `E2E ${slot} ${index + 1}`,
        Slot: slot,
        Level: (index % 4) * 4, // 0, 4, 8, 12, 0, 4, 8, 12, 0, 4
        Rank: (index % 6) + 1,
        Set: index % 2 === 0 ? 'Attack' : 'Defense',
    })
);

// 3 implants with unique Ids. Slot values match what the app expects —
// `implant_<type>` prefix, per src/constants/gearTypes.ts IMPLANT_SLOTS
// and GearPieceDisplay's `isImplant = gear.slot.startsWith('implant_')`
// check. The factory default slots (minor_alpha/minor_gamma/major) are
// conservatively preserved for backward compatibility with the existing
// Vitest tests; this generator overrides them with the canonical values.
const implants = [
    makeImplantItem({
        Id: 'e2e-implant-1',
        Name: 'E2E Minor Alpha Implant',
        Slot: 'implant_minor_alpha',
        Set: 'Implant_Minor_Alpha_Power_Perc',
    }),
    makeImplantItem({
        Id: 'e2e-implant-2',
        Name: 'E2E Minor Gamma Implant',
        Slot: 'implant_minor_gamma',
        Set: 'Implant_Minor_Gamma_HullPoints_Perc',
    }),
    makeImplantItem({
        Id: 'e2e-implant-3',
        Name: 'E2E Major Implant',
        Slot: 'implant_major',
        Set: 'Implant_Major_Power_Perc',
    }),
];

const equipment = [...gearPieces, ...implants];

const data = makeExportData({ Units: units, Equipment: equipment });

writeFileSync(outPath, JSON.stringify(data, null, 2));
console.log(`Wrote ${outPath}`);
console.log(`  Units: ${data.Units.length}`);
console.log(`  Equipment: ${data.Equipment.length}`);
