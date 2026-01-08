import React, { useMemo, useState, useCallback, useRef } from 'react';
import { useShipsData } from '../hooks/useShipsData';
import { useShips } from '../contexts/ShipsContext';
import { PageLayout } from '../components/ui';
import { ShipDisplay } from '../components/ship/ShipDisplay';
import { Image } from '../components/ui/Image';
import { Loader } from '../components/ui/Loader';
import { FilterPanel, FilterConfig } from '../components/filters/FilterPanel';
import { SortConfig } from '../components/filters/SortPanel';
import { usePersistedFilters } from '../hooks/usePersistedFilters';
import { SHIP_TYPES, FACTIONS, RARITY_ORDER, RARITIES, ALL_STAT_NAMES } from '../constants';
import { Ship, AffinityName } from '../types/ship';
import { useNotification } from '../hooks/useNotification';
import { Button } from '../components/ui/Button';
import { Tooltip } from '../components/ui/layout/Tooltip';
import { SkillTooltip } from '../components/ship/SkillTooltip';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { STATS } from '../constants/stats';
import { StatName } from '../types/stats';
import { calculateTotalStats } from '../utils/ship/statsCalculator';

export const ShipIndexPage: React.FC = () => {
    const { ships: templateShips, loading, error } = useShipsData();
    const { addShip } = useShips();
    const { addNotification } = useNotification();
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { state, setState, clearFilters } = usePersistedFilters('ship-database-filters');
    const hasActiveFilters =
        (state.filters.factions?.length ?? 0) > 0 ||
        (state.filters.shipTypes?.length ?? 0) > 0 ||
        (state.filters.rarities?.length ?? 0) > 0 ||
        (state.filters.affinities?.length ?? 0) > 0 ||
        searchQuery.length > 0;
    const [addedShips, setAddedShips] = useState<Set<string>>(new Set());
    const [activeHover, setActiveHover] = useState('');
    const [chargeHover, setChargeHover] = useState('');
    const [passive1Hover, setPassive1Hover] = useState('');
    const [passive2Hover, setPassive2Hover] = useState('');
    const [passive3Hover, setPassive3Hover] = useState('');
    const tooltipRefs = useRef<Record<string, HTMLDivElement | null>>({});

    const setSelectedFactions = (factions: string[]) => {
        setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, factions },
        }));
    };

    const setSelectedShipTypes = (shipTypes: string[]) => {
        setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, shipTypes },
        }));
    };

    const setSelectedRarities = (rarities: string[]) => {
        setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, rarities },
        }));
    };

    const setSelectedAffinities = (affinities: string[]) => {
        setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, affinities },
        }));
    };

    const setSort = (sort: SortConfig) => {
        setState((prev) => ({ ...prev, sort }));
    };

    const sortOptions = [
        { value: 'name', label: 'Name' },
        { value: 'type', label: 'Type' },
        { value: 'faction', label: 'Faction' },
        { value: 'rarity', label: 'Rarity' },
        // Add stat-based sort options
        ...ALL_STAT_NAMES.map((stat) => ({
            value: stat,
            label: STATS[stat].label,
        })),
    ];

    const uniqueAffinities = useMemo(() => {
        if (!templateShips) return [];
        const affinities = new Set(
            templateShips
                .map((ship) => ship.affinity)
                .filter((affinity): affinity is AffinityName => affinity !== undefined)
        );
        return Array.from(affinities).sort((a, b) => a.localeCompare(b));
    }, [templateShips]);

    const filters: FilterConfig[] = [
        {
            id: 'faction',
            label: 'Factions',
            values: state.filters.factions ?? [],
            onChange: setSelectedFactions,
            options: Object.entries(FACTIONS).map(([key, faction]) => ({
                value: key,
                label: faction.name,
            })),
        },
        {
            id: 'shipType',
            label: 'Ship Type',
            values: state.filters.shipTypes ?? [],
            onChange: setSelectedShipTypes,
            options: Object.entries(SHIP_TYPES).map(([key, type]) => ({
                value: key,
                label: type.name,
            })),
        },
        {
            id: 'rarity',
            label: 'Rarity',
            values: state.filters.rarities ?? [],
            onChange: setSelectedRarities,
            options: Object.entries(RARITIES).map(([key, rarity]) => ({
                value: key,
                label: rarity.label,
            })),
        },
        {
            id: 'affinity',
            label: 'Affinity',
            values: state.filters.affinities ?? [],
            onChange: setSelectedAffinities,
            options: uniqueAffinities.map((affinity) => ({
                value: affinity,
                label: affinity.charAt(0).toUpperCase() + affinity.slice(1),
            })),
        },
    ];

    const filteredAndSortedShips = useMemo(() => {
        if (!templateShips) return [];

        const filtered = templateShips.filter((ship) => {
            const matchesFaction =
                (state.filters.factions?.length ?? 0) === 0 ||
                (state.filters.factions?.includes(ship.faction) ?? false);
            const matchesType =
                (state.filters.shipTypes?.length ?? 0) === 0 ||
                (state.filters.shipTypes?.includes(ship.type) ?? false);
            const matchesRarity =
                (state.filters.rarities?.length ?? 0) === 0 ||
                (state.filters.rarities?.includes(ship.rarity) ?? false);
            const matchesAffinity =
                (state.filters.affinities?.length ?? 0) === 0 ||
                ((ship.affinity && state.filters.affinities?.includes(ship.affinity)) ?? false);
            const matchesSearch =
                searchQuery === '' ||
                ship.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                FACTIONS[ship.faction].name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                SHIP_TYPES[ship.type].name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (ship.activeSkillText?.toLowerCase().includes(searchQuery.toLowerCase()) ??
                    false) ||
                (ship.chargeSkillText?.toLowerCase().includes(searchQuery.toLowerCase()) ??
                    false) ||
                (ship.firstPassiveSkillText?.toLowerCase().includes(searchQuery.toLowerCase()) ??
                    false) ||
                (ship.secondPassiveSkillText?.toLowerCase().includes(searchQuery.toLowerCase()) ??
                    false) ||
                (ship.thirdPassiveSkillText?.toLowerCase().includes(searchQuery.toLowerCase()) ??
                    false);
            return (
                matchesFaction && matchesType && matchesRarity && matchesAffinity && matchesSearch
            );
        });

        return [...filtered].sort((a, b) => {
            switch (state.sort.field) {
                case 'type':
                    return state.sort.direction === 'asc'
                        ? SHIP_TYPES[a.type].name.localeCompare(SHIP_TYPES[b.type].name)
                        : SHIP_TYPES[b.type].name.localeCompare(SHIP_TYPES[a.type].name);
                case 'faction':
                    return state.sort.direction === 'asc'
                        ? FACTIONS[a.faction].name.localeCompare(FACTIONS[b.faction].name)
                        : FACTIONS[b.faction].name.localeCompare(FACTIONS[a.faction].name);
                case 'rarity':
                    return state.sort.direction === 'asc'
                        ? RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)
                        : RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
                default:
                    // Handle stat-based sorting
                    if (ALL_STAT_NAMES.includes(state.sort.field as StatName)) {
                        const statName = state.sort.field as StatName;

                        const aStats = calculateTotalStats(
                            a.baseStats,
                            {},
                            () => undefined,
                            undefined,
                            undefined,
                            undefined
                        );
                        const bStats = calculateTotalStats(
                            b.baseStats,
                            {},
                            () => undefined,
                            undefined,
                            undefined,
                            undefined
                        );

                        const aValue = aStats.final[statName] || 0;
                        const bValue = bStats.final[statName] || 0;
                        return state.sort.direction === 'asc' ? aValue - bValue : bValue - aValue;
                    }
                    return state.sort.direction === 'asc'
                        ? a.name.localeCompare(b.name)
                        : b.name.localeCompare(a.name);
            }
        });
    }, [templateShips, state.filters, state.sort, searchQuery]);

    const onQuickAdd = useCallback(
        async (templateShip: Ship) => {
            try {
                const newShip: Ship = {
                    ...templateShip,
                    id: Date.now().toString(),
                    equipment: {},
                    equipmentLocked: false,
                };
                await addShip(newShip);
                setAddedShips((prev) => new Set(prev).add(templateShip.name));
                addNotification('success', `Added ${templateShip.name} to your fleet`);
            } catch (error) {
                addNotification('error', 'Failed to add ship');
                console.error('Failed to add ship:', error);
            }
        },
        [addShip, addNotification]
    );

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
            <Seo {...SEO_CONFIG.shipDatabase} />
            <PageLayout
                title="Ship Database"
                description="Browse all ships I've bothered to add and their base statistics at level 60, no refits."
            >
                <div className="space-y-6">
                    <div className="flex flex-col">
                        {filteredAndSortedShips.length > 0 && (
                            <span className="text-sm text-gray-400">
                                Showing {filteredAndSortedShips.length} ships
                            </span>
                        )}

                        <FilterPanel
                            filters={filters}
                            isOpen={isFilterOpen}
                            onToggle={() => setIsFilterOpen(!isFilterOpen)}
                            onClear={() => {
                                clearFilters();
                                setSearchQuery('');
                            }}
                            hasActiveFilters={hasActiveFilters}
                            sortOptions={sortOptions}
                            sort={state.sort}
                            setSort={setSort}
                            searchValue={searchQuery}
                            onSearchChange={setSearchQuery}
                            searchPlaceholder="Search ships by name or skills..."
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredAndSortedShips.length > 0 ? (
                            filteredAndSortedShips.map((ship) => (
                                <ShipDisplay
                                    key={ship.name}
                                    ship={ship}
                                    onQuickAdd={onQuickAdd}
                                    isAdded={addedShips.has(ship.name)}
                                >
                                    <div className="flex flex-col items-center justify-center border-b border-dark-border pb-2 m-3">
                                        {ship.imageKey && (
                                            <Image
                                                src={`${ship.imageKey}_Portrait.png`}
                                                alt={ship.name}
                                                className="max-w-full max-h-full w-[152px] h-[206px]"
                                            />
                                        )}
                                        <div className="mt-2 flex gap-2">
                                            {ship.activeSkillText && (
                                                <div className="relative">
                                                    <div
                                                        ref={(el) => {
                                                            tooltipRefs.current[
                                                                `${ship.name}_active`
                                                            ] = el;
                                                        }}
                                                        onMouseEnter={() =>
                                                            setActiveHover(ship.name)
                                                        }
                                                        onMouseLeave={() => setActiveHover('')}
                                                    >
                                                        <Button variant="secondary" size="xs">
                                                            Active
                                                        </Button>
                                                    </div>
                                                    <Tooltip
                                                        isVisible={activeHover === ship.name}
                                                        targetElement={
                                                            tooltipRefs.current[
                                                                `${ship.name}_active`
                                                            ]
                                                        }
                                                    >
                                                        <SkillTooltip
                                                            skillText={ship.activeSkillText}
                                                            skillType="Active Skill"
                                                        />
                                                    </Tooltip>
                                                </div>
                                            )}
                                            {ship.chargeSkillText && (
                                                <div className="relative">
                                                    <div
                                                        ref={(el) => {
                                                            tooltipRefs.current[
                                                                `${ship.name}_charge`
                                                            ] = el;
                                                        }}
                                                        onMouseEnter={() =>
                                                            setChargeHover(ship.name)
                                                        }
                                                        onMouseLeave={() => setChargeHover('')}
                                                    >
                                                        <Button variant="secondary" size="xs">
                                                            Charge
                                                        </Button>
                                                    </div>
                                                    <Tooltip
                                                        isVisible={chargeHover === ship.name}
                                                        targetElement={
                                                            tooltipRefs.current[
                                                                `${ship.name}_charge`
                                                            ]
                                                        }
                                                    >
                                                        <SkillTooltip
                                                            skillText={ship.chargeSkillText}
                                                            skillType="Charge Skill"
                                                        />
                                                    </Tooltip>
                                                </div>
                                            )}
                                            {ship.firstPassiveSkillText && (
                                                <div className="relative">
                                                    <div
                                                        ref={(el) => {
                                                            tooltipRefs.current[
                                                                `${ship.name}_passive1`
                                                            ] = el;
                                                        }}
                                                        onMouseEnter={() =>
                                                            setPassive1Hover(ship.name)
                                                        }
                                                        onMouseLeave={() => setPassive1Hover('')}
                                                    >
                                                        <Button variant="secondary" size="xs">
                                                            Passive
                                                        </Button>
                                                    </div>
                                                    <Tooltip
                                                        isVisible={passive1Hover === ship.name}
                                                        targetElement={
                                                            tooltipRefs.current[
                                                                `${ship.name}_passive1`
                                                            ]
                                                        }
                                                    >
                                                        <SkillTooltip
                                                            skillText={ship.firstPassiveSkillText}
                                                            skillType="Passive Skill"
                                                        />
                                                    </Tooltip>
                                                </div>
                                            )}
                                            {ship.secondPassiveSkillText && (
                                                <div className="relative">
                                                    <div
                                                        ref={(el) => {
                                                            tooltipRefs.current[
                                                                `${ship.name}_passive2`
                                                            ] = el;
                                                        }}
                                                        onMouseEnter={() =>
                                                            setPassive2Hover(ship.name)
                                                        }
                                                        onMouseLeave={() => setPassive2Hover('')}
                                                    >
                                                        <Button variant="secondary" size="xs">
                                                            Passive R2
                                                        </Button>
                                                    </div>
                                                    <Tooltip
                                                        isVisible={passive2Hover === ship.name}
                                                        targetElement={
                                                            tooltipRefs.current[
                                                                `${ship.name}_passive2`
                                                            ]
                                                        }
                                                    >
                                                        <SkillTooltip
                                                            skillText={ship.secondPassiveSkillText}
                                                            skillType="Passive Skill R2"
                                                        />
                                                    </Tooltip>
                                                </div>
                                            )}
                                            {ship.thirdPassiveSkillText && (
                                                <div className="relative">
                                                    <div
                                                        ref={(el) => {
                                                            tooltipRefs.current[
                                                                `${ship.name}_passive3`
                                                            ] = el;
                                                        }}
                                                        onMouseEnter={() =>
                                                            setPassive3Hover(ship.name)
                                                        }
                                                        onMouseLeave={() => setPassive3Hover('')}
                                                    >
                                                        <Button variant="secondary" size="xs">
                                                            Passive R4
                                                        </Button>
                                                    </div>
                                                    <Tooltip
                                                        isVisible={passive3Hover === ship.name}
                                                        targetElement={
                                                            tooltipRefs.current[
                                                                `${ship.name}_passive3`
                                                            ]
                                                        }
                                                    >
                                                        <SkillTooltip
                                                            skillText={ship.thirdPassiveSkillText}
                                                            skillType="Passive Skill R4"
                                                        />
                                                    </Tooltip>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </ShipDisplay>
                            ))
                        ) : (
                            <div className="col-span-full text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                                No matching ships found
                            </div>
                        )}
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default ShipIndexPage;
