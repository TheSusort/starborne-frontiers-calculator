import React, { useState } from 'react';
import { PageLayout, CollapsibleForm, Tabs } from '../../components/ui';
import { useLoadouts } from '../../hooks/useLoadouts';
import { LoadoutForm } from '../../components/loadout/LoadoutForm';
import { LoadoutList } from '../../components/loadout/LoadoutList';
import { TeamLoadoutForm } from '../../components/loadout/TeamLoadoutForm';
import { TeamLoadoutCard } from '../../components/loadout/TeamLoadoutCard';
import { useInventory } from '../../contexts/InventoryProvider';
import { useNotification } from '../../hooks/useNotification';
import { useShips } from '../../contexts/ShipsContext';
import { Loader } from '../../components/ui/Loader';
import { Loadout, TeamLoadout } from '../../types/loadout';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

export const LoadoutsPage: React.FC = () => {
    const [showForm, setShowForm] = useState(false);
    const [editingLoadout, setEditingLoadout] = useState<Loadout | null>(null);
    const [editingTeamLoadout, setEditingTeamLoadout] = useState<TeamLoadout | null>(null);
    const [activeTab, setActiveTab] = useState<'individual' | 'team'>('individual');
    const {
        loadouts,
        loading,
        addLoadout,
        updateLoadout,
        deleteLoadout,
        teamLoadouts,
        addTeamLoadout,
        updateTeamLoadout,
        deleteTeamLoadout,
    } = useLoadouts();
    const { getGearPiece, inventory } = useInventory();
    const { ships } = useShips();
    const { addNotification } = useNotification();

    const existingLoadoutNames = loadouts.map((loadout) => loadout.name);
    const existingTeamNames = teamLoadouts.map((loadout) => loadout.name);

    if (loading) {
        return <Loader />;
    }

    return (
        <>
            <Seo {...SEO_CONFIG.loadouts} />
            <PageLayout
                title="Loadouts"
                description="Manage your ship gear loadouts, save your favorite setups for easy access."
                action={{
                    label: showForm
                        ? 'Hide Form'
                        : `New ${activeTab === 'individual' ? 'Loadout' : 'Team'}`,
                    onClick: () => {
                        setShowForm(!showForm);
                        setEditingLoadout(null);
                        setEditingTeamLoadout(null);
                    },
                    variant: showForm ? 'secondary' : 'primary',
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
                        setEditingLoadout(null);
                        setEditingTeamLoadout(null);
                    }}
                />

                {activeTab === 'individual' ? (
                    <>
                        <CollapsibleForm isVisible={showForm || editingLoadout !== null}>
                            <LoadoutForm
                                key={editingLoadout?.id || 'create'}
                                onSubmit={(loadout) => {
                                    if (editingLoadout) {
                                        void updateLoadout(editingLoadout.id, loadout.equipment, {
                                            name: loadout.name,
                                            shipId: loadout.shipId,
                                        });
                                        setEditingLoadout(null);
                                        addNotification('success', 'Loadout updated successfully');
                                    } else {
                                        void addLoadout(loadout);
                                        addNotification('success', 'Loadout created successfully');
                                    }
                                    setShowForm(false);
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                existingNames={existingLoadoutNames.filter(
                                    (n) => n !== editingLoadout?.name
                                )}
                                initialValues={
                                    editingLoadout
                                        ? {
                                              name: editingLoadout.name,
                                              ship: ships.find(
                                                  (s) => s.id === editingLoadout.shipId
                                              )!,
                                          }
                                        : undefined
                                }
                                onCancel={
                                    editingLoadout
                                        ? () => {
                                              setEditingLoadout(null);
                                              setShowForm(false);
                                          }
                                        : undefined
                                }
                            />
                        </CollapsibleForm>

                        <LoadoutList
                            loadouts={loadouts}
                            onEdit={(loadout) => {
                                setEditingLoadout(loadout);
                                setShowForm(false);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            onUpdate={(...args) => void updateLoadout(...args)}
                            onDelete={(...args) => void deleteLoadout(...args)}
                            getGearPiece={getGearPiece}
                            availableGear={inventory}
                        />
                    </>
                ) : (
                    <>
                        <CollapsibleForm isVisible={showForm || editingTeamLoadout !== null}>
                            <TeamLoadoutForm
                                key={editingTeamLoadout?.id || 'create'}
                                onSubmit={(teamLoadout) => {
                                    try {
                                        if (editingTeamLoadout) {
                                            void updateTeamLoadout(
                                                editingTeamLoadout.id,
                                                teamLoadout.shipLoadouts,
                                                { name: teamLoadout.name }
                                            );
                                            setEditingTeamLoadout(null);
                                            addNotification(
                                                'success',
                                                'Team loadout updated successfully'
                                            );
                                        } else {
                                            void addTeamLoadout(teamLoadout);
                                            addNotification(
                                                'success',
                                                'Team loadout created successfully'
                                            );
                                        }
                                        setShowForm(false);
                                        window.scrollTo({ top: 0, behavior: 'smooth' });
                                    } catch (error) {
                                        addNotification(
                                            'error',
                                            error instanceof Error
                                                ? error.message
                                                : 'Failed to save team loadout'
                                        );
                                    }
                                }}
                                existingNames={existingTeamNames.filter(
                                    (n) => n !== editingTeamLoadout?.name
                                )}
                                initialValues={
                                    editingTeamLoadout
                                        ? {
                                              name: editingTeamLoadout.name,
                                              ships: editingTeamLoadout.shipLoadouts.map(
                                                  (sl) =>
                                                      ships.find((s) => s.id === sl.shipId) || null
                                              ),
                                          }
                                        : undefined
                                }
                                onCancel={
                                    editingTeamLoadout
                                        ? () => {
                                              setEditingTeamLoadout(null);
                                              setShowForm(false);
                                          }
                                        : undefined
                                }
                            />
                        </CollapsibleForm>

                        <div className="grid grid-cols-1 gap-6">
                            {teamLoadouts.map((teamLoadout) => (
                                <TeamLoadoutCard
                                    key={teamLoadout.id}
                                    teamLoadout={teamLoadout}
                                    ships={ships}
                                    availableGear={inventory}
                                    getGearPiece={getGearPiece}
                                    onUpdate={(...args) => void updateTeamLoadout(...args)}
                                    onEdit={(tl) => {
                                        setEditingTeamLoadout(tl);
                                        setShowForm(false);
                                        window.scrollTo({ top: 0, behavior: 'smooth' });
                                    }}
                                    onDelete={(...args) => void deleteTeamLoadout(...args)}
                                />
                            ))}

                            {teamLoadouts.length === 0 && (
                                <div className="text-center py-8 text-theme-text-secondary bg-dark-lighter border-2 border-dashed">
                                    No team loadouts created yet. Create one by clicking the
                                    &quot;New Team&quot; button above.
                                </div>
                            )}
                        </div>
                    </>
                )}
            </PageLayout>
        </>
    );
};

export default LoadoutsPage;
