import { describe, it, expect } from 'vitest';
import { getAutogearStrategy } from '../getStrategy';
import { AutogearAlgorithm } from '../AutogearStrategy';
import { GeneticStrategy } from '../strategies/GeneticStrategy';

describe('getAutogearStrategy', () => {
    it('resolves every current algorithm to its own distinct strategy', () => {
        // Asserting each call is "defined" would also pass a version that silently routes
        // every unregistered enum member to the Genetic fallback — distinctness is what
        // proves each algorithm reaches its own registered strategy instance.
        const resolved = Object.values(AutogearAlgorithm).map((algorithm) =>
            getAutogearStrategy(algorithm)
        );
        expect(new Set(resolved).size).toBe(Object.values(AutogearAlgorithm).length);
    });

    it('falls back to Genetic for an algorithm name outside the current union', () => {
        // A persisted config is read back as plain storage, not a value this module
        // authored — an older build's saved selectedAlgorithm can name a strategy the
        // current AutogearAlgorithm union no longer has. This passes exactly that shape
        // (an arbitrary string, not a member of the enum) through the same path a
        // deserialized config takes.
        const staleConfigValue: string = 'beamSearch';
        const strategy = getAutogearStrategy(staleConfigValue);
        expect(strategy).toBeInstanceOf(GeneticStrategy);
    });
});
