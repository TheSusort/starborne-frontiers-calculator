import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
import { useOrphanSetPieces, useGearLookup } from '../../hooks/useGear';
import { StatDistributionChart } from '../../components/stats/StatDistributionChart';
import { Loader } from '../../components/ui/Loader';
import Seo from '../../components/seo/Seo';
import { useTutorial } from '../../contexts/TutorialContext';
import { SHIP_DETAILS_TUTORIAL } from '../../constants/tutorialSteps';
import { ShipShowcase } from '../../components/ship/ShipShowcase';

export const ShipDetailsPage: React.FC = () => {
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [editingShip, setEditingShip] = useState<Ship | undefined>(undefined);
    const { shipId } = useParams<{ shipId: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const { inventory: availableGear, getGearPiece } = useInventory();
    const {
        ships,
        updateShip,
        deleteShip,
        toggleEquipmentLock,
        unequipAllEquipment,
        equipImplant,
        removeImplant,
        loading,
    } = useShips();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const { addNotification } = useNotification();
    const { startGroup, hasCompletedGroup } = useTutorial();
    const ship = ships.find((s) => s.id === shipId);
    const gearLookup = useGearLookup(ship?.equipment || {}, getGearPiece);
    const orphanSetPieces = useOrphanSetPieces(ship || ({} as Ship), gearLookup);

    // Determine back navigation based on where we came from
    const getBackNavigation = () => {
        const state = location.state as { from?: string; shipId?: string } | null;
        if (state?.from === '/autogear' && state?.shipId) {
            return {
                label: 'Back to Autogear',
                onClick: () => void navigate(`/autogear?shipId=${state.shipId}`),
            };
        }
        return {
            label: 'Back to Ships',
            onClick: () => void navigate('/ships'),
        };
    };

    const backAction = getBackNavigation();

    // Auto-start tutorial on first visit
    useEffect(() => {
        if (!loading && ship && !hasCompletedGroup(SHIP_DETAILS_TUTORIAL.id)) {
            const timer = setTimeout(() => startGroup(SHIP_DETAILS_TUTORIAL.id), 500);
            return () => clearTimeout(timer);
        }
    }, [loading, ship, startGroup, hasCompletedGroup]);

    if (!ship) {
        const notFoundBackAction = getBackNavigation();
        return (
            <PageLayout
                title="Ship Not Found"
                action={{
                    label: notFoundBackAction.label,
                    onClick: notFoundBackAction.onClick,
                    variant: 'secondary',
                }}
            >
                <div className="text-center text-theme-text-secondary">
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
            getEngineeringStatsForShipType(ship.type),
            ship.id
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
                    label: backAction.label,
                    onClick: backAction.onClick,
                    variant: 'secondary',
                }}
                tutorialGroupId={SHIP_DETAILS_TUTORIAL.id}
            >
                <CollapsibleForm isVisible={isFormVisible || !!editingShip}>
                    <ShipForm
                        onSubmit={(updatedShip) => {
                            void (async () => {
                                await updateShip(updatedShip.id, updatedShip);
                                setIsFormVisible(false);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                                setEditingShip(undefined);
                                addNotification('success', 'Ship saved successfully');
                            })();
                        }}
                        editingShip={editingShip}
                    />
                </CollapsibleForm>
                <div className="grid lg:grid-cols-2 gap-6">
                    <div className="space-y-6">
                        <div data-tutorial="ship-details-card">
                            <ShipCard
                                variant="extended"
                                ship={ship}
                                allShips={ships}
                                hoveredGear={hoveredGear}
                                availableGear={availableGear}
                                getGearPiece={getGearPiece}
                                onRemove={(id) => {
                                    void deleteShip(id);
                                    void navigate('/ships');
                                }}
                                onLockEquipment={async (ship) => {
                                    await toggleEquipmentLock(ship.id);
                                }}
                                onEquipGear={(_, slot, gearId) => {
                                    const updatedShip = { ...ship };
                                    updatedShip.equipment[slot] = gearId;
                                    void updateShip(updatedShip.id, updatedShip);
                                }}
                                onRemoveGear={(_, slot) => {
                                    const updatedShip = { ...ship };
                                    delete updatedShip.equipment[slot];
                                    void updateShip(updatedShip.id, updatedShip);
                                }}
                                onUnequipAll={() => {
                                    void unequipAllEquipment(ship.id);
                                }}
                                onHoverGear={setHoveredGear}
                                onEdit={() => {
                                    setIsFormVisible(true);
                                    setEditingShip(ship);
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                onEquipImplant={(_, slot, gearId) => {
                                    void equipImplant(ship.id, slot, gearId);
                                }}
                                onRemoveImplant={(_, slot) => {
                                    void removeImplant(ship.id, slot);
                                }}
                            />
                        </div>

                        <section className="card" data-tutorial="ship-details-refits">
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
                                <p className="text-theme-text-secondary">No refits installed</p>
                            )}
                        </section>
                    </div>

                    <div className="space-y-6">
                        <ShipShowcase ship={ship} />
                        <div data-tutorial="ship-details-stat-distribution">
                            <StatDistributionChart
                                contributions={analyzeStatDistribution(
                                    ship.equipment,
                                    getGearPiece,
                                    ship,
                                    getEngineeringStatsForShipType
                                )}
                            />
                        </div>
                        <div data-tutorial="ship-details-upgrades">
                            <UpgradeSuggestions suggestions={upgradeSuggestions} />
                        </div>
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default ShipDetailsPage;
