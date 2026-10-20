import { StorageKey } from '../../constants/storage';
import { useShips } from '../../contexts/ShipsContext';
import { isDemoDataLoaded } from '../../utils/demoData';

const DAY_MS = 24 * 60 * 60 * 1000;

/** "today", "1 day ago", "N days ago"; null when the timestamp is missing or unparseable. */
export const formatLastImport = (iso: string | null, now: Date): string | null => {
    if (!iso) return null;
    const at = new Date(iso).getTime();
    if (Number.isNaN(at)) return null;
    const days = Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
    if (days === 0) return 'today';
    return days === 1 ? '1 day ago' : `${days} days ago`;
};

export const readLastImport = (): string | null => {
    try {
        return localStorage.getItem(StorageKey.LAST_IMPORT_AT);
    } catch {
        return null;
    }
};

/** Whether the home page shows the returning-player panel instead of Quick Start. */
export const useShowFleetPanel = (): boolean => {
    const { ships } = useShips();
    return ships.length > 0 && !isDemoDataLoaded();
};
