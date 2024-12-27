import { GearPiece } from '../types/gear';
import { GEAR_SETS } from '../constants';

export const calculateGearSets = (equippedGear: GearPiece[]): string[] => {
  const setCounter: Record<string, number> = {};

  // Count pieces from each set
  equippedGear.forEach((gear) => {
    if (gear.setBonus) {
      setCounter[gear.setBonus] = (setCounter[gear.setBonus] || 0) + 1;
    }
  });

  // Return sets that meet the minimum requirement
  return Object.entries(setCounter)
    .filter(([setName, count]) => count >= (GEAR_SETS[setName]?.minPieces || 2))
    .map(([setName]) => setName);
};
