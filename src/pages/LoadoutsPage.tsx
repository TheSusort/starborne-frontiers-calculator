import React, { useState } from 'react';
import { PageLayout, CollapsibleForm, Tabs } from '../components/ui';
import { useLoadouts } from '../hooks/useLoadouts';
import { LoadoutForm } from '../components/loadout/LoadoutForm';
import { LoadoutList } from '../components/loadout/LoadoutList';
import { TeamLoadoutForm } from '../components/loadout/TeamLoadoutForm';
import { TeamLoadoutCard } from '../components/loadout/TeamLoadoutCard';
import { useInventory } from '../hooks/useInventory';
import { useNotification } from '../contexts/NotificationContext';
import { useShips } from '../hooks/useShips';

export const LoadoutsPage: React.FC = () => {
    const [showForm, setShowForm] = useState(false);
    const [activeTab, setActiveTab] = useState<'individual' | 'team'>('individual');
    const {
        loadouts, addLoadout, updateLoadout, deleteLoadout,
        teamLoadouts, addTeamLoadout, updateTeamLoadout, deleteTeamLoadout
    } = useLoadouts();
    const { getGearPiece, inventory } = useInventory();
    const { ships } = useShips();
    const { addNotification } = useNotification();

    return (
        <PageLayout
            title="Loadouts"
            description="Manage your ship gear loadouts, save your favorite setups for easy access."
            action={{
                label: showForm ? "Hide Form" : `New ${activeTab === 'individual' ? 'Loadout' : 'Team'}`,
                onClick: () => setShowForm(!showForm),
                variant: "primary"
            }}
        >
            <Tabs
                tabs={[
                    { id: 'individual', label: 'Individual Loadouts' },
                    { id: 'team', label: 'Team Loadouts' },
                ]}
                activeTab={activeTab}
                onChange={(tab) => {
                    setActiveTab(tab as 'individual' | 'team');
                    setShowForm(false);
                }}
            />

            {activeTab === 'individual' ? (
                <>
                    <CollapsibleForm isVisible={showForm}>
                        <LoadoutForm
                            onSubmit={(loadout) => {
                                addLoadout(loadout);
                                setShowForm(false);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                                addNotification('success', 'Loadout created successfully');
                            }}
                        />
                    </CollapsibleForm>

                    <LoadoutList
                        loadouts={loadouts}
                        onUpdate={updateLoadout}
                        onDelete={deleteLoadout}
                        getGearPiece={getGearPiece}
                        availableGear={inventory}
                    />
                </>
            ) : (
                <>
                    <CollapsibleForm isVisible={showForm}>
                        <TeamLoadoutForm
                            onSubmit={(teamLoadout) => {
                                try {
                                    addTeamLoadout(teamLoadout);
                                    setShowForm(false);
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                    addNotification('success', 'Team loadout created successfully');
                                } catch (error) {
                                    addNotification('error', error instanceof Error ? error.message : 'Failed to create team loadout');
                                }
                            }}
                        />
                    </CollapsibleForm>

                    <div className="grid grid-cols-1 gap-4">
                        {teamLoadouts.map(teamLoadout => (
                            <TeamLoadoutCard
                                key={teamLoadout.id}
                                teamLoadout={teamLoadout}
                                ships={ships}
                                availableGear={inventory}
                                getGearPiece={getGearPiece}
                                onUpdate={updateTeamLoadout}
                                onDelete={deleteTeamLoadout}
                            />
                        ))}

                        {teamLoadouts.length === 0 && (
                            <div className="text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                                No team loadouts created yet. Create one by clicking the "New Team" button above.
                            </div>
                        )}
                    </div>
                </>
            )}
        </PageLayout>
    );
};