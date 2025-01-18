import { AffinityName, Ship } from '../types/ship';
import { SHIPS } from '../constants/ships';

export const migrateShipAffinity = () => {
    const savedShipsJson = localStorage.getItem('ships');
    if (!savedShipsJson) return;

    try {
        const ships: Ship[] = JSON.parse(savedShipsJson);
        let hasChanges = false;

        const updatedShips = ships.map((ship) => {
            // Skip if ship already has affinity
            if (ship.affinity) return ship;

            // Look up ship in constants
            const shipData =
                SHIPS[ship.name.toUpperCase().replace(/ /g, '_') as keyof typeof SHIPS];
            if (shipData?.affinity) {
                hasChanges = true;
                return {
                    ...ship,
                    affinity: shipData.affinity.toLowerCase() as AffinityName,
                };
            }

            return ship;
        });

        if (hasChanges) {
            localStorage.setItem('ships', JSON.stringify(updatedShips));
        }
    } catch (error) {
        console.error('Error during affinity migration:', error);
    }
};
