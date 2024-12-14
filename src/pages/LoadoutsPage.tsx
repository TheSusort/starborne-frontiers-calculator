import React, { useState } from 'react';
import { PageLayout } from '../components/layout/PageLayout';
import { useLoadouts } from '../hooks/useLoadouts';
import { LoadoutForm } from '../components/loadout/LoadoutForm';
import { LoadoutList } from '../components/loadout/LoadoutList';
import { useInventory } from '../hooks/useInventory';
import { CollapsibleForm } from '../components/layout/CollapsibleForm';
import { useNotification } from '../contexts/NotificationContext';

export const LoadoutsPage: React.FC = () => {
    const [showForm, setShowForm] = useState(false);
    const { loadouts, addLoadout, updateLoadout, deleteLoadout } = useLoadouts();
    const { getGearPiece, inventory } = useInventory();
    const { addNotification } = useNotification();

    return (
        <PageLayout
            title="Loadouts"
            description="Manage your ship gear loadouts, save your favorite setups for easy access."
            action={{
                label: showForm ? "Hide Form" : "New Loadout",
                onClick: () => setShowForm(!showForm),
                variant: "primary"
            }}
        >

            <CollapsibleForm isVisible={showForm}>
                <LoadoutForm
                    onSubmit={(loadout) => {
                        addLoadout(loadout);
                        setShowForm(false);
                        addNotification('success', 'Loadout created successfully');
                    }}
                />
            </CollapsibleForm>

            <LoadoutList
                loadouts={loadouts}
                onUpdate={(loadout, inventory) => {
                    updateLoadout(loadout, inventory);
                    addNotification('success', 'Loadout updated successfully');
                }}
                onDelete={(loadout) => {
                    deleteLoadout(loadout);
                    addNotification('success', 'Loadout deleted successfully');
                }}
                getGearPiece={getGearPiece}
                availableGear={inventory}
            />
        </PageLayout>
    );
};