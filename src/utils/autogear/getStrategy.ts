import { AutogearStrategy, AutogearAlgorithm } from './AutogearStrategy';
import { BeamSearchStrategy } from './strategies/BeamSearchStrategy';
import { TwoPassStrategy } from './strategies/TwoPassStrategy';
import { SetFirstStrategy } from './strategies/SetFirstStrategy';
import { GeneticStrategy } from './strategies/GeneticStrategy';

export const getAutogearStrategy = (algorithm: AutogearAlgorithm): AutogearStrategy => {
    switch (algorithm) {
        case AutogearAlgorithm.BeamSearch:
            return new BeamSearchStrategy();
        case AutogearAlgorithm.TwoPass:
            return new TwoPassStrategy();
        case AutogearAlgorithm.SetFirst:
            return new SetFirstStrategy();
        case AutogearAlgorithm.Genetic:
            return new GeneticStrategy();
        default:
            return new BeamSearchStrategy();
    }
}; 