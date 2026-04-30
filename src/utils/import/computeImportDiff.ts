import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { EngineeringStats } from '../../types/stats';
import { ImportDiff, LeveledShip, RefittedShip, RemovedShip } from '../../types/importDiff';
import { GEAR_SLOTS, IMPLANT_SLOTS } from '../../constants/gearTypes';

const STANDARD_SLOTS = new Set(Object.keys(GEAR_SLOTS));
const IMPLANT_SLOT_SET = new Set(Object.keys(IMPLANT_SLOTS));

function isGear(piece: GearPiece): boolean {
    return STANDARD_SLOTS.has(piece.slot);
}

function isImplant(piece: GearPiece): boolean {
    return IMPLANT_SLOT_SET.has(piece.slot);
}

export function computeImportDiff(
    oldShips: Ship[],
    oldInventory: GearPiece[],
    newShips: Ship[],
    newInventory: GearPiece[],
    newEngStats: EngineeringStats | null = null
): ImportDiff {
    const isFreshImport = oldShips.length === 0 && oldInventory.length === 0;

    // ── Ships ──────────────────────────────────────────────────────────────
    const oldShipMap = new Map(oldShips.map((s) => [s.id, s]));
    const newShipMap = new Map(newShips.map((s) => [s.id, s]));

    const legendaryAdded: Ship[] = [];
    const legendaryLeveled: LeveledShip[] = [];
    const legendaryRefitted: RefittedShip[] = [];
    const legendaryRemoved: RemovedShip[] = [];
    const epicLeveled: LeveledShip[] = [];
    const epicRefitted: RefittedShip[] = [];
    let epicAdded = 0;
    let epicRemoved = 0;
    let otherAdded = 0;
    let otherRemoved = 0;

    for (const newShip of newShips) {
        const old = oldShipMap.get(newShip.id);

        if (!old) {
            if (newShip.rarity === 'legendary') legendaryAdded.push(newShip);
            else if (newShip.rarity === 'epic') epicAdded++;
            else otherAdded++;
            continue;
        }

        if (newShip.rarity === 'legendary' || newShip.rarity === 'epic') {
            const newLevel = newShip.level ?? 0;
            const oldLevel = old.level ?? 0;
            if (newLevel > oldLevel) {
                const entry: LeveledShip = { ship: newShip, oldLevel };
                if (newShip.rarity === 'legendary') legendaryLeveled.push(entry);
                else epicLeveled.push(entry);
            }
            if (newShip.refits.length > old.refits.length) {
                const entry: RefittedShip = { ship: newShip, oldRefitCount: old.refits.length };
                if (newShip.rarity === 'legendary') legendaryRefitted.push(entry);
                else epicRefitted.push(entry);
            }
        }
    }

    for (const old of oldShips) {
        if (!newShipMap.has(old.id)) {
            if (old.rarity === 'legendary')
                legendaryRemoved.push({ id: old.id, name: old.name, rarity: old.rarity });
            else if (old.rarity === 'epic') epicRemoved++;
            else otherRemoved++;
        }
    }

    // ── Gear ───────────────────────────────────────────────────────────────
    const oldGear = oldInventory.filter(isGear);
    const newGear = newInventory.filter(isGear);

    const oldGearIds = new Set(oldGear.map((g) => g.id));
    const newGearIds = new Set(newGear.map((g) => g.id));

    const gearAdded = newGear.filter((g) => !oldGearIds.has(g.id)).length;
    const gearRemoved = oldGear.filter((g) => !newGearIds.has(g.id)).length;
    const newLegendary6Star = newGear.filter(
        (g) => !oldGearIds.has(g.id) && g.rarity === 'legendary' && g.stars === 6
    );

    // ── Implants ───────────────────────────────────────────────────────────
    const oldImplants = oldInventory.filter(isImplant);
    const newImplants = newInventory.filter(isImplant);

    const oldImplantIds = new Set(oldImplants.map((g) => g.id));
    const newImplantIds = new Set(newImplants.map((g) => g.id));

    const implantsAdded = newImplants.filter((g) => !oldImplantIds.has(g.id)).length;
    const implantsRemoved = oldImplants.filter((g) => !newImplantIds.has(g.id)).length;
    const newLegendaryImplants = newImplants.filter(
        (g) => !oldImplantIds.has(g.id) && g.rarity === 'legendary'
    );

    // ── Engineering stats ──────────────────────────────────────────────────
    const engineeringStatsCount =
        newEngStats?.stats.reduce((sum, s) => sum + s.stats.length, 0) ?? 0;

    return {
        isFreshImport,
        ships: {
            legendary: {
                added: legendaryAdded,
                leveled: legendaryLeveled,
                refitted: legendaryRefitted,
                removed: legendaryRemoved,
            },
            epic: {
                leveled: epicLeveled,
                refitted: epicRefitted,
                added: epicAdded,
                removed: epicRemoved,
            },
            otherAdded,
            otherRemoved,
        },
        gear: {
            added: gearAdded,
            removed: gearRemoved,
            newLegendary6Star,
        },
        implants: {
            added: implantsAdded,
            removed: implantsRemoved,
            newLegendary: newLegendaryImplants,
        },
        engineeringStatsCount,
    };
}

export function hasChanges(diff: ImportDiff): boolean {
    const { ships, gear, implants } = diff;
    return (
        ships.legendary.added.length > 0 ||
        ships.legendary.leveled.length > 0 ||
        ships.legendary.refitted.length > 0 ||
        ships.legendary.removed.length > 0 ||
        ships.epic.leveled.length > 0 ||
        ships.epic.refitted.length > 0 ||
        ships.epic.added > 0 ||
        ships.epic.removed > 0 ||
        ships.otherAdded > 0 ||
        ships.otherRemoved > 0 ||
        gear.added > 0 ||
        gear.removed > 0 ||
        gear.newLegendary6Star.length > 0 ||
        implants.added > 0 ||
        implants.removed > 0 ||
        implants.newLegendary.length > 0
    );
}
