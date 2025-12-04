import React, { useState } from 'react';
import { EncounterNote, LocalEncounterNote, ShipPosition } from '../../types/encounters';
import EncounterForm from '../../components/encounters/EncounterForm';
import EncounterList from '../../components/encounters/EncounterList';
import { PageLayout } from '../../components/ui/layout/PageLayout';
import { ConfirmModal } from '../../components/ui/layout/ConfirmModal';
import { CollapsibleForm } from '../../components/ui/layout/CollapsibleForm';
import { useEncounterNotes } from '../../hooks/useEncounterNotes';
import { useSharedEncounters } from '../../hooks/useSharedEncounters';
import { useNotification } from '../../hooks/useNotification';
import { useShips } from '../../contexts/ShipsContext';
import { Loader } from '../../components/ui/Loader';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

const EncounterNotesPage: React.FC = () => {
    const { encounters, addEncounter, updateEncounter, deleteEncounter, loading } =
        useEncounterNotes();
    const { shareEncounter, unshareEncounter } = useSharedEncounters();
    const { addNotification } = useNotification();
    const { ships } = useShips();
    const [editingEncounter, setEditingEncounter] = useState<EncounterNote | null>(null);
    const [deletingEncounterId, setDeletingEncounterId] = useState<string | null>(null);
    const [isFormVisible, setIsFormVisible] = useState(false);

    const handleSubmit = async (encounter: EncounterNote) => {
        if (editingEncounter) {
            updateEncounter(encounter);
            setEditingEncounter(null);
            addNotification('success', 'Encounter Updated');
        } else {
            // Convert to LocalEncounterNote if it's a SharedEncounterNote
            const localEncounter: LocalEncounterNote = {
                ...encounter,
                formation: encounter.formation.map((pos): ShipPosition => {
                    if ('shipName' in pos) {
                        const ship = ships.find((s) => s.name === pos.shipName);
                        if (!ship) {
                            throw new Error(`Ship with name ${pos.shipName} not found`);
                        }
                        return { shipId: ship.id, position: pos.position };
                    }
                    return pos;
                }),
            };
            addEncounter(localEncounter);
            addNotification('success', 'Encounter Added');
        }
        setIsFormVisible(false);
    };

    const handleEdit = (encounter: EncounterNote) => {
        setEditingEncounter(encounter);
        setIsFormVisible(true);
        window.scrollTo(0, 0);
    };

    const handleDeleteClick = (encounterId: string) => {
        setDeletingEncounterId(encounterId);
    };

    const handleConfirmDelete = async () => {
        if (deletingEncounterId) {
            deleteEncounter(deletingEncounterId);
            if (editingEncounter?.id === deletingEncounterId) {
                setEditingEncounter(null);
                setIsFormVisible(false);
            }
            addNotification('success', 'Encounter Deleted');
        }
    };

    const handleShareToggle = async (encounter: EncounterNote) => {
        try {
            if (encounter.isPublic) {
                await unshareEncounter(encounter.id);
                updateEncounter({
                    ...encounter,
                    isPublic: false,
                });
            } else {
                // Convert to LocalEncounterNote if it's a SharedEncounterNote
                const localEncounter: LocalEncounterNote = {
                    ...encounter,
                    formation: encounter.formation.map((pos): ShipPosition => {
                        if ('shipName' in pos) {
                            const ship = ships.find((s) => s.name === pos.shipName);
                            if (!ship) {
                                throw new Error(`Ship with name ${pos.shipName} not found`);
                            }
                            return { shipId: ship.id, position: pos.position };
                        }
                        return pos;
                    }),
                };
                await shareEncounter(localEncounter);
                updateEncounter({
                    ...encounter,
                    isPublic: true,
                });
            }
        } catch (error) {
            console.error('Failed to toggle encounter sharing:', error);
            addNotification('error', 'Failed to update encounter sharing status');
        }
    };

    if (loading) {
        return <Loader />;
    }

    return (
        <>
            <Seo {...SEO_CONFIG.encounters} />
            <PageLayout
                title="Encounter Notes"
                description="Save and manage your successful fleet formations for different encounters"
                action={{
                    label: isFormVisible ? 'Hide Form' : 'Add Encounter',
                    onClick: () => {
                        if (editingEncounter) {
                            setEditingEncounter(null);
                        }
                        setIsFormVisible(!isFormVisible);
                    },
                    variant: isFormVisible ? 'secondary' : 'primary',
                }}
            >
                <CollapsibleForm isVisible={isFormVisible}>
                    <div className="card mb-6">
                        <h2 className="text-xl font-semibold text-white mb-4">
                            {editingEncounter ? 'Edit Encounter' : 'Add New Encounter'}
                        </h2>
                        <EncounterForm
                            onSubmit={handleSubmit}
                            initialEncounter={editingEncounter}
                        />
                    </div>
                </CollapsibleForm>

                <EncounterList
                    encounters={encounters}
                    onEdit={handleEdit}
                    onDelete={handleDeleteClick}
                    onShareToggle={handleShareToggle}
                />

                <ConfirmModal
                    isOpen={!!deletingEncounterId}
                    onClose={() => setDeletingEncounterId(null)}
                    onConfirm={handleConfirmDelete}
                    title="Delete Encounter"
                    message="Are you sure you want to delete this encounter? This action cannot be undone."
                    confirmLabel="Delete"
                />
            </PageLayout>
        </>
    );
};

export default EncounterNotesPage;
