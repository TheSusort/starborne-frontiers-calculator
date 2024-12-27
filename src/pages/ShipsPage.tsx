import React, { useState, useCallback } from 'react';
import { ShipForm } from '../components/ship/ShipForm';
import { ShipInventory } from '../components/ship/ShipInventory';
import { useInventory } from '../hooks/useInventory';
import { useShips } from '../hooks/useShips';
import { PageLayout, CollapsibleForm } from '../components/ui';
import { useNotification } from '../hooks/useNotification';

export const ShipsPage: React.FC = () => {
  const { inventory, saveInventory } = useInventory();
  const getGearPiece = useCallback(
    (id: string) => {
      return inventory.find((gear) => gear.id === id);
    },
    [inventory]
  );

  const {
    ships,
    loading,
    error,
    editingShip,
    handleRemoveShip,
    handleEquipGear,
    handleRemoveGear,
    handleSaveShip,
    setEditingShip,
  } = useShips({ getGearPiece });
  const [isFormVisible, setIsFormVisible] = useState(false);
  const { addNotification } = useNotification();

  if (loading) {
    return (
      <div className="flex items-center justify-center">
        <div className="animate-pulse text-xl text-gray-200">Loading ships...</div>
      </div>
    );
  }

  return (
    <PageLayout
      title="Ship Management"
      description="Manage your ships and their equipment."
      action={{
        label: isFormVisible ? 'Hide Form' : 'Create',
        onClick: () => {
          if (editingShip) {
            setEditingShip(undefined);
          }
          setIsFormVisible(!isFormVisible);
        },
      }}
    >
      {error && <>{addNotification('error', error)}</>}

      <CollapsibleForm isVisible={isFormVisible || !!editingShip}>
        <ShipForm
          onSubmit={async (ship) => {
            await handleSaveShip(ship);
            setIsFormVisible(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setEditingShip(undefined);
            addNotification('success', 'Ship saved successfully');
          }}
          editingShip={editingShip}
        />
      </CollapsibleForm>

      <ShipInventory
        ships={ships}
        onRemove={(ship) => {
          handleRemoveShip(ship);
          addNotification('success', 'Ship removed successfully');
        }}
        onEdit={(ship) => {
          setEditingShip(ship);
          setIsFormVisible(true);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onEquipGear={async (shipId, slot, gearId) => {
          handleEquipGear(shipId, slot, gearId);

          const newInventory = inventory.map((gear) => {
            if (gear.id === gearId) {
              return { ...gear, shipId };
            }
            return gear;
          });
          await saveInventory(newInventory);
        }}
        onRemoveGear={async (shipId, slot, showNotification = true) => {
          const ship = ships.find((s) => s.id === shipId);
          const gearId = ship?.equipment[slot];

          handleRemoveGear(shipId, slot);

          if (gearId) {
            const newInventory = inventory.map((gear) => {
              if (gear.id === gearId) {
                return { ...gear, shipId: '' };
              }
              return gear;
            });
            await saveInventory(newInventory);
          }

          if (showNotification) {
            addNotification('success', 'Gear removed successfully');
          }
        }}
        availableGear={inventory}
      />
    </PageLayout>
  );
};
