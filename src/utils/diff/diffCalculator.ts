import { DiffResult } from '../../types/diff';

export const compareValues = (oldValue: unknown, newValue: unknown): boolean => {
    if (typeof oldValue !== typeof newValue) return false;
    if (typeof oldValue === 'object' && oldValue !== null && newValue !== null) {
        return JSON.stringify(oldValue) === JSON.stringify(newValue);
    }
    return oldValue === newValue;
};

export const generateDiff = (
    obj1: unknown,
    obj2: unknown,
    path: string = '',
    depth: number = 0
): DiffResult[] => {
    const results: DiffResult[] = [];

    // Prevent infinite recursion by limiting depth
    if (depth > 10) {
        results.push({
            type: 'modified',
            path,
            oldValue: obj1,
            newValue: obj2,
            description: `Deep comparison skipped (depth limit reached)`,
        });
        return results;
    }

    if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) {
        if (!compareValues(obj1, obj2)) {
            results.push({
                type: 'modified',
                path,
                oldValue: obj1,
                newValue: obj2,
                description: `Value changed from ${JSON.stringify(obj1)} to ${JSON.stringify(obj2)}`,
            });
        } else {
            results.push({
                type: 'unchanged',
                path,
                oldValue: obj1,
                newValue: obj2,
                description: `Value unchanged: ${JSON.stringify(obj1)}`,
            });
        }
        return results;
    }

    // Handle arrays
    if (Array.isArray(obj1) && Array.isArray(obj2)) {
        const maxLength = Math.max(obj1.length, obj2.length);
        for (let i = 0; i < maxLength; i++) {
            const itemPath = `${path}[${i}]`;
            if (i >= obj1.length) {
                results.push({
                    type: 'added',
                    path: itemPath,
                    newValue: obj2[i],
                    description: `Added item: ${JSON.stringify(obj2[i])}`,
                });
            } else if (i >= obj2.length) {
                results.push({
                    type: 'removed',
                    path: itemPath,
                    oldValue: obj1[i],
                    description: `Removed item: ${JSON.stringify(obj1[i])}`,
                });
            } else {
                results.push(...generateDiff(obj1[i], obj2[i], itemPath, depth + 1));
            }
        }
        return results;
    }

    // Handle objects - limit the number of properties to prevent stack overflow
    const obj1Keys = Object.keys(obj1 as Record<string, unknown>);
    const obj2Keys = Object.keys(obj2 as Record<string, unknown>);
    const allKeys = new Set([...obj1Keys, ...obj2Keys]);

    // If there are too many keys, do a shallow comparison
    if (allKeys.size > 100) {
        const obj1Str = JSON.stringify(obj1);
        const obj2Str = JSON.stringify(obj2);
        if (obj1Str !== obj2Str) {
            results.push({
                type: 'modified',
                path,
                oldValue: obj1,
                newValue: obj2,
                description: `Large object changed (${allKeys.size} properties)`,
            });
        } else {
            results.push({
                type: 'unchanged',
                path,
                oldValue: obj1,
                newValue: obj2,
                description: `Large object unchanged (${allKeys.size} properties)`,
            });
        }
        return results;
    }

    for (const key of allKeys) {
        const keyPath = path ? `${path}.${key}` : key;
        const obj1Record = obj1 as Record<string, unknown>;
        const obj2Record = obj2 as Record<string, unknown>;

        if (!(key in obj1Record)) {
            results.push({
                type: 'added',
                path: keyPath,
                newValue: obj2Record[key],
                description: `Added property: ${key} = ${JSON.stringify(obj2Record[key])}`,
            });
        } else if (!(key in obj2Record)) {
            results.push({
                type: 'removed',
                path: keyPath,
                oldValue: obj1Record[key],
                description: `Removed property: ${key} = ${JSON.stringify(obj1Record[key])}`,
            });
        } else {
            results.push(...generateDiff(obj1Record[key], obj2Record[key], keyPath, depth + 1));
        }
    }

    return results;
};
