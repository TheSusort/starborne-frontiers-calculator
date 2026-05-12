import { BUFFS } from '../src/constants/buffs';
import { parseBuffEffects, isStackable } from '../src/utils/calculators/buffParser';
import type { ParsedBuffEffects } from '../src/types/calculator';

function formatEffects(effects: ParsedBuffEffects): string {
    return Object.entries(effects)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
}

function run() {
    const withEffects: string[] = [];
    const noEffects: string[] = [];
    let stackableCount = 0;

    for (const buff of BUFFS) {
        const effects = parseBuffEffects(buff.name, buff.description);
        const { stackable, maxStacks } = isStackable(buff.description);
        const hasEffects = Object.keys(effects).length > 0;

        if (stackable) stackableCount++;

        if (hasEffects) {
            const stackSuffix = stackable ? ` (stackable${maxStacks ? `, max ${maxStacks}` : ''})` : '';
            withEffects.push(`${buff.name}${stackSuffix}: ${formatEffects(effects)}`);
        } else {
            noEffects.push(`${buff.name}: ${buff.description}`);
        }
    }

    console.log('=== Buffs with DPS effects ===');
    withEffects.forEach((line) => console.log(line));
    console.log();
    console.log('=== Buffs with no DPS effects ===');
    noEffects.forEach((line) => console.log(line));
    console.log();
    console.log('=== Summary ===');
    console.log(`Total buffs: ${BUFFS.length}`);
    console.log(`With DPS effects: ${withEffects.length}`);
    console.log(`No DPS effects: ${noEffects.length}`);
    console.log(`Stackable buffs: ${stackableCount}`);
}

run();
