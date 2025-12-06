import { SimulationSummary } from './simulationCalculator';
import { GEAR_SETS } from '../../constants';
import { ENEMY_COUNT } from '../../constants/simulation';

/**
 * Calculates shield generated based on simulation data
 */
export const calculateShieldGenerated = (
    simulation: SimulationSummary,
    currentSimulation?: SimulationSummary,
    suggestedSimulation?: SimulationSummary
): {
    current: number;
    suggested: number;
    value: number;
} => {
    const shieldSetValue = GEAR_SETS['SHIELD']?.stats[0].value || 0;
    const shieldSetCount = simulation.activeSets?.filter((set) => set === 'SHIELD').length || 0;
    const survivedRounds = Math.floor(simulation.survivedRounds || 0);
    const hp = simulation.hp || 0;

    const value = Math.round(((survivedRounds * shieldSetValue * shieldSetCount) / 100) * hp);

    const current = currentSimulation
        ? Math.round(
              ((Math.floor(currentSimulation.survivedRounds || 0) *
                  shieldSetValue *
                  (currentSimulation.activeSets?.filter((set) => set === 'SHIELD').length || 0)) /
                  100) *
                  (currentSimulation.hp || 0)
          )
        : value;

    const suggested = suggestedSimulation
        ? Math.round(
              ((Math.floor(suggestedSimulation.survivedRounds || 0) *
                  shieldSetValue *
                  (suggestedSimulation.activeSets?.filter((set) => set === 'SHIELD').length || 0)) /
                  100) *
                  (suggestedSimulation.hp || 0)
          )
        : value;

    return { current, suggested, value };
};

/**
 * Calculates total healing on hit based on simulation data
 */
export const calculateHealingOnHit = (
    simulation: SimulationSummary,
    currentSimulation?: SimulationSummary,
    suggestedSimulation?: SimulationSummary
): {
    current: number;
    suggested: number;
    value: number;
} => {
    const value = Math.round(
        (simulation.survivedRounds || 0) * ENEMY_COUNT * (simulation.healingPerHit || 0)
    );

    const current = currentSimulation
        ? Math.round(
              (currentSimulation.survivedRounds || 0) *
                  ENEMY_COUNT *
                  (currentSimulation.healingPerHit || 0)
          )
        : value;

    const suggested = suggestedSimulation
        ? Math.round(
              (suggestedSimulation.survivedRounds || 0) *
                  ENEMY_COUNT *
                  (suggestedSimulation.healingPerHit || 0)
          )
        : value;

    return { current, suggested, value };
};
