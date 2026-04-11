import { describe, it, expect } from 'vitest';
import { importPlayerData } from '../importPlayerData';
import { ExportedPlayData } from '../../types/exportedPlayData';

// ---------------------------------------------------------------------------
// Fixture helpers — minimal valid objects that satisfy ExportedPlayData shape
// ---------------------------------------------------------------------------

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const baseAttributes = (
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

const makeUnit = (
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

const makeGearItem = (
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
    MainStats: [{ Level: 16, Attribute: { Attribute: 'Power', Type: 'Flat', Value: 1000 } }],
    SubStats: [
        { Level: 1, Attribute: { Attribute: 'HullPoints', Type: 'Flat', Value: 500 } },
        { Level: 1, Attribute: { Attribute: 'Defense', Type: 'Flat', Value: 200 } },
    ],
    ...overrides,
});

const makeImplantItem = (
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
    MainStats: [{ Level: 1, Attribute: { Attribute: 'Power', Type: 'Percentage', Value: 0.1 } }],
    SubStats: [],
    ...overrides,
});

const makeEngineeringStat = (
    overrides: Partial<ExportedPlayData['Engineering'][0]> = {}
): ExportedPlayData['Engineering'][0] => ({
    Type: 'Attacker',
    Attribute: 'Power',
    ModifierType: 'Flat',
    Level: 100,
    ...overrides,
});

const makeExportData = (overrides: Partial<ExportedPlayData> = {}): ExportedPlayData => ({
    Units: [],
    Equipment: [],
    Engineering: [],
    ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('importPlayerData', () => {
    // -----------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------
    describe('happy path', () => {
        it('returns success with empty data when export has no entries', async () => {
            const result = await importPlayerData(makeExportData());

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
            expect(result.data!.ships).toHaveLength(0);
            expect(result.data!.inventory).toHaveLength(0);
            expect(result.data!.engineeringStats.stats).toHaveLength(0);
        });

        it('transforms a ship with correct base stats', async () => {
            const result = await importPlayerData(makeExportData({ Units: [makeUnit()] }));

            expect(result.success).toBe(true);
            const ship = result.data!.ships[0];
            expect(ship.id).toBe('unit-aaa-111');
            expect(ship.name).toBe('Vanguard');
            expect(ship.rarity).toBe('epic');
            expect(ship.faction).toBe('TERRAN_COMBINE');
            expect(ship.type).toBe('ATTACKER');
            expect(ship.affinity).toBe('thermal');
            expect(ship.level).toBe(60);
            expect(ship.baseStats.hp).toBe(50000);
            expect(ship.baseStats.attack).toBe(10000);
            expect(ship.baseStats.defence).toBe(8000);
            expect(ship.baseStats.speed).toBe(300);
            expect(ship.baseStats.hacking).toBe(5000);
            expect(ship.baseStats.security).toBe(3000);
            expect(ship.baseStats.crit).toBe(50); // 0.5 * 100
            expect(ship.baseStats.critDamage).toBe(150); // 1.5 * 100
        });

        it('transforms gear with main stat and sub stats', async () => {
            const result = await importPlayerData(makeExportData({ Equipment: [makeGearItem()] }));

            expect(result.success).toBe(true);
            const gear = result.data!.inventory[0];
            expect(gear.id).toBe('gear-aaa-111');
            expect(gear.slot).toBe('weapon');
            expect(gear.level).toBe(16);
            expect(gear.stars).toBe(6);
            expect(gear.rarity).toBe('epic');
            expect(gear.setBonus).toBe('ATTACK');
            expect(gear.mainStat).toBeDefined();
            expect(gear.mainStat!.name).toBe('attack');
            expect(gear.mainStat!.type).toBe('flat');
            expect(gear.subStats).toHaveLength(2);
        });

        it('transforms implants separately from gear', async () => {
            const result = await importPlayerData(
                makeExportData({
                    Equipment: [makeGearItem(), makeImplantItem()],
                })
            );

            expect(result.success).toBe(true);
            // Both gear and implants end up in inventory
            expect(result.data!.inventory).toHaveLength(2);

            const implant = result.data!.inventory.find((i) => i.id === 'implant-aaa-111');
            expect(implant).toBeDefined();
            expect(implant!.mainStat).toBeNull();
            expect(implant!.setBonus).toBe('ONSLAUGHT_ALPHA');
        });

        it('assigns gear to the correct ship via EquippedOnUnit', async () => {
            const unit = makeUnit({ Id: 'ship-1' });
            const gear = makeGearItem({
                Id: 'gear-1',
                Slot: 'Weapon',
                EquippedOnUnit: 'ship-1',
            });

            const result = await importPlayerData(
                makeExportData({ Units: [unit], Equipment: [gear] })
            );

            expect(result.success).toBe(true);
            const ship = result.data!.ships[0];
            expect(ship.equipment.weapon).toBe('gear-1');
        });

        it('assigns implants to the correct ship', async () => {
            const unit = makeUnit({ Id: 'ship-1' });
            const implant = makeImplantItem({
                Id: 'implant-1',
                EquippedOnUnit: 'ship-1',
            });

            const result = await importPlayerData(
                makeExportData({ Units: [unit], Equipment: [implant] })
            );

            expect(result.success).toBe(true);
            const ship = result.data!.ships[0];
            expect(ship.implants.minor_alpha).toBe('implant-1');
        });

        it('transforms engineering stats grouped by ship type', async () => {
            const result = await importPlayerData(
                makeExportData({
                    Engineering: [
                        makeEngineeringStat({ Type: 'Attacker', Attribute: 'Power', Level: 50 }),
                        makeEngineeringStat({
                            Type: 'Attacker',
                            Attribute: 'HullPoints',
                            Level: 30,
                        }),
                        makeEngineeringStat({ Type: 'Defender', Attribute: 'Defense', Level: 20 }),
                    ],
                })
            );

            expect(result.success).toBe(true);
            const stats = result.data!.engineeringStats.stats;
            expect(stats).toHaveLength(2); // ATTACKER and DEFENDER groups

            const attacker = stats.find((s) => s.shipType === 'ATTACKER');
            expect(attacker).toBeDefined();
            expect(attacker!.stats).toHaveLength(2);

            const defender = stats.find((s) => s.shipType === 'DEFENDER');
            expect(defender).toBeDefined();
            expect(defender!.stats).toHaveLength(1);
        });

        it('sets valid calibration when CalibratedForUnitId matches an imported ship', async () => {
            const unit = makeUnit({ Id: 'ship-1' });
            const gear = makeGearItem({
                Id: 'gear-1',
                CalibratedForUnitId: 'ship-1',
            });

            const result = await importPlayerData(
                makeExportData({ Units: [unit], Equipment: [gear] })
            );

            expect(result.success).toBe(true);
            const gearPiece = result.data!.inventory.find((i) => i.id === 'gear-1');
            expect(gearPiece!.calibration).toBeDefined();
            expect(gearPiece!.calibration!.shipId).toBe('ship-1');
        });
    });

    // -----------------------------------------------------------------------
    // Ship deduplication
    // -----------------------------------------------------------------------
    describe('ship deduplication', () => {
        it('merges identical ships into one with copies count', async () => {
            const unit1 = makeUnit({ Id: 'ship-1' });
            const unit2 = makeUnit({ Id: 'ship-2' }); // same stats, different ID

            const result = await importPlayerData(makeExportData({ Units: [unit1, unit2] }));

            expect(result.success).toBe(true);
            expect(result.data!.ships).toHaveLength(1);
            expect(result.data!.ships[0].copies).toBe(2);
            // First occurrence's ID is kept
            expect(result.data!.ships[0].id).toBe('ship-1');
        });

        it('does not merge ships with different stats', async () => {
            const unit1 = makeUnit({ Id: 'ship-1' });
            const unit2 = makeUnit({
                Id: 'ship-2',
                Attributes: {
                    ...makeUnit().Attributes,
                    BaseWithLevelAndRank: baseAttributes({ Power: 99999 }),
                },
            });

            const result = await importPlayerData(makeExportData({ Units: [unit1, unit2] }));

            expect(result.success).toBe(true);
            expect(result.data!.ships).toHaveLength(2);
        });

        it('does not merge ships with different levels', async () => {
            const unit1 = makeUnit({ Id: 'ship-1', Level: 60 });
            const unit2 = makeUnit({ Id: 'ship-2', Level: 50 });

            const result = await importPlayerData(makeExportData({ Units: [unit1, unit2] }));

            expect(result.success).toBe(true);
            expect(result.data!.ships).toHaveLength(2);
        });
    });

    // -----------------------------------------------------------------------
    // Calibration edge cases (the bug we just fixed)
    // -----------------------------------------------------------------------
    describe('calibration edge cases', () => {
        it('strips calibration referencing a ship not in the import (sold ship)', async () => {
            const gear = makeGearItem({
                Id: 'gear-1',
                CalibratedForUnitId: 'nonexistent-ship-id',
            });

            const result = await importPlayerData(
                makeExportData({
                    Units: [makeUnit({ Id: 'ship-1' })],
                    Equipment: [gear],
                })
            );

            expect(result.success).toBe(true);
            const gearPiece = result.data!.inventory.find((i) => i.id === 'gear-1');
            expect(gearPiece!.calibration).toBeUndefined();
        });

        it('strips calibration referencing a deduplicated ship copy', async () => {
            // Two identical ships — ship-2 gets deduped away
            const unit1 = makeUnit({ Id: 'ship-1' });
            const unit2 = makeUnit({ Id: 'ship-2' });

            // Gear calibrated to the copy that will be deduped
            const gear = makeGearItem({
                Id: 'gear-1',
                CalibratedForUnitId: 'ship-2',
            });

            const result = await importPlayerData(
                makeExportData({ Units: [unit1, unit2], Equipment: [gear] })
            );

            expect(result.success).toBe(true);
            // ship-2 was deduped — only ship-1 survives
            expect(result.data!.ships).toHaveLength(1);
            expect(result.data!.ships[0].id).toBe('ship-1');

            // Calibration should be stripped since ship-2 doesn't exist
            const gearPiece = result.data!.inventory.find((i) => i.id === 'gear-1');
            expect(gearPiece!.calibration).toBeUndefined();
        });

        it('ignores nil UUID calibration', async () => {
            const gear = makeGearItem({
                Id: 'gear-1',
                CalibratedForUnitId: NIL_UUID,
            });

            const result = await importPlayerData(
                makeExportData({
                    Units: [makeUnit({ Id: 'ship-1' })],
                    Equipment: [gear],
                })
            );

            expect(result.success).toBe(true);
            const gearPiece = result.data!.inventory.find((i) => i.id === 'gear-1');
            expect(gearPiece!.calibration).toBeUndefined();
        });

        it('ignores null CalibratedForUnitId', async () => {
            const gear = makeGearItem({
                Id: 'gear-1',
                CalibratedForUnitId: null,
            });

            const result = await importPlayerData(
                makeExportData({
                    Units: [makeUnit({ Id: 'ship-1' })],
                    Equipment: [gear],
                })
            );

            expect(result.success).toBe(true);
            const gearPiece = result.data!.inventory.find((i) => i.id === 'gear-1');
            expect(gearPiece!.calibration).toBeUndefined();
        });

        it('ignores undefined CalibratedForUnitId', async () => {
            const gear = makeGearItem({ Id: 'gear-1' });
            // CalibratedForUnitId not set at all (undefined)

            const result = await importPlayerData(
                makeExportData({
                    Units: [makeUnit({ Id: 'ship-1' })],
                    Equipment: [gear],
                })
            );

            expect(result.success).toBe(true);
            const gearPiece = result.data!.inventory.find((i) => i.id === 'gear-1');
            expect(gearPiece!.calibration).toBeUndefined();
        });

        it('preserves calibration on gear not equipped to any ship', async () => {
            const unit = makeUnit({ Id: 'ship-1' });
            const gear = makeGearItem({
                Id: 'gear-1',
                EquippedOnUnit: null,
                CalibratedForUnitId: 'ship-1',
            });

            const result = await importPlayerData(
                makeExportData({ Units: [unit], Equipment: [gear] })
            );

            expect(result.success).toBe(true);
            const gearPiece = result.data!.inventory.find((i) => i.id === 'gear-1');
            expect(gearPiece!.shipId).toBeUndefined();
            expect(gearPiece!.calibration).toBeDefined();
            expect(gearPiece!.calibration!.shipId).toBe('ship-1');
        });

        it('preserves calibration for surviving ship when other copies are deduped', async () => {
            // Two identical ships — ship-1 is kept
            const unit1 = makeUnit({ Id: 'ship-1' });
            const unit2 = makeUnit({ Id: 'ship-2' });

            // Gear calibrated to the surviving copy
            const gear = makeGearItem({
                Id: 'gear-1',
                CalibratedForUnitId: 'ship-1',
            });

            const result = await importPlayerData(
                makeExportData({ Units: [unit1, unit2], Equipment: [gear] })
            );

            expect(result.success).toBe(true);
            const gearPiece = result.data!.inventory.find((i) => i.id === 'gear-1');
            expect(gearPiece!.calibration).toBeDefined();
            expect(gearPiece!.calibration!.shipId).toBe('ship-1');
        });
    });

    // -----------------------------------------------------------------------
    // Equipment assignment edge cases
    // -----------------------------------------------------------------------
    describe('equipment assignment edge cases', () => {
        it('handles gear equipped on a ship not in Units array', async () => {
            const gear = makeGearItem({
                Id: 'gear-1',
                EquippedOnUnit: 'nonexistent-ship',
            });

            const result = await importPlayerData(
                makeExportData({ Units: [makeUnit({ Id: 'ship-1' })], Equipment: [gear] })
            );

            expect(result.success).toBe(true);
            // Gear still exists in inventory
            const gearPiece = result.data!.inventory.find((i) => i.id === 'gear-1');
            expect(gearPiece).toBeDefined();
            // Ship doesn't get the gear assigned
            expect(result.data!.ships[0].equipment.weapon).toBeUndefined();
        });

        it('assigns multiple gear pieces to different slots on the same ship', async () => {
            const unit = makeUnit({ Id: 'ship-1' });
            const weapon = makeGearItem({
                Id: 'weapon-1',
                Slot: 'Weapon',
                EquippedOnUnit: 'ship-1',
            });
            const hull = makeGearItem({
                Id: 'hull-1',
                Slot: 'Hull',
                EquippedOnUnit: 'ship-1',
                Set: 'Defense',
            });

            const result = await importPlayerData(
                makeExportData({ Units: [unit], Equipment: [weapon, hull] })
            );

            expect(result.success).toBe(true);
            const ship = result.data!.ships[0];
            expect(ship.equipment.weapon).toBe('weapon-1');
            expect(ship.equipment.hull).toBe('hull-1');
        });

        it('maps "sensors" slot to "sensor"', async () => {
            const gear = makeGearItem({
                Id: 'sensor-1',
                Slot: 'Sensors',
                EquippedOnUnit: null,
            });

            const result = await importPlayerData(makeExportData({ Equipment: [gear] }));

            expect(result.success).toBe(true);
            const gearPiece = result.data!.inventory.find((i) => i.id === 'sensor-1');
            expect(gearPiece!.slot).toBe('sensor');
        });
    });

    // -----------------------------------------------------------------------
    // Ship-specific special cases
    // -----------------------------------------------------------------------
    describe('ship-specific rules', () => {
        it('sets hpRegen for Isha', async () => {
            const isha = makeUnit({ Id: 'isha-1', Name: 'Isha' });
            const result = await importPlayerData(makeExportData({ Units: [isha] }));

            expect(result.data!.ships[0].baseStats.hpRegen).toBe(5);
        });

        it('sets hpRegen for Heliodor', async () => {
            const heliodor = makeUnit({ Id: 'heli-1', Name: 'Heliodor' });
            const result = await importPlayerData(makeExportData({ Units: [heliodor] }));

            expect(result.data!.ships[0].baseStats.hpRegen).toBe(8);
        });

        it('sets damageReduction for Iridium with refit >= 2', async () => {
            const iridium = makeUnit({ Id: 'irid-1', Name: 'Iridium', Refit: 2 });
            const result = await importPlayerData(makeExportData({ Units: [iridium] }));

            expect(result.data!.ships[0].baseStats.damageReduction).toBe(35);
        });

        it('does not set damageReduction for Iridium with refit < 2', async () => {
            const iridium = makeUnit({ Id: 'irid-1', Name: 'Iridium', Refit: 1 });
            const result = await importPlayerData(makeExportData({ Units: [iridium] }));

            expect(result.data!.ships[0].baseStats.damageReduction).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Stat conversion
    // -----------------------------------------------------------------------
    describe('stat conversion', () => {
        it('converts CritChance to percentage (multiplied by 100)', async () => {
            const unit = makeUnit({
                Id: 'ship-1',
                Attributes: {
                    ...makeUnit().Attributes,
                    BaseWithLevelAndRank: baseAttributes({ CritChance: 0.35 }),
                },
            });

            const result = await importPlayerData(makeExportData({ Units: [unit] }));
            expect(result.data!.ships[0].baseStats.crit).toBe(35);
        });

        it('converts DefensePenetration to percentage (multiplied by 100)', async () => {
            const unit = makeUnit({
                Id: 'ship-1',
                Attributes: {
                    ...makeUnit().Attributes,
                    BaseWithLevelAndRank: baseAttributes({ DefensePenetration: 0.25 }),
                },
            });

            const result = await importPlayerData(makeExportData({ Units: [unit] }));
            expect(result.data!.ships[0].baseStats.defensePenetration).toBe(25);
        });

        it('converts percentage gear sub stats correctly', async () => {
            const gear = makeGearItem({
                Id: 'gear-1',
                SubStats: [
                    {
                        Level: 1,
                        Attribute: { Attribute: 'Power', Type: 'Percentage', Value: 0.12 },
                    },
                ],
            });

            const result = await importPlayerData(makeExportData({ Equipment: [gear] }));
            const gearPiece = result.data!.inventory[0];
            expect(gearPiece.subStats[0].value).toBe(12); // 0.12 * 100
            expect(gearPiece.subStats[0].type).toBe('percentage');
        });
    });

    // -----------------------------------------------------------------------
    // Refits
    // -----------------------------------------------------------------------
    describe('refits', () => {
        it('creates empty refits matching the Refit count', async () => {
            const unit = makeUnit({ Id: 'ship-1', Refit: 3 });
            const result = await importPlayerData(makeExportData({ Units: [unit] }));

            const ship = result.data!.ships[0];
            expect(ship.refits).toHaveLength(3);
            // Each empty refit gets a default attack stat
            ship.refits.forEach((refit) => {
                expect(refit.id).toBeDefined();
                expect(refit.stats.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('distributes refit stats across refits', async () => {
            const unit = makeUnit({
                Id: 'ship-1',
                Refit: 2,
                Attributes: {
                    ...makeUnit().Attributes,
                    Refit: [
                        { Attribute: 'Power', Type: 'Flat', Value: 500 },
                        { Attribute: 'HullPoints', Type: 'Flat', Value: 1000 },
                    ],
                },
            });

            const result = await importPlayerData(makeExportData({ Units: [unit] }));
            const ship = result.data!.ships[0];
            expect(ship.refits).toHaveLength(2);
            // Stats distributed: first stat → refit[0], second stat → refit[1]
            expect(ship.refits[0].stats[0].name).toBe('attack');
            expect(ship.refits[0].stats[0].value).toBe(500);
            expect(ship.refits[1].stats[0].name).toBe('hp');
            expect(ship.refits[1].stats[0].value).toBe(1000);
        });
    });

    // -----------------------------------------------------------------------
    // Error handling
    // -----------------------------------------------------------------------
    describe('error handling', () => {
        it('returns success: false for malformed data', async () => {
            // Cast to bypass type checking — simulates corrupt export file
            const result = await importPlayerData({
                Units: null,
                Equipment: [],
                Engineering: [],
            } as unknown as ExportedPlayData);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
    });
});
