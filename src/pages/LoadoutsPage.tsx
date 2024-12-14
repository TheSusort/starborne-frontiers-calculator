import React, { useState } from 'react';
import { PageLayout } from '../components/layout/PageLayout';
import { useLoadouts } from '../hooks/useLoadouts';
import { LoadoutForm } from '../components/loadout/LoadoutForm';
import { LoadoutList } from '../components/loadout/LoadoutList';
import { useInventory } from '../hooks/useInventory';
import { CollapsibleForm } from '../components/layout/CollapsibleForm';

export const LoadoutsPage: React.FC = () => {
    const [showForm, setShowForm] = useState(false);
    const { loadouts, addLoadout, updateLoadout, deleteLoadout } = useLoadouts();
    const { getGearPiece, inventory } = useInventory();
    return (
        <PageLayout
            title="Loadouts"
            description="Manage your ship gear loadouts"
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
        </PageLayout>
    );
};