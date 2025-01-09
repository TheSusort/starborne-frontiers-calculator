import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Ship } from '../types/ship';
import { ShipCard } from '../components/ship/ShipCard';
import { StatDisplay } from '../components/stats/StatDisplay';
import { StatDistributionChart } from '../components/stats/StatDistributionChart';
import { useInventory } from '../hooks/useInventory';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { calculateTotalStats } from '../utils/statsCalculator';
import { analyzeStatDistribution } from '../utils/analysis/statDistribution';
import { useShips } from '../hooks/useShips';
import { PageLayout } from '../components/ui/layout/PageLayout';
import { GearPiece } from '../types/gear';
import { CollapsibleForm } from '../components/ui/layout/CollapsibleForm';
import { ShipForm } from '../components/ship/ShipForm';
import { useNotification } from '../hooks/useNotification';

export const ShipDetailsPage: React.FC = () => {
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [editingShip, setEditingShip] = useState<Ship | undefined>(undefined);
    const { shipId } = useParams<{ shipId: string }>();
    const navigate = useNavigate();
    const { inventory: availableGear, getGearPiece } = useInventory();
    const {
        ships,
        updateShip,
        handleRemoveShip: removeShip,
        handleLockEquipment: toggleEquipmentLock,
    } = useShips({ getGearPiece });
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const { addNotification } = useNotification();

    const ship = ships.find((s) => s.id === shipId);

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

    return (
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
                        await updateShip(updatedShip);
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
                            removeShip(id);
                            navigate('/ships');
                        }}
                        onLockEquipment={async (ship) => {
                            await toggleEquipmentLock(ship);
                        }}
                        onEquipGear={(_, slot, gearId) => {
                            const updatedShip = { ...ship };
                            updatedShip.equipment[slot] = gearId;
                            updateShip(updatedShip);
                        }}
                        onRemoveGear={(_, slot) => {
                            const updatedShip = { ...ship };
                            delete updatedShip.equipment[slot];
                            updateShip(updatedShip);
                        }}
                        onHoverGear={setHoveredGear}
                        onEdit={() => {
                            setIsFormVisible(true);
                            setEditingShip(ship);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                    />

                    <section className="bg-dark p-4">
                        <h2 className="text-lg font-bold mb-4">Refits ({ship.refits.length}/6)</h2>
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
                        <h2 className="text-lg font-bold mb-4">
                            Implants ({ship.implants.length})
                        </h2>
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
                    {statDistribution.length > 0 && (
                        <StatDistributionChart contributions={statDistribution} />
                    )}
                </div>
            </div>
        </PageLayout>
    );
};
