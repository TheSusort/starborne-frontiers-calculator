import { AutogearStrategy, AutogearAlgorithm } from './AutogearStrategy';
import { BeamSearchStrategy } from './strategies/BeamSearchStrategy';
import { TwoPassStrategy } from './strategies/TwoPassStrategy';
import { GeneticStrategy } from './strategies/GeneticStrategy';
import { SetFirstStrategy } from './strategies/SetFirstStrategy';

const strategies: Record<AutogearAlgorithm, AutogearStrategy> = {
    [AutogearAlgorithm.BeamSearch]: new BeamSearchStrategy(),
    [AutogearAlgorithm.TwoPass]: new TwoPassStrategy(),
    [AutogearAlgorithm.Genetic]: new GeneticStrategy(),
    [AutogearAlgorithm.SetFirst]: new SetFirstStrategy(),
};

export function getAutogearStrategy(algorithm: AutogearAlgorithm): AutogearStrategy {
    return strategies[algorithm];
}