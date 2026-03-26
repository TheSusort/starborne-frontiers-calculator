/**
 * Merges current and previous distribution data for grouped bar chart comparison.
 * Callers should pre-map their data to { name: string; value: number }[] format.
 */
export function mergeDistributions(
    current: { name: string; value: number }[],
    previous: { name: string; value: number }[] | undefined
): { name: string; current: number; previous: number }[] {
    if (!previous) {
        return current.map((item) => ({ name: item.name, current: item.value, previous: 0 }));
    }

    const merged = new Map<string, { current: number; previous: number }>();

    current.forEach((item) => {
        merged.set(item.name, { current: item.value, previous: 0 });
    });

    previous.forEach((item) => {
        const existing = merged.get(item.name);
        if (existing) {
            existing.previous = item.value;
        } else {
            merged.set(item.name, { current: 0, previous: item.value });
        }
    });

    return Array.from(merged.entries()).map(([name, values]) => ({
        name,
        ...values,
    }));
}
