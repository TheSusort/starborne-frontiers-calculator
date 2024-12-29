import React, { useState } from 'react';
import { EncounterNote } from '../types/encounters';
import EncounterForm from '../components/encounters/EncounterForm';
import EncounterList from '../components/encounters/EncounterList';
import { PageLayout } from '../components/ui/layout/PageLayout';
import { ConfirmModal } from '../components/ui/layout/ConfirmModal';
import { CollapsibleForm } from '../components/ui/layout/CollapsibleForm';
import { useEncounterNotes } from '../hooks/useEncounterNotes';
import { useNotification } from '../hooks/useNotification';

const EncounterNotesPage: React.FC = () => {
    const { encounters, addEncounter, updateEncounter, deleteEncounter } = useEncounterNotes();
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

    const handleCancelEdit = () => {
        setEditingEncounter(null);
        setIsFormVisible(false);
    };

    const toggleForm = () => {
        if (isFormVisible) {
            handleCancelEdit();
        } else {
            setIsFormVisible(true);
        }
    };

    return (
        <PageLayout
            title="Encounter Notes"
            description="Save and manage your successful fleet formations for different encounters"
            action={{
                label: isFormVisible ? 'Cancel' : 'Add Encounter',
                onClick: toggleForm,
                variant: isFormVisible ? 'secondary' : 'primary',
            }}
        >
            <CollapsibleForm isVisible={isFormVisible}>
                <div className="bg-dark p-4 mb-6">
                    <h2 className="text-xl font-semibold text-white mb-4">
                        {editingEncounter ? 'Edit Encounter' : 'Add New Encounter'}
                    </h2>
                    <EncounterForm
                        onSubmit={handleSubmit}
                        initialEncounter={editingEncounter}
                        onCancel={handleCancelEdit}
                    />
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
