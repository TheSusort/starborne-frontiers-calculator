import { AutogearStrategy, AutogearAlgorithm } from './AutogearStrategy';
import { TwoPassStrategy } from './strategies/TwoPassStrategy';
import { GeneticStrategy } from './strategies/GeneticStrategy';
import { SetFirstStrategy } from './strategies/SetFirstStrategy';

const strategies: Record<AutogearAlgorithm, AutogearStrategy> = {
    [AutogearAlgorithm.TwoPass]: new TwoPassStrategy(),
    [AutogearAlgorithm.Genetic]: new GeneticStrategy(),
    [AutogearAlgorithm.SetFirst]: new SetFirstStrategy(),
};

function isAutogearAlgorithm(value: string): value is AutogearAlgorithm {
    return Object.values<string>(AutogearAlgorithm).includes(value);
}

// The app always runs Genetic (#549). This function stays string-typed, and the Record above stays total over
// AutogearAlgorithm, because `ShipOptimizerConfig.selectedAlgorithm` is still a real engine
// knob: tests and tooling call `findOptimalGearForShip` directly with TwoPass/SetFirst
// (`roleBasisWiring.test.ts`), and any future caller may pass a value this module never
// authored — a hand-edited fixture, or a name outside the current union. The guard is what
// widens at that boundary: an unrecognised name falls back to Genetic instead of indexing the
// Record to undefined.
export function getAutogearStrategy(algorithm: string): AutogearStrategy {
    return isAutogearAlgorithm(algorithm)
        ? strategies[algorithm]
        : strategies[AutogearAlgorithm.Genetic];
}
