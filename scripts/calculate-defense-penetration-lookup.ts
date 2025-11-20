/**
 * Script to calculate defense penetration lookup table values
 * Run with: npx tsx scripts/calculate-defense-penetration-lookup.ts
 */

// Defense reduction curve approximation based on the graph
function calculateDamageReduction(defense: number): number {
    const a = 88.3505;
    const b = 4.5552;
    const c = 1.3292;

    return a * Math.exp(-Math.pow((b - Math.log10(defense)) / c, 2));
}

// Defense penetration values to calculate for
const DEFENSE_PENETRATION_VALUES = [0, 7, 14, 20, 21, 27, 34, 41];

// Default defense value
const DEFAULT_DEFENSE = 15000;

console.log('\nDefense Penetration Lookup Table Calculator');
console.log('===========================================');
console.log(`Default Defense: ${DEFAULT_DEFENSE.toLocaleString()}\n`);

console.log('Defense Penetration Lookup Table:');
console.log('const DEFENSE_PENETRATION_LOOKUP: Record<number, number> = {');

const lookupValues: Record<number, number> = {};

DEFENSE_PENETRATION_VALUES.forEach((defensePenetration) => {
    // Calculate effective defense after penetration
    const effectiveDefense = DEFAULT_DEFENSE * (1 - defensePenetration / 100);

    // Calculate damage reduction for this effective defense
    const damageReduction = calculateDamageReduction(effectiveDefense);

    // Round to 2 decimal places
    const roundedReduction = Math.round(damageReduction * 100) / 100;

    lookupValues[defensePenetration] = roundedReduction;

    console.log(`    ${defensePenetration}: ${roundedReduction},`);

    // Also show the calculation details
    console.log(`    // Effective Defense: ${effectiveDefense.toLocaleString()}, Damage Reduction: ${roundedReduction}%`);
});

console.log('};\n');

// Show comparison with old values (10k defense)
console.log('\nComparison with 10k defense:');
console.log('Defense Pen | 10k Defense | 15k Defense | Difference');
console.log('------------------------------------------------------');

const OLD_VALUES_10K: Record<number, number> = {
    0: 74.21,
    7: 72.71,
    14: 71.04,
    20: 69.45,
    21: 69.17,
    27: 67.38,
    34: 65.04,
    41: 62.37,
};

DEFENSE_PENETRATION_VALUES.forEach((defensePenetration) => {
    const oldValue = OLD_VALUES_10K[defensePenetration];
    const newValue = lookupValues[defensePenetration];
    const diff = newValue - oldValue;

    console.log(
        `${defensePenetration.toString().padStart(11)} | ` +
        `${oldValue.toFixed(2).padStart(11)} | ` +
        `${newValue.toFixed(2).padStart(11)} | ` +
        `${diff > 0 ? '+' : ''}${diff.toFixed(2)}`
    );
});

console.log('\n');
