import React, { useState } from 'react';
import { EncounterNote } from '../../types/encounters';
import EncounterForm from '../../components/encounters/EncounterForm';
import EncounterList from '../../components/encounters/EncounterList';
import { PageLayout } from '../../components/ui/layout/PageLayout';
import { ConfirmModal } from '../../components/ui/layout/ConfirmModal';
import { CollapsibleForm } from '../../components/ui/layout/CollapsibleForm';
import { useEncounterNotes } from '../../hooks/useEncounterNotes';
import { useNotification } from '../../hooks/useNotification';
import { Loader } from '../../components/ui/Loader';

const EncounterNotesPage: React.FC = () => {
    const { encounters, addEncounter, updateEncounter, deleteEncounter, loading } =
        useEncounterNotes();
    const { addNotification } = useNotification();
    const [editingEncounter, setEditingEncounter] = useState<EncounterNote | null>(null);
    const [deletingEncounterId, setDeletingEncounterId] = useState<string | null>(null);
    const [isFormVisible, setIsFormVisible] = useState(false);

    const handleSubmit = (encounter: EncounterNote) => {
        if (editingEncounter) {
            updateEncounter(encounter);
            setEditingEncounter(null);
            addNotification('success', 'Encounter Updated');
        } else {
            addEncounter(encounter);
            addNotification('success', 'Encounter Added');
        }
        setIsFormVisible(false);
    };

    const handleEdit = (encounter: EncounterNote) => {
        setEditingEncounter(encounter);
        setIsFormVisible(true);
    };

    const handleDeleteClick = (encounterId: string) => {
        setDeletingEncounterId(encounterId);
    };

    const handleConfirmDelete = () => {
        if (deletingEncounterId) {
            deleteEncounter(deletingEncounterId);
            if (editingEncounter?.id === deletingEncounterId) {
                setEditingEncounter(null);
                setIsFormVisible(false);
            }
        }
        addNotification('success', 'Encounter Deleted');
    };

    if (loading) {
        return <Loader />;
    }

    return (
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
                <div className="bg-dark p-4 mb-6">
                    <h2 className="text-xl font-semibold text-white mb-4">
                        {editingEncounter ? 'Edit Encounter' : 'Add New Encounter'}
                    </h2>
                    <EncounterForm onSubmit={handleSubmit} initialEncounter={editingEncounter} />
                </div>
            </CollapsibleForm>

            <EncounterList
                encounters={encounters}
                onEdit={handleEdit}
                onDelete={handleDeleteClick}
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
    );
};

export default EncounterNotesPage;
