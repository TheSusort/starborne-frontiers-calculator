import { useState, useEffect, useRef } from 'react';
import { useActiveProfile } from '../contexts/ActiveProfileProvider';
import {
    getSnapshotList,
    getSnapshot,
    createSnapshot,
} from '../services/statisticsSnapshotService';
import { StatisticsSnapshot, SnapshotListItem } from '../types/statisticsSnapshot';
import { Ship } from '../types/ship';
import { GearPiece } from '../types/gear';
import { EngineeringStat } from '../types/stats';
import { calculateShipStatistics } from '../utils/statistics/shipsStats';
import { calculateGearStatistics } from '../utils/statistics/gearStats';
import { calculateImplantStatistics } from '../utils/statistics/implantsStats';
import { calculateEngineeringStatistics } from '../utils/statistics/engineeringStats';

export function getFirstDayOfMonth(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}-01`;
}

export function getPreviousMonth(monthStr: string): string {
    const date = new Date(monthStr + 'T00:00:00');
    date.setMonth(date.getMonth() - 1);
    return getFirstDayOfMonth(date);
}

interface UseStatisticsSnapshotParams {
    ships: Ship[];
    gear: GearPiece[];
    implants: GearPiece[];
    engineeringStats: EngineeringStat[];
    allContextsLoaded: boolean;
}

interface UseStatisticsSnapshotReturn {
    snapshots: SnapshotListItem[];
    selectedSnapshot: StatisticsSnapshot | null;
    selectedMonth: string | null;
    setSelectedMonth: (month: string | null) => void;
    loading: boolean;
}

export function useStatisticsSnapshot({
    ships,
    gear,
    implants,
    engineeringStats,
    allContextsLoaded,
}: UseStatisticsSnapshotParams): UseStatisticsSnapshotReturn {
    const { activeProfileId } = useActiveProfile();
    const [snapshots, setSnapshots] = useState<SnapshotListItem[]>([]);
    const [selectedSnapshot, setSelectedSnapshot] = useState<StatisticsSnapshot | null>(null);
    const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const snapshotCreatedRef = useRef(false);

    const currentMonth = getFirstDayOfMonth(new Date());
    const previousMonth = getPreviousMonth(currentMonth);

    // Load snapshot list and auto-create current month snapshot
    useEffect(() => {
        if (!activeProfileId || !allContextsLoaded) return;

        const init = async () => {
            setLoading(true);

            // Fetch existing snapshots
            const list = await getSnapshotList(activeProfileId);
            setSnapshots(list);

            // Auto-create current month snapshot if missing and user has data
            const hasCurrentMonth = list.some((s) => s.snapshotMonth === currentMonth);
            if (
                !hasCurrentMonth &&
                !snapshotCreatedRef.current &&
                (ships.length > 0 || gear.length > 0)
            ) {
                snapshotCreatedRef.current = true;
                const shipsStats = calculateShipStatistics(ships);
                const gearStats = calculateGearStatistics(gear, ships);
                const implantsStats = calculateImplantStatistics(implants, ships);
                const engStats = calculateEngineeringStatistics(engineeringStats);

                await createSnapshot(activeProfileId, currentMonth, {
                    shipsStats,
                    gearStats,
                    implantsStats,
                    engineeringStats: engStats,
                });

                // Refresh list after creating
                const updatedList = await getSnapshotList(activeProfileId);
                setSnapshots(updatedList);
            }

            // Auto-select previous month if available
            const finalList = snapshotCreatedRef.current
                ? await getSnapshotList(activeProfileId)
                : list;
            setSnapshots(finalList);
            const hasPreviousMonth = finalList.some((s) => s.snapshotMonth === previousMonth);
            if (hasPreviousMonth) {
                setSelectedMonth(previousMonth);
            }

            setLoading(false);
        };

        void init();
    }, [activeProfileId, allContextsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

    // Load selected snapshot data
    useEffect(() => {
        if (!activeProfileId || !selectedMonth) {
            setSelectedSnapshot(null);
            return;
        }

        const loadSnapshot = async () => {
            setLoading(true);
            const snapshot = await getSnapshot(activeProfileId, selectedMonth);
            setSelectedSnapshot(snapshot);
            setLoading(false);
        };

        void loadSnapshot();
    }, [activeProfileId, selectedMonth]);

    return {
        snapshots,
        selectedSnapshot,
        selectedMonth,
        setSelectedMonth,
        loading,
    };
}
