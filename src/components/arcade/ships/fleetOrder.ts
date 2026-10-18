import { RARITY_ORDER } from '../../../constants/rarities';
import { asFactionName } from '../../../constants/factions';
import type { Ship } from '../../../types/ship';

const LAST_SHIP_KEY = 'arcade:lastShipId';

const rarityRank = (rarity: string) => {
    const i = RARITY_ORDER.indexOf(rarity);
    return i === -1 ? RARITY_ORDER.length : i;
};

/** Last chosen first, then rarity (legendary first), then level, highest first. */
export function orderFleet(ships: readonly Ship[], lastId: string | null): Ship[] {
    return [...ships].sort((a, b) => {
        if (a.id === lastId) return -1;
        if (b.id === lastId) return 1;
        return rarityRank(a.rarity) - rarityRank(b.rarity) || (b.level ?? 0) - (a.level ?? 0);
    });
}

/** `faction` is a `FactionName` key, or `''` for all. */
export function filterFleet(ships: readonly Ship[], query: string, faction: string): Ship[] {
    const q = query.trim().toLowerCase();
    return ships.filter(
        (s) =>
            (!q || s.name.toLowerCase().includes(q)) &&
            (!faction || asFactionName(s.faction) === faction)
    );
}

export function readLastShipId(): string | null {
    try {
        return localStorage.getItem(LAST_SHIP_KEY);
    } catch {
        return null;
    }
}

export function writeLastShipId(id: string): void {
    try {
        localStorage.setItem(LAST_SHIP_KEY, id);
    } catch {
        // Storage blocked: the choice simply isn't remembered.
    }
}
