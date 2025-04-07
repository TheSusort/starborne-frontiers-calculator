import React, { useState, useMemo } from 'react';
import { PageLayout } from '../components/ui/layout/PageLayout';
import EncounterList from '../components/encounters/EncounterList';
import { Loader } from '../components/ui/Loader';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { useSharedEncounters } from '../hooks/useSharedEncounters';
import { SearchInput } from '../components/ui/SearchInput';

const SharedEncountersPage: React.FC = () => {
    const { sharedEncounters, loading, voteEncounter } = useSharedEncounters();
    const [searchTerm, setSearchTerm] = useState('');

    const filteredEncounters = useMemo(() => {
        if (!searchTerm) return sharedEncounters;

        const term = searchTerm.toLowerCase();
        return sharedEncounters.filter(
            (encounter) =>
                encounter.name.toLowerCase().includes(term) ||
                (encounter.description?.toLowerCase().includes(term) ?? false)
        );
    }, [sharedEncounters, searchTerm]);

    if (loading) {
        return <Loader />;
    }

    return (
        <>
            <Seo {...SEO_CONFIG.sharedEncounters} />
            <PageLayout
                title="Shared Encounters"
                description="View and learn from other players' fleet formations. You can search by name or description, and vote for your favourites."
            >
                <div className="flex-grow max-w-md mb-2">
                    <SearchInput
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder="Search encounters by name or description..."
                    />
                </div>
                <EncounterList
                    encounters={filteredEncounters}
                    isReadOnly
                    showVotes={true}
                    onVote={voteEncounter}
                />
            </PageLayout>
        </>
    );
};

export default SharedEncountersPage;
