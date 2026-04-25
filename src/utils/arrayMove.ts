export function arrayMove<T>(array: T[], fromIndex: number, toIndex: number): T[] {
    if (fromIndex === toIndex) return array;
    if (fromIndex < 0 || fromIndex >= array.length) return array;
    if (toIndex < 0 || toIndex >= array.length) return array;

    const next = array.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return next;
}
