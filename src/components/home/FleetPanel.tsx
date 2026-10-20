import React from 'react';
import { Link } from 'react-router-dom';
import { Button, SectionHeader } from '../ui';
import { StatCard } from '../ui/StatCard';
import { ImportButton } from '../import/ImportButton';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { readLastVisitedPath } from '../../hooks/useLastVisitedPath';
import { formatLastImport, readLastImport } from './fleetPanelState';

export const FleetPanel: React.FC = () => {
    const { ships } = useShips();
    const { inventory } = useInventory();
    const { engineeringStats } = useEngineeringStats();
    const lastImport = formatLastImport(readLastImport(), new Date());
    const lastPath = readLastVisitedPath();

    return (
        <section className="space-y-6">
            <SectionHeader title="Your fleet" subtitle="Pick up where you left off" />
            <div className="grid gap-6 md:grid-cols-3">
                <StatCard title="Ships" value={ships.length} />
                <StatCard title="Gear pieces" value={inventory.length} />
                <StatCard title="Engineering stats" value={engineeringStats.stats.length} />
            </div>
            <div className="card flex flex-wrap items-center gap-3">
                <ImportButton />
                <Link to="/autogear">
                    <Button variant="secondary">Autogear</Button>
                </Link>
                <Link to="/gear?tab=analysis">
                    <Button variant="secondary">Upgrade Analysis</Button>
                </Link>
                {lastImport && (
                    <span className="text-sm text-theme-text-secondary">
                        Last import: {lastImport}
                    </span>
                )}
            </div>
            {lastPath && (
                <Link
                    to={lastPath}
                    className="text-primary hover:text-primary-hover text-sm inline-block"
                >
                    Continue where you left off
                </Link>
            )}
        </section>
    );
};
