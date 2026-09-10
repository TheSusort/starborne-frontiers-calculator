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

// A persisted config is untyped storage, not a value this module ever authored: an older
// build's saved `selectedAlgorithm` can name a strategy the current union no longer has (a
// removed algorithm, or a hand-edited/imported config). The Record above stays total over
// AutogearAlgorithm — that keeps registering a new strategy a compile-time-enforced pairing
// with the enum — and the guard is what widens at the boundary: a name outside the union
// falls back to Genetic instead of indexing the Record to undefined.
export function getAutogearStrategy(algorithm: string): AutogearStrategy {
    return isAutogearAlgorithm(algorithm)
        ? strategies[algorithm]
        : strategies[AutogearAlgorithm.Genetic];
}
