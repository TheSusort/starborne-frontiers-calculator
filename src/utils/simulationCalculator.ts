import { BaseStats } from '../types/stats';

export interface SimulationResult {
    damage: number;
    isCrit: boolean;
}

export interface SimulationSummary {
    averageDamage: number;
    highestHit: number;
    lowestHit: number;
    results: SimulationResult[];
}

export const runDamageSimulation = (stats: BaseStats, iterations: number = 500): SimulationSummary => {
    const results: SimulationResult[] = [];

    for (let i = 0; i < iterations; i++) {
        const isCrit = Math.random() * 100 < (stats.crit || 0);
        let damage = stats.attack || 0;

        if (isCrit) {
            const critMultiplier = 1 + ((stats.critDamage || 0) / 100);
            damage *= critMultiplier;
        }

        results.push({ damage: Math.round(damage), isCrit });
    }

    const averageDamage = Math.round(results.reduce((sum, r) => sum + r.damage, 0) / results.length);
    const highestHit = Math.max(...results.map(r => r.damage));
    const lowestHit = Math.min(...results.map(r => r.damage));

    return {
        averageDamage,
        highestHit,
        lowestHit,
        results
    };
};