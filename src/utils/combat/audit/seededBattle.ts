import {
    simulateBattle,
    type BattleSimulationInput,
    type BattleResult,
} from '../../calculators/battleSimulator';
import { setupKeyedTestRng, resetRateGateRng } from '../../calculators/rateAccumulator';

/** Run a battle under a pinned RNG seed so the result is byte-reproducible.
 *  Production combat draws crit/hit/landing from Math.random via rateAccumulator;
 *  setupKeyedTestRng installs a seeded keyed sub-stream provider for the duration
 *  of this call, and resetRateGateRng restores Math.random afterward. The reset
 *  runs in finally so a throwing battle never leaks the seeded RNG into later runs.
 *
 *  Caveat: the `finally` resets to `Math.random` (the production default), NOT to any
 *  ambient test seed. So calling raw `simulateBattle` directly after `runSeededBattle` in
 *  the same test is nondeterministic — always go through `runSeededBattle` (or re-call
 *  `setupKeyedTestRng` yourself) rather than assuming the seeded stream is still installed. */
export function runSeededBattle(input: BattleSimulationInput, seed: number): BattleResult {
    setupKeyedTestRng(seed);
    try {
        return simulateBattle(input);
    } finally {
        resetRateGateRng();
    }
}
