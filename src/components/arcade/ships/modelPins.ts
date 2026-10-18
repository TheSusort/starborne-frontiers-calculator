/**
 * Which official ship models are in use, by visual key. The model cache never evicts a pinned
 * model, and an urgent one (the ship the player flies) is parsed even while the idle queue holds
 * heavy work back. This module has no three.js dependency, so the game can pin models without
 * loading the model chunk.
 */
const pins = new Map<string, { count: number; urgent: number }>();

/** Pins `key` until the returned release is called; releasing twice is harmless. */
export function pinModel(key: string, { urgent = false } = {}): () => void {
    const pin = pins.get(key) ?? { count: 0, urgent: 0 };
    pin.count++;
    if (urgent) pin.urgent++;
    pins.set(key, pin);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        pin.count--;
        if (urgent) pin.urgent--;
        if (pin.count === 0) pins.delete(key);
    };
}

export const isModelPinned = (key: string): boolean => pins.has(key);
export const isModelUrgent = (key: string): boolean => (pins.get(key)?.urgent ?? 0) > 0;

/**
 * Keeps one pin per key in `keys` under a single owner: `set` pins the new keys and releases the
 * ones no longer listed, `clear` releases them all.
 */
export function createPinSet({ urgent = false } = {}) {
    const held = new Map<string, () => void>();
    return {
        set(keys: Iterable<string | null | undefined>) {
            const next = new Set<string>();
            for (const k of keys) if (k) next.add(k);
            for (const [k, release] of held) {
                if (!next.has(k)) {
                    release();
                    held.delete(k);
                }
            }
            for (const k of next) if (!held.has(k)) held.set(k, pinModel(k, { urgent }));
        },
        clear() {
            for (const release of held.values()) release();
            held.clear();
        },
    };
}
