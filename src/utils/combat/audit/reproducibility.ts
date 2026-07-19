import type { BattleSimulationInput } from '../../calculators/battleSimulator';
import type { InvariantViolation } from './types';
import { runSeededBattle } from './seededBattle';

/** Two runs of the same (input, seed) must be byte-identical. This guards
 *  nondeterminism OTHER than the (now-pinned) RNG — Map-iteration order, leaked
 *  global state, etc. runSeededBattle re-seeds each call, so any diff is a real bug. */
export function checkReproducibility(
    input: BattleSimulationInput,
    seed: number
): InvariantViolation[] {
    const a = JSON.stringify(runSeededBattle(input, seed));
    const b = JSON.stringify(runSeededBattle(input, seed));
    if (a !== b) {
        return [
            {
                invariant: 'reproducibility',
                round: 0,
                detail: `two seeded runs (seed ${seed}) diverged`,
            },
        ];
    }
    return [];
}
