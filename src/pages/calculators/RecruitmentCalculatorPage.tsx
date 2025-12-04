import React, { useState, useMemo } from 'react';
import { useShipsData } from '../../hooks/useShipsData';
import { PageLayout } from '../../components/ui';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Loader } from '../../components/ui/Loader';
import { CollapsibleAccordion } from '../../components/ui/CollapsibleAccordion';
import { ChevronDownIcon, ChevronUpIcon } from '../../components/ui/icons';
import { RARITIES } from '../../constants';
import { ShipSelectionGrid } from '../../components/calculator/ShipSelectionGrid';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import {
    calculateRecruitmentResults,
    getRecruitableShips,
    getNonRecruitableShips,
    BeaconType,
    EventShip,
    calculateProbabilityWithPulls,
    calculateProbabilityOfAllShipsAfterPulls,
    groupShipsByRarity,
    getBeaconLabel,
    getBeaconDescription,
    getBeaconRarity,
} from '../../utils/recruitmentCalculator';

const RecruitmentCalculatorPage: React.FC = () => {
    const { ships: allShips, loading, error } = useShipsData();
    const [selectedShipNames, setSelectedShipNames] = useState<Set<string>>(new Set());
    const [eventShipNames, setEventShipNames] = useState<Set<string>>(new Set());
    const [eventShipRates, setEventShipRates] = useState<Record<string, number>>({});
    const [eventShipThresholds, setEventShipThresholds] = useState<Record<string, number>>({});
    const [beaconInventory, setBeaconInventory] = useState<Record<BeaconType, number>>({
        public: 0,
        specialist: 0,
        expert: 0,
        elite: 0,
    });
    const [isEventSettingsOpen, setIsEventSettingsOpen] = useState(false);
    const [calculationMode, setCalculationMode] = useState<'or' | 'and'>('or');

    // Get recruitable ships
    const recruitableShips = useMemo(() => {
        return getRecruitableShips(allShips);
    }, [allShips]);

    // Get selected ships
    const selectedShips = useMemo(() => {
        return recruitableShips.filter((ship) => selectedShipNames.has(ship.name));
    }, [recruitableShips, selectedShipNames]);

    // Get epic and legendary ships for event ship selection
    const eventEligibleShips = useMemo(() => {
        return recruitableShips.filter(
            (ship) => ship.rarity === 'epic' || ship.rarity === 'legendary'
        );
    }, [recruitableShips]);

    // Build event ships array from state
    const eventShips = useMemo<EventShip[]>(() => {
        const ships: EventShip[] = [];
        Array.from(eventShipNames).forEach((name) => {
            const rate = eventShipRates[name];
            const threshold = eventShipThresholds[name];

            // Only include ships with either rate or threshold set
            if (rate !== undefined && rate > 0) {
                ships.push({
                    name,
                    rate: rate / 100, // Convert percentage to decimal
                });
            } else if (threshold !== undefined && threshold > 0) {
                ships.push({
                    name,
                    threshold,
                });
            }
        });
        return ships;
    }, [eventShipNames, eventShipRates, eventShipThresholds]);

    // Calculate results
    const results = useMemo(() => {
        if (selectedShips.length === 0) {
            return [];
        }

        return calculateRecruitmentResults(selectedShips, allShips, eventShips, calculationMode);
    }, [selectedShips, allShips, eventShips, calculationMode]);

    const toggleShipSelection = (shipName: string) => {
        setSelectedShipNames((prev) => {
            const next = new Set(prev);
            if (next.has(shipName)) {
                next.delete(shipName);
            } else {
                next.add(shipName);
            }
            return next;
        });
    };

    const clearSelection = () => {
        setSelectedShipNames(new Set());
    };

    const toggleEventShipSelection = (shipName: string) => {
        setEventShipNames((prev) => {
            const next = new Set(prev);
            if (next.has(shipName)) {
                next.delete(shipName);
                // Remove rate and threshold when deselecting
                setEventShipRates((rates) => {
                    const newRates = { ...rates };
                    delete newRates[shipName];
                    return newRates;
                });
                setEventShipThresholds((thresholds) => {
                    const newThresholds = { ...thresholds };
                    delete newThresholds[shipName];
                    return newThresholds;
                });
            } else {
                next.add(shipName);
            }
            return next;
        });
    };

    const updateEventShipRate = (shipName: string, rate: number) => {
        setEventShipRates((prev) => ({
            ...prev,
            [shipName]: rate,
        }));
        // Clear threshold when rate is set (mutually exclusive)
        if (rate > 0) {
            setEventShipThresholds((prev) => {
                const newThresholds = { ...prev };
                delete newThresholds[shipName];
                return newThresholds;
            });
        }
    };

    const updateEventShipThreshold = (shipName: string, threshold: number) => {
        setEventShipThresholds((prev) => ({
            ...prev,
            [shipName]: threshold,
        }));
        // Clear rate when threshold is set (mutually exclusive)
        if (threshold > 0) {
            setEventShipRates((prev) => {
                const newRates = { ...prev };
                delete newRates[shipName];
                return newRates;
            });
        }
    };

    const clearEventShips = () => {
        setEventShipNames(new Set());
        setEventShipRates({});
        setEventShipThresholds({});
    };

    // Group ships by rarity for display
    const shipsByRarity = useMemo(() => {
        return groupShipsByRarity(recruitableShips);
    }, [recruitableShips]);

    // Group event ships by rarity for display
    const eventShipsByRarity = useMemo(() => {
        return groupShipsByRarity(eventEligibleShips);
    }, [eventEligibleShips]);

    // Get selected event ships
    const selectedEventShips = useMemo(() => {
        return eventEligibleShips.filter((ship) => eventShipNames.has(ship.name));
    }, [eventEligibleShips, eventShipNames]);

    if (loading) {
        return <Loader />;
    }

    if (error) {
        return (
            <div className="text-center text-red-500">
                <p>Error: {error}</p>
            </div>
        );
    }

    return (
        <>
            <Seo {...SEO_CONFIG.recruitment} />
            <PageLayout
                title="Ship Recruitment Calculator"
                description="Calculate the probability of recruiting specific ships from different beacon types."
            >
                <div className="space-y-6">
                    {/* Instructions */}
                    <div className="card">
                        <h2 className="text-xl font-bold mb-4">How It Works</h2>
                        <ul className="list-disc list-inside space-y-2 text-gray-400 text-sm">
                            <li>
                                <strong>Public Beacon:</strong> 60% Common, 38% Uncommon, 2% Rare
                            </li>
                            <li>
                                <strong>Specialist Beacon:</strong> ~89% Rare, ~10% Epic, ~1.52%
                                Legendary (1/66 chance)
                            </li>
                            <li>
                                <strong>Expert Beacon:</strong> 90% Epic, 10% Legendary
                            </li>
                            <li>
                                <strong>Elite Beacon:</strong> 100% Legendary
                            </li>
                            <li className="mt-2">
                                <strong>Note:</strong> Some ships (
                                {getNonRecruitableShips().join(', ')}) cannot be recruited through
                                beacons and are excluded from calculations.
                            </li>
                        </ul>
                    </div>

                    {/* Ship Selection */}
                    <div className="card">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">Select Target Ships</h2>
                            {selectedShipNames.size > 0 && (
                                <Button variant="secondary" onClick={clearSelection} size="sm">
                                    Clear Selection ({selectedShipNames.size})
                                </Button>
                            )}
                        </div>

                        {/* Ships grouped by rarity */}
                        <ShipSelectionGrid
                            ships={recruitableShips}
                            selectedShipNames={selectedShipNames}
                            onToggleSelection={toggleShipSelection}
                            shipsByRarity={shipsByRarity}
                            searchLabel="Search Ships"
                            searchPlaceholder="Type to search ships..."
                        />
                    </div>

                    {/* Calculation Mode Toggle */}
                    {selectedShips.length > 1 && (
                        <div className="card">
                            <div className="flex items-center gap-4">
                                <span className="text-sm font-medium">Calculation Mode:</span>
                                <div className="flex gap-2">
                                    <Button
                                        variant={calculationMode === 'or' ? 'primary' : 'secondary'}
                                        onClick={() => setCalculationMode('or')}
                                        size="sm"
                                    >
                                        OR (At least one)
                                    </Button>
                                    <Button
                                        variant={
                                            calculationMode === 'and' ? 'primary' : 'secondary'
                                        }
                                        onClick={() => setCalculationMode('and')}
                                        size="sm"
                                    >
                                        AND (All ships)
                                    </Button>
                                </div>
                                <span className="text-xs text-gray-400">
                                    {calculationMode === 'or'
                                        ? 'Probability of getting at least one target ship'
                                        : 'Probability of getting all target ships'}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Specialist Beacon Settings */}
                    <div className="bg-dark border border-dark-border">
                        <div className="flex justify-between items-center p-4">
                            <button
                                type="button"
                                onClick={() => setIsEventSettingsOpen(!isEventSettingsOpen)}
                                className="flex items-center gap-2 text-xl font-bold hover:text-primary transition-colors"
                            >
                                <span>Specialist Beacon Settings</span>
                                {isEventSettingsOpen ? (
                                    <ChevronUpIcon className="w-5 h-5" />
                                ) : (
                                    <ChevronDownIcon className="w-5 h-5" />
                                )}
                            </button>
                            {eventShipNames.size > 0 && (
                                <Button variant="secondary" onClick={clearEventShips} size="sm">
                                    Clear Event Ships ({eventShipNames.size})
                                </Button>
                            )}
                        </div>

                        <CollapsibleAccordion isOpen={isEventSettingsOpen}>
                            <div className="space-y-6">
                                {/* Event Ship Selection */}
                                <div>
                                    <h3 className="text-lg font-semibold mb-2">
                                        Event Ships (Epic & Legendary)
                                    </h3>
                                    <p className="text-sm text-gray-400 mb-4">
                                        Select ships for events. Each ship can have either a rate
                                        change or be guaranteed after a certain number of pulls
                                        (mutually exclusive).
                                    </p>

                                    {/* Event ships grouped by rarity (epic and legendary only) */}
                                    <ShipSelectionGrid
                                        ships={eventEligibleShips}
                                        selectedShipNames={eventShipNames}
                                        onToggleSelection={toggleEventShipSelection}
                                        shipsByRarity={eventShipsByRarity}
                                        rarities={['legendary', 'epic']}
                                        headingLevel="h4"
                                        headingSize="text-md"
                                        searchLabel="Search Event Ships"
                                        searchPlaceholder="Type to search epic and legendary ships..."
                                    />
                                </div>

                                {/* Event Ship Configuration */}
                                {selectedEventShips.length > 0 && (
                                    <div>
                                        <h3 className="text-lg font-semibold mb-4">
                                            Event Ship Configuration
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {selectedEventShips.map((ship) => {
                                                const rarityInfo = RARITIES[ship.rarity];
                                                const hasRate =
                                                    eventShipRates[ship.name] !== undefined &&
                                                    eventShipRates[ship.name] > 0;
                                                const hasThreshold =
                                                    eventShipThresholds[ship.name] !== undefined &&
                                                    eventShipThresholds[ship.name] > 0;

                                                return (
                                                    <div key={ship.name} className="space-y-2">
                                                        <div className="flex items-center gap-2">
                                                            <span
                                                                className={`font-semibold ${rarityInfo.textColor}`}
                                                            >
                                                                {ship.name}
                                                            </span>
                                                            <span className="text-sm text-gray-400">
                                                                ({rarityInfo.label})
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <Input
                                                                label="Rate Change (%)"
                                                                type="number"
                                                                min="0"
                                                                max="100"
                                                                value={
                                                                    eventShipRates[ship.name] || 0
                                                                }
                                                                onChange={(e) =>
                                                                    updateEventShipRate(
                                                                        ship.name,
                                                                        parseFloat(
                                                                            e.target.value
                                                                        ) || 0
                                                                    )
                                                                }
                                                                disabled={hasThreshold}
                                                                helpLabel={`Percentage chance that a ${ship.rarity} pull is ${ship.name} (usually 25% or 50%). Disabled if guaranteed threshold is set.`}
                                                            />
                                                            <Input
                                                                label="Guaranteed After (Pulls)"
                                                                type="number"
                                                                min="1"
                                                                value={
                                                                    eventShipThresholds[
                                                                        ship.name
                                                                    ] || 0
                                                                }
                                                                onChange={(e) =>
                                                                    updateEventShipThreshold(
                                                                        ship.name,
                                                                        parseInt(e.target.value) ||
                                                                            0
                                                                    )
                                                                }
                                                                disabled={hasRate}
                                                                helpLabel={`Number of specialist pulls needed to guarantee ${ship.name} (usually ${ship.rarity === 'legendary' ? '100-150' : '40'} pulls). Disabled if rate change is set.`}
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </CollapsibleAccordion>
                    </div>

                    {/* Beacon Inventory */}
                    <div className="card">
                        <h2 className="text-xl font-bold mb-4">Beacon Inventory (Optional)</h2>
                        <p className="text-sm text-gray-400 mb-4">
                            Enter how many beacons you have to see the probability of getting your
                            target ships with your current inventory.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <Input
                                label="Public Beacons"
                                type="number"
                                min="0"
                                value={beaconInventory.public}
                                onChange={(e) =>
                                    setBeaconInventory((prev) => ({
                                        ...prev,
                                        public: parseInt(e.target.value) || 0,
                                    }))
                                }
                            />
                            <Input
                                label="Specialist Beacons"
                                type="number"
                                min="0"
                                value={beaconInventory.specialist}
                                onChange={(e) =>
                                    setBeaconInventory((prev) => ({
                                        ...prev,
                                        specialist: parseInt(e.target.value) || 0,
                                    }))
                                }
                            />
                            <Input
                                label="Expert Beacons"
                                type="number"
                                min="0"
                                value={beaconInventory.expert}
                                onChange={(e) =>
                                    setBeaconInventory((prev) => ({
                                        ...prev,
                                        expert: parseInt(e.target.value) || 0,
                                    }))
                                }
                            />
                            <Input
                                label="Elite Beacons"
                                type="number"
                                min="0"
                                value={beaconInventory.elite}
                                onChange={(e) =>
                                    setBeaconInventory((prev) => ({
                                        ...prev,
                                        elite: parseInt(e.target.value) || 0,
                                    }))
                                }
                            />
                        </div>
                    </div>

                    {/* Results */}
                    {selectedShips.length > 0 && (
                        <div className="card">
                            <h2 className="text-xl font-bold mb-4">
                                Results for {selectedShips.length} Selected Ship
                                {selectedShips.length !== 1 ? 's' : ''}
                            </h2>
                            {selectedShips.length > 0 && (
                                <div className="mb-4">
                                    <p className="text-sm text-gray-400">
                                        Target ships: {selectedShips.map((s) => s.name).join(', ')}
                                    </p>
                                    {selectedShips.length > 1 && (
                                        <p className="text-sm text-gray-500 mt-1 italic">
                                            {calculationMode === 'or'
                                                ? 'Showing probability of getting at least one of the selected ships'
                                                : 'Showing probability of getting all selected ships'}
                                        </p>
                                    )}
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {results.map((result) => {
                                    const beaconRarity = getBeaconRarity(result.beaconType);
                                    const rarityInfo = RARITIES[beaconRarity];
                                    return (
                                        <div
                                            key={result.beaconType}
                                            className={`bg-dark p-4 border ${rarityInfo.borderColor}`}
                                        >
                                            <h3
                                                className={`text-lg font-semibold mb-2 ${rarityInfo.textColor}`}
                                            >
                                                {getBeaconLabel(result.beaconType)}
                                            </h3>
                                            <p className="text-sm text-gray-400 mb-4">
                                                {getBeaconDescription(result.beaconType)}
                                            </p>

                                            <div className="space-y-2">
                                                <div className="flex justify-between">
                                                    <span className="text-gray-400">
                                                        Probability per pull (at least one):
                                                    </span>
                                                    <span className="font-semibold">
                                                        {(result.probability * 100).toFixed(4)}%
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-400">
                                                        Expected pulls (average):
                                                    </span>
                                                    <span className="font-semibold">
                                                        {result.expectedPulls === Infinity
                                                            ? 'N/A'
                                                            : Math.ceil(
                                                                  result.expectedPulls
                                                              ).toLocaleString()}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 -mt-1">
                                                    {calculationMode === 'or'
                                                        ? 'Average number of pulls needed to get at least one target ship'
                                                        : 'Average number of pulls needed to get all target ships (max of individual expected pulls)'}
                                                </p>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-400">
                                                        Pulls for 90% chance:
                                                    </span>
                                                    <span className="font-semibold">
                                                        {result.pullsFor90Percent === Infinity
                                                            ? 'N/A'
                                                            : result.pullsFor90Percent.toLocaleString()}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 -mt-1">
                                                    {calculationMode === 'or'
                                                        ? 'Pulls needed for 90% chance of getting at least one target ship'
                                                        : 'Pulls needed for 90% chance of getting all target ships'}
                                                </p>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-400">
                                                        Pulls for 99% chance:
                                                    </span>
                                                    <span className="font-semibold">
                                                        {result.pullsFor99Percent === Infinity
                                                            ? 'N/A'
                                                            : result.pullsFor99Percent.toLocaleString()}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 -mt-1">
                                                    {calculationMode === 'or'
                                                        ? 'Pulls needed for 99% chance of getting at least one target ship'
                                                        : 'Pulls needed for 99% chance of getting all target ships'}
                                                </p>
                                                {beaconInventory[result.beaconType] > 0 && (
                                                    <div className="mt-4 pt-4 border-t border-dark-border">
                                                        <div className="flex justify-between mb-2">
                                                            <span className="text-gray-400">
                                                                With{' '}
                                                                {beaconInventory[
                                                                    result.beaconType
                                                                ].toLocaleString()}{' '}
                                                                beacon
                                                                {beaconInventory[
                                                                    result.beaconType
                                                                ] !== 1
                                                                    ? 's'
                                                                    : ''}
                                                                :
                                                            </span>
                                                            <span className="font-semibold text-primary">
                                                                {calculationMode === 'or'
                                                                    ? (
                                                                          calculateProbabilityWithPulls(
                                                                              result.probability,
                                                                              beaconInventory[
                                                                                  result.beaconType
                                                                              ],
                                                                              result.beaconType,
                                                                              result.beaconType ===
                                                                                  'specialist'
                                                                                  ? eventShips
                                                                                  : [],
                                                                              selectedShips.map(
                                                                                  (s) => s.name
                                                                              )
                                                                          ) * 100
                                                                      ).toFixed(2)
                                                                    : (
                                                                          calculateProbabilityOfAllShipsAfterPulls(
                                                                              selectedShips,
                                                                              result.beaconType,
                                                                              allShips,
                                                                              beaconInventory[
                                                                                  result.beaconType
                                                                              ],
                                                                              result.beaconType ===
                                                                                  'specialist'
                                                                                  ? eventShips
                                                                                  : []
                                                                          ) * 100
                                                                      ).toFixed(2)}
                                                                %
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-gray-500 mt-1">
                                                            {calculationMode === 'or'
                                                                ? 'Probability of getting at least one target ship'
                                                                : 'Probability of getting all target ships'}
                                                            {result.beaconType === 'specialist' &&
                                                                eventShips.some(
                                                                    (es) =>
                                                                        es.threshold !==
                                                                            undefined &&
                                                                        selectedShips
                                                                            .map((s) => s.name)
                                                                            .includes(es.name)
                                                                ) &&
                                                                beaconInventory.specialist >=
                                                                    Math.min(
                                                                        ...eventShips
                                                                            .filter(
                                                                                (es) =>
                                                                                    es.threshold !==
                                                                                        undefined &&
                                                                                    selectedShips
                                                                                        .map(
                                                                                            (s) =>
                                                                                                s.name
                                                                                        )
                                                                                        .includes(
                                                                                            es.name
                                                                                        )
                                                                            )
                                                                            .map(
                                                                                (es) =>
                                                                                    es.threshold ||
                                                                                    Infinity
                                                                            )
                                                                    ) && (
                                                                    <span className="text-primary font-semibold">
                                                                        {' '}
                                                                        (Guaranteed!)
                                                                    </span>
                                                                )}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {selectedShips.length === 0 && (
                        <div className="card text-center text-gray-400">
                            Select one or more ships above to see recruitment probabilities
                        </div>
                    )}
                </div>
            </PageLayout>
        </>
    );
};

export default RecruitmentCalculatorPage;
