import { DiffResult, DiffGroup } from '../../types/diff';

export const groupResults = (diffResults: DiffResult[]): DiffGroup[] => {
    const groups = new Map<string, DiffGroup>();

    // Group by type first (added, removed, modified)
    const addedBySection = new Map<string, DiffResult[]>();
    const removedBySection = new Map<string, DiffResult[]>();
    const modifiedBySection = new Map<string, DiffResult[]>();

    diffResults.forEach((result) => {
        if (result.type === 'added') {
            const section = result.path.split('[')[0];
            if (!addedBySection.has(section)) {
                addedBySection.set(section, []);
            }
            addedBySection.get(section)!.push(result);
        } else if (result.type === 'removed') {
            const section = result.path.split('[')[0];
            if (!removedBySection.has(section)) {
                removedBySection.set(section, []);
            }
            removedBySection.get(section)!.push(result);
        } else if (result.type === 'modified') {
            const section = result.path.split('[')[0];
            if (!modifiedBySection.has(section)) {
                modifiedBySection.set(section, []);
            }
            modifiedBySection.get(section)!.push(result);
        }
    });

    // Create added groups
    addedBySection.forEach((items, section) => {
        groups.set(`added-${section}`, {
            name: `Added ${section}`,
            changes: items,
            type: 'added',
        });
    });

    // Create removed groups
    removedBySection.forEach((items, section) => {
        groups.set(`removed-${section}`, {
            name: `Removed ${section}`,
            changes: items,
            type: 'removed',
        });
    });

    // Create modified groups with hierarchical structure
    modifiedBySection.forEach((items, section) => {
        // Group items within this section by their individual groups
        const itemsByGroup = new Map<string, DiffResult[]>();

        items.forEach((item) => {
            const groupKey = item.groupKey || 'unknown';
            if (!itemsByGroup.has(groupKey)) {
                itemsByGroup.set(groupKey, []);
            }
            itemsByGroup.get(groupKey)!.push(item);
        });

        // Create child groups for each individual item
        const children: Array<{
            name: string;
            changes: DiffResult[];
            type: 'modified';
        }> = [];

        itemsByGroup.forEach((groupItems, groupKey) => {
            const groupName = groupItems[0]?.groupName || groupKey;
            children.push({
                name: groupName,
                changes: groupItems,
                type: 'modified',
            });
        });

        groups.set(`modified-${section}`, {
            name: `${section} Modified`,
            changes: [], // Parent doesn't have direct changes
            type: 'modified',
            isParent: true,
            children,
        });
    });

    return Array.from(groups.values());
};

export const getDiffSummary = (diffResults: DiffResult[]) => {
    return diffResults.reduce(
        (summary, result) => {
            summary[result.type]++;
            return summary;
        },
        { added: 0, removed: 0, modified: 0, unchanged: 0 }
    );
};
