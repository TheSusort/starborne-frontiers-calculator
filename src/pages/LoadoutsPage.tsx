import React, { useState } from 'react';
import { PageLayout } from '../components/layout/PageLayout';
import { useLoadouts } from '../hooks/useLoadouts';
import { LoadoutForm } from '../components/loadout/LoadoutForm';
import { LoadoutList } from '../components/loadout/LoadoutList';
import { Modal } from '../components/layout/Modal';
import { useInventory } from '../hooks/useInventory';

export const LoadoutsPage: React.FC = () => {
    const [showForm, setShowForm] = useState(false);
    const { loadouts, addLoadout, updateLoadout, deleteLoadout } = useLoadouts();
    const { getGearPiece, inventory } = useInventory();
    return (
        <PageLayout
            title="Loadouts"
            description="Manage your ship gear loadouts"
            action={{
                label: "New Loadout",
                onClick: () => setShowForm(true),
                variant: "primary"
            }}
        >
            <LoadoutList
                loadouts={loadouts}
                onUpdate={updateLoadout}
                onDelete={deleteLoadout}
                getGearPiece={getGearPiece}
                availableGear={inventory}
            />

            <Modal
                isOpen={showForm}
                onClose={() => setShowForm(false)}
                title="Create New Loadout"
            >
                <LoadoutForm
                    onSubmit={(loadout) => {
                        addLoadout(loadout);
                        setShowForm(false);
                    }}
                    onCancel={() => setShowForm(false)}
                />
            </Modal>
        </PageLayout>
    );
};