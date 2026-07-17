import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import { fetchBuffsFromRocky } from './updateBuffsDataFetcher';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ship names come from the Supabase ship_templates snapshot (docs/ship-data.json),
// generated via `npm run fetch:ship-data`. Read directly via fs — the constants/ships.ts
// SHIPS constant was deleted (deprecated/stale); importing scripts/lib from src would also
// trip the src/scripts ESLint boundary.
const SHIP_DATA_PATH = path.resolve(__dirname, '../../../docs/ship-data.json');

function loadShipNames(): string[] {
    if (!fs.existsSync(SHIP_DATA_PATH)) {
        console.error(
            `ERROR: ${SHIP_DATA_PATH} not found. Run \`npm run fetch:ship-data\` first to generate docs/ship-data.json.`
        );
        process.exit(1);
    }
    const parsed = JSON.parse(fs.readFileSync(SHIP_DATA_PATH, 'utf8')) as Array<{ name: string }>;
    return parsed.map((s) => s.name);
}

// Manual description overrides applied after fetching upstream data.
// Add entries here when the upstream source has incorrect descriptions.
// Keep in sync with manual corrections already present in src/constants/buffs.ts.
const MANUAL_DESCRIPTION_OVERRIDES: Record<string, string> = {
    // upstream says "Damage" but the game scales bombs off Attack
    'Bomb III': '300% Attack',
};

// Implant-only buffs that never appear in ship-buff fetch data and so are never
// produced upstream — re-added here so a regen preserves them. (D-PR9: Font of Power.)
const MANUAL_BUFFS: Array<{
    name: string;
    description: string;
    type: 'buff' | 'debuff' | 'effect';
}> = [
    {
        name: 'Power Infused Nanobots',
        description: "Grants attack equal to 100% of the caster's attack",
        type: 'buff',
    },
    {
        name: 'Block Debuff',
        description: 'Is immune to receiving debuffs',
        type: 'buff',
    },
    {
        name: 'Buff Protection',
        description: "Protects this unit's buffs from being removed",
        type: 'buff',
    },
];

async function updateBuffsData() {
    const buffsMap = new Map<
        string,
        {
            name: string;
            description: string;
            type?: 'buff' | 'debuff' | 'effect';
            imageKey?: string;
        }
    >();
    const errors: string[] = [];

    // Process all ships to collect unique buffs
    const shipNames = loadShipNames();
    for (const name of shipNames) {
        try {
            /* eslint-disable-next-line no-console */
            console.log(`Fetching buffs for ${name}`);
            const buffs = await fetchBuffsFromRocky(name);

            // Add each buff to the map (duplicates will be overwritten with same data)
            buffs.forEach((buff) => {
                buffsMap.set(buff.name, buff);
            });

            // Add a small delay to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error: unknown) {
            if (error instanceof Error) {
                console.error(`Error updating buffs for ${name}:`, error);
                errors.push(`Error with ${name}: ${error.message}`);
            } else {
                console.error(`Error updating buffs for ${name}:`, error);
                errors.push(`Error with ${name}: Unknown error occurred`);
            }
        }
    }

    // Apply manual overrides before writing — prevents regen from clobbering hand-corrections
    for (const [name, description] of Object.entries(MANUAL_DESCRIPTION_OVERRIDES)) {
        const existing = buffsMap.get(name);
        if (existing) {
            buffsMap.set(name, { ...existing, description });
        }
    }

    // Re-add implant-only buffs that the upstream fetch never produces, so a regen
    // preserves them. Only add when absent — never clobber a fetched description.
    for (const b of MANUAL_BUFFS) {
        if (!buffsMap.has(b.name)) buffsMap.set(b.name, b);
    }

    // Convert map to array for easier handling
    const buffsArray = Array.from(buffsMap.values());

    // Generate the new buffs.ts file content
    const fileContent = `// Auto-generated on ${new Date().toISOString()}
export interface Buff {
    name: string;
    description: string;
    type?: 'buff' | 'debuff' | 'effect';
    imageKey?: string;
}

export const BUFFS: Buff[] = ${JSON.stringify(buffsArray, null, 4)};
`;

    // Write the updated data
    const filePath = path.resolve(__dirname, '../../constants/buffs.ts');
    fs.writeFileSync(filePath, fileContent);

    // Write error log if there were any errors
    if (errors.length > 0) {
        const errorLog = `Update Errors (${new Date().toISOString()}):\n${errors.join('\n')}`;
        fs.writeFileSync(path.resolve(__dirname, './update_buffs_errors.log'), errorLog);
    }

    /* eslint-disable-next-line no-console */
    console.log(`Successfully updated ${buffsArray.length} unique buffs`);
}

// Run the update
updateBuffsData().catch(console.error);
