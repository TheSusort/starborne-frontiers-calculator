import type { BattleSimulationInput } from '../../calculators/battleSimulator';

/**
 * Greedy ddmin composition minimizer. Drops one placement at a time from either side,
 * keeping reductions that preserve `stillFails` and never empty a side.
 *
 * Iterates deterministically (always from the last index backward) and repeats passes
 * until a full pass makes no reduction.
 *
 * @param input The composition to minimize
 * @param stillFails Predicate to check if a candidate still fails
 * @returns The smallest surviving composition that still satisfies `stillFails`
 */
export function minimizeComposition(
    input: BattleSimulationInput,
    stillFails: (candidate: BattleSimulationInput) => boolean
): BattleSimulationInput {
    let current = {
        playerTeam: [...input.playerTeam],
        enemyTeam: [...input.enemyTeam],
        rounds: input.rounds,
        playerSquadLeader: input.playerSquadLeader,
        enemySquadLeader: input.enemySquadLeader,
    };

    let madeReduction = true;

    while (madeReduction) {
        madeReduction = false;

        // Try removing from player team (iterate backward for determinism)
        for (let i = current.playerTeam.length - 1; i >= 0; i--) {
            // Never empty the side
            if (current.playerTeam.length <= 1) break;

            const candidate = {
                ...current,
                playerTeam: current.playerTeam.filter((_, idx) => idx !== i),
            };

            if (stillFails(candidate)) {
                current = candidate;
                madeReduction = true;
                break; // Restart from the end of the newly reduced list
            }
        }

        // Try removing from enemy team (iterate backward for determinism)
        if (!madeReduction) {
            for (let i = current.enemyTeam.length - 1; i >= 0; i--) {
                // Never empty the side
                if (current.enemyTeam.length <= 1) break;

                const candidate = {
                    ...current,
                    enemyTeam: current.enemyTeam.filter((_, idx) => idx !== i),
                };

                if (stillFails(candidate)) {
                    current = candidate;
                    madeReduction = true;
                    break; // Restart from the end of the newly reduced list
                }
            }
        }
    }

    return current;
}
