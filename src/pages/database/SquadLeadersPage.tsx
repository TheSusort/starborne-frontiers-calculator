import React, { useMemo, useState } from 'react';
import { PageLayout } from '../../components/ui';
import { FilterPanel, FilterConfig } from '../../components/filters/FilterPanel';
import { usePersistedFilters } from '../../hooks/usePersistedFilters';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { SQUAD_LEADERS } from '../../constants/squadLeaders';
import { FACTIONS } from '../../constants/factions';
import { RARITIES } from '../../constants/rarities';
import { SquadLeaderCard } from '../../components/squadLeaders/SquadLeaderCard';

const FACTION_KEYS = Object.keys(SQUAD_LEADERS);

// Rarity filter options, legendary-first to match the rest of the app.
const RARITY_OPTIONS = (['legendary', 'epic', 'rare'] as const).map((r) => ({
    value: r,
    label: RARITIES[r].label,
}));

export const SquadLeadersPage: React.FC = () => {
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { state, setState, clearFilters } = usePersistedFilters('squad-leaders-filters', {
        sort: { field: 'name', direction: 'asc' },
    });

    const selectedFactions = useMemo(() => state.filters.factions ?? [], [state.filters.factions]);
    const selectedRarities = useMemo(() => state.filters.rarities ?? [], [state.filters.rarities]);
    const hasActiveFilters =
        selectedFactions.length > 0 || selectedRarities.length > 0 || searchQuery.length > 0;

    const setSelectedFactions = (factions: string[]) =>
        setState((prev) => ({ ...prev, filters: { ...prev.filters, factions } }));
    const setSelectedRarities = (rarities: string[]) =>
        setState((prev) => ({ ...prev, filters: { ...prev.filters, rarities } }));

    const filters: FilterConfig[] = [
        {
            id: 'faction',
            label: 'Faction',
            values: selectedFactions,
            onChange: setSelectedFactions,
            options: FACTION_KEYS.map((key) => ({ value: key, label: FACTIONS[key].name })),
        },
        {
            id: 'rarity',
            label: 'Rarity',
            values: selectedRarities,
            onChange: setSelectedRarities,
            options: RARITY_OPTIONS,
        },
    ];

    const groups = useMemo(() => {
        const query = searchQuery.toLowerCase();
        return FACTION_KEYS.filter(
            (key) => selectedFactions.length === 0 || selectedFactions.includes(key)
        )
            .map((key) => {
                const leaders = SQUAD_LEADERS[key].filter((leader) => {
                    const matchesRarity =
                        selectedRarities.length === 0 || selectedRarities.includes(leader.rarity);
                    const matchesSearch =
                        query === '' ||
                        leader.name.toLowerCase().includes(query) ||
                        leader.stages.some((stage) =>
                            stage.some((effect) => effect.text.toLowerCase().includes(query))
                        );
                    return matchesRarity && matchesSearch;
                });
                return { key, leaders };
            })
            .filter((group) => group.leaders.length > 0);
    }, [selectedFactions, selectedRarities, searchQuery]);

    const totalCount = groups.reduce((sum, group) => sum + group.leaders.length, 0);

    return (
        <>
            <Seo {...SEO_CONFIG.squadLeaders} />
            <PageLayout
                title="Squad Leaders"
                description="Browse squad leaders for every faction and the bonuses each grants across its three upgrade steps. Step bonuses are cumulative — a leader at step III has all three steps active."
            >
                <div className="space-y-6">
                    <div className="flex flex-col">
                        {totalCount > 0 && (
                            <span className="text-sm text-theme-text-secondary">
                                Showing {totalCount} squad leaders
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
                            searchValue={searchQuery}
                            onSearchChange={setSearchQuery}
                            searchPlaceholder="Search by name or effect..."
                        />
                    </div>

                    {groups.length > 0 ? (
                        <div className="space-y-8">
                            {groups.map(({ key, leaders }) => (
                                <section key={key} className="space-y-3">
                                    <div className="flex items-center gap-2 border-b border-dark-border pb-2">
                                        {FACTIONS[key] && (
                                            <img
                                                src={FACTIONS[key].iconUrl}
                                                alt={FACTIONS[key].name}
                                                className="w-6 h-6"
                                            />
                                        )}
                                        <h2 className="text-xl font-semibold">
                                            {FACTIONS[key]?.name ?? key}
                                        </h2>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {leaders.map((leader) => (
                                            <SquadLeaderCard key={leader.name} leader={leader} />
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8 text-theme-text-secondary bg-dark-lighter border-2 border-dashed">
                            No squad leaders match your filters
                        </div>
                    )}
                </div>
            </PageLayout>
        </>
    );
};

export default SquadLeadersPage;
