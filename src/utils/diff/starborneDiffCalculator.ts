import { DiffResult } from '../../types/diff';
import {
    ExportedPlayData,
    Unit,
    Equipment,
    Engineering,
    StarborneItem,
} from '../../types/starborne';

// Type for the lookup maps
type ItemWithIndex = { item: StarborneItem; index: number };

// Helper function to format engineering items
const formatEngineeringItem = (item: Engineering): string => {
    const { Type, Attribute, Level, ModifierType } = item;
    // Add percentage indicator for percentage-based modifiers
    const percentageSuffix = ModifierType === 'Percentage' ? ' (×100%)' : '';
    return `${Type || 'Unknown'} - ${Attribute || 'Unknown'} - ${Level || 0}${percentageSuffix}`;
};

// Helper function to get display name for any Starborne item
const getItemDisplayName = (item: StarborneItem, sectionName: string): string => {
    if (sectionName === 'Units') {
        return (item as Unit).Name;
    } else if (sectionName === 'Equipment') {
        return (item as Equipment).Name;
    } else if (sectionName === 'Engineering') {
        return formatEngineeringItem(item as Engineering);
    }
    return 'Unknown Item';
};

export const generateLargeFileDiff = (
    obj1: ExportedPlayData,
    obj2: ExportedPlayData
): DiffResult[] => {
    const results: DiffResult[] = [];

    // Focus on key Starborne Frontiers sections
    const keySections = ['Units', 'Equipment', 'Engineering'] as const;
    let totalChanges = 0;

    // Create unit name lookup maps for equipment changes
    const unitNameMap1 = new Map<string, string>();
    const unitNameMap2 = new Map<string, string>();

    if (obj1.Units) {
        obj1.Units.forEach((unit: Unit) => {
            unitNameMap1.set(unit.Id, unit.Name);
        });
    }
    if (obj2.Units) {
        obj2.Units.forEach((unit: Unit) => {
            unitNameMap2.set(unit.Id, unit.Name);
        });
    }

    for (const section of keySections) {
        const section1 = obj1[section] || [];
        const section2 = obj2[section] || [];

        if (Array.isArray(section1) && Array.isArray(section2)) {
            const changes = compareArrays(section1, section2, section, unitNameMap1, unitNameMap2);
            results.push(...changes);
            totalChanges += changes.length;
        }
    }

    if (totalChanges === 0) {
        results.push({
            type: 'unchanged',
            path: 'key_sections',
            oldValue: null,
            newValue: null,
            description: 'No changes detected in Units, Equipment, or Engineering sections',
        });
    }

    return results;
};

const compareArrays = (
    arr1: StarborneItem[],
    arr2: StarborneItem[],
    sectionName: keyof Pick<ExportedPlayData, 'Units' | 'Equipment' | 'Engineering'>,
    unitNameMap1: Map<string, string>,
    unitNameMap2: Map<string, string>
): DiffResult[] => {
    const results: DiffResult[] = [];

    // Create maps for efficient lookup
    const map1 = new Map<string, ItemWithIndex>();
    const map2 = new Map<string, ItemWithIndex>();

    // Index by ID or Name for Units and Equipment
    const getId = (item: StarborneItem): string => {
        if (sectionName === 'Units') return (item as Unit).Id || (item as Unit).Name;
        if (sectionName === 'Equipment') return (item as Equipment).Id || (item as Equipment).Name;
        return JSON.stringify(item); // Fallback for Engineering
    };

    arr1.forEach((item, index) => {
        const id = getId(item);
        map1.set(id, { item, index });
    });

    arr2.forEach((item, index) => {
        const id = getId(item);
        map2.set(id, { item, index });
    });

    // Find added items
    for (const [id, { item }] of map2) {
        if (!map1.has(id)) {
            const itemName = getItemDisplayName(item, sectionName);
            results.push({
                type: 'added',
                path: `${sectionName}[${id}]`,
                newValue: item,
                description: `Added ${sectionName}: ${itemName}`,
                groupKey: `${sectionName}-${id}`,
                groupName: itemName,
            });
        }
    }

    // Find removed items
    for (const [id, { item }] of map1) {
        if (!map2.has(id)) {
            const itemName = getItemDisplayName(item, sectionName);
            results.push({
                type: 'removed',
                path: `${sectionName}[${id}]`,
                oldValue: item,
                description: `Removed ${sectionName}: ${itemName}`,
                groupKey: `${sectionName}-${id}`,
                groupName: itemName,
            });
        }
    }

    // Find modified items (only check key properties to avoid deep comparison)
    for (const [id, { item: item1 }] of map1) {
        if (map2.has(id)) {
            const { item: item2 } = map2.get(id)!;
            const changes = compareKeyProperties(
                item1,
                item2,
                `${sectionName}[${id}]`,
                id,
                getItemDisplayName(item1, sectionName),
                sectionName,
                unitNameMap1,
                unitNameMap2
            );
            results.push(...changes);
        }
    }

    return results;
};

const compareKeyProperties = (
    obj1: StarborneItem,
    obj2: StarborneItem,
    path: string,
    id: string,
    groupName: string,
    sectionName: keyof Pick<ExportedPlayData, 'Units' | 'Equipment' | 'Engineering'>,
    unitNameMap1: Map<string, string>,
    unitNameMap2: Map<string, string>
): DiffResult[] => {
    const results: DiffResult[] = [];

    // Define key properties to compare for each type
    const keyProps = {
        Units: ['Level', 'Rank', 'Refit'] as const, // Removed 'Attributes' to exclude detailed stats
        Equipment: ['Level', 'Rank', 'EquippedOnUnit'] as const,
        Engineering: ['Level', 'Type', 'Attribute', 'ModifierType'] as const,
    };

    // Determine which key props to use based on path
    let propsToCheck: readonly string[] = [];
    if (path.includes('Units')) propsToCheck = keyProps.Units;
    else if (path.includes('Equipment')) propsToCheck = keyProps.Equipment;
    else if (path.includes('Engineering')) propsToCheck = keyProps.Engineering;

    for (const prop of propsToCheck) {
        if (obj1[prop as keyof StarborneItem] !== obj2[prop as keyof StarborneItem]) {
            let description = `${prop} changed from ${obj1[prop as keyof StarborneItem]} to ${obj2[prop as keyof StarborneItem]}`;
            let groupKey = `${path.split('[')[0]}-${id}`;
            let groupNameForChange = groupName;

            // Special handling for EquippedOnUnit changes
            if (prop === 'EquippedOnUnit' && sectionName === 'Equipment') {
                const equipment1 = obj1 as Equipment;
                const equipment2 = obj2 as Equipment;
                const oldUnitName = equipment1[prop]
                    ? unitNameMap1.get(equipment1[prop]!) || equipment1[prop]
                    : 'None';
                const newUnitName = equipment2[prop]
                    ? unitNameMap2.get(equipment2[prop]!) || equipment2[prop]
                    : 'None';
                const equipmentName =
                    `${equipment1.Rank} ★ ${equipment1.Name}` ||
                    `${equipment2.Rank} ★ ${equipment2.Name}` ||
                    'Unknown Equipment';
                description = `${equipmentName} equipped from ${oldUnitName} → ${newUnitName}`;

                // Move this change to the unit group instead of equipment group
                if (equipment2[prop]) {
                    groupKey = `Units-${equipment2[prop]}`;
                    groupNameForChange = newUnitName;
                } else if (equipment1[prop]) {
                    groupKey = `Units-${equipment1[prop]}`;
                    groupNameForChange = oldUnitName;
                }
            }

            results.push({
                type: 'modified',
                path: `${path}.${prop}`,
                oldValue: obj1[prop as keyof StarborneItem],
                newValue: obj2[prop as keyof StarborneItem],
                description: description,
                groupKey: groupKey,
                groupName: groupNameForChange,
            });
        }
    }

    return results;
};
