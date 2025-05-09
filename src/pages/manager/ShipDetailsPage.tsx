import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Ship } from '../../types/ship';
import { ShipCard } from '../../components/ship/ShipCard';
import { StatDisplay } from '../../components/stats/StatDisplay';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { analyzeStatDistribution } from '../../utils/ship/statDistribution';
import { useShips } from '../../contexts/ShipsContext';
import { PageLayout } from '../../components/ui/layout/PageLayout';
import { GearPiece } from '../../types/gear';
import { CollapsibleForm } from '../../components/ui/layout/CollapsibleForm';
import { ShipForm } from '../../components/ship/ShipForm';
import { useNotification } from '../../hooks/useNotification';
import { analyzeUpgrades } from '../../utils/ship/upgradeAnalysis';
import { UpgradeSuggestions } from '../../components/stats/UpgradeSuggestions';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { useOrphanSetPieces } from '../../hooks/useGear';
import { useGearLookup } from '../../hooks/useGear';
import { StatDistributionChart } from '../../components/stats/StatDistributionChart';
import { Loader } from '../../components/ui/Loader';
import Seo from '../../components/seo/Seo';

export const ShipDetailsPage: React.FC = () => {
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [editingShip, setEditingShip] = useState<Ship | undefined>(undefined);
    const { shipId } = useParams<{ shipId: string }>();
    const navigate = useNavigate();
    const { inventory: availableGear, getGearPiece } = useInventory();
    const { ships, updateShip, deleteShip, toggleEquipmentLock, unequipAllEquipment, loading } =
        useShips();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const { addNotification } = useNotification();
    const ship = ships.find((s) => s.id === shipId);
    const gearLookup = useGearLookup(ship?.equipment || {}, getGearPiece);
    const orphanSetPieces = useOrphanSetPieces(ship || ({} as Ship), gearLookup);

    if (!ship) {
        return (
            <PageLayout
                title="Ship Not Found"
                action={{
                    label: 'Back to Ships',
                    onClick: () => navigate('/ships'),
                    variant: 'secondary',
                }}
            >
                <div className="text-center text-gray-400">
                    The requested ship could not be found.
                </div>
            </PageLayout>
        );
    }

    const statDistribution = analyzeStatDistribution(
        ship.equipment,
        getGearPiece,
        ship,
        getEngineeringStatsForShipType
    );

    const upgradeSuggestions = analyzeUpgrades(
        statDistribution,
        ship.equipment,
        getGearPiece,
        ship,
        calculateTotalStats(
            ship.baseStats,
            ship.equipment,
            getGearPiece,
            ship.refits,
            ship.implants,
            getEngineeringStatsForShipType(ship.type)
        ).final,
        orphanSetPieces
    );

    if (loading) {
        return <Loader />;
    }

    return (
        <>
            <Seo
                title={`${ship.name} Details`}
                description={`View and manage ${ship.name} details and stats.`}
                keywords={`${ship.name}, ship details, stats, gear, refits, implants`}
            />
            <PageLayout
                title={`${ship.name} Details`}
                action={{
                    label: 'Back to Ships',
                    onClick: () => navigate('/ships'),
                    variant: 'secondary',
                }}
            >
                <CollapsibleForm isVisible={isFormVisible || !!editingShip}>
                    <ShipForm
                        onSubmit={async (updatedShip) => {
                            await updateShip(updatedShip.id, updatedShip);
                            setIsFormVisible(false);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                            setEditingShip(undefined);
                            addNotification('success', 'Ship saved successfully');
                        }}
                        editingShip={editingShip}
                    />
                </CollapsibleForm>
                <div className="grid lg:grid-cols-2 gap-6">
                    <div className="space-y-6">
                        <ShipCard
                            variant="extended"
                            ship={ship}
                            allShips={ships}
                            hoveredGear={hoveredGear}
                            availableGear={availableGear}
                            getGearPiece={getGearPiece}
                            onRemove={(id) => {
                                deleteShip(id);
                                navigate('/ships');
                            }}
                            onLockEquipment={async (ship) => {
                                await toggleEquipmentLock(ship.id);
                            }}
                            onEquipGear={(_, slot, gearId) => {
                                const updatedShip = { ...ship };
                                updatedShip.equipment[slot] = gearId;
                                updateShip(updatedShip.id, updatedShip);
                            }}
                            onRemoveGear={(_, slot) => {
                                const updatedShip = { ...ship };
                                delete updatedShip.equipment[slot];
                                updateShip(updatedShip.id, updatedShip);
                            }}
                            onUnequipAll={() => {
                                unequipAllEquipment(ship.id);
                            }}
                            onHoverGear={setHoveredGear}
                            onEdit={() => {
                                setIsFormVisible(true);
                                setEditingShip(ship);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                        />

                        <section className="bg-dark p-4">
                            <h3 className="mb-4">Refits ({ship.refits.length}/6)</h3>
                            {ship.refits.length > 0 ? (
                                <div className="space-y-2">
                                    {ship.refits.map((refit, index) => (
                                        <StatDisplay
                                            key={index}
                                            stats={refit.stats}
                                            className="p-2 bg-dark-lighter"
                                        />
                                    ))}
                                </div>
                            ) : (
                                <p className="text-gray-400">No refits installed</p>
                            )}
                        </section>

                        <section className="bg-dark p-4">
                            <h3 className="mb-4">Implants ({ship.implants.length})</h3>
                            {ship.implants.length > 0 ? (
                                <div className="space-y-2">
                                    {ship.implants.map((implant, index) => (
                                        <StatDisplay
                                            key={index}
                                            stats={implant.stats}
                                            className="p-2 bg-dark-lighter"
                                        />
                                    ))}
                                </div>
                            ) : (
                                <p className="text-gray-400">No implants installed</p>
                            )}
                        </section>
                    </div>

                    <div className="space-y-6">
                        <StatDistributionChart
                            contributions={analyzeStatDistribution(
                                ship.equipment,
                                getGearPiece,
                                ship,
                                getEngineeringStatsForShipType
                            )}
                        />
                        <UpgradeSuggestions suggestions={upgradeSuggestions} />
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default ShipDetailsPage;
