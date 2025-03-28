import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import { SHIPS } from '../../constants/ships';
import { fetchBuffsFromRocky } from './updateBuffsDataFetcher';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function updateBuffsData() {
    const buffsMap = new Map<string, { name: string; description: string }>();
    const errors: string[] = [];

    // Process all ships to collect unique buffs
    for (const [_, ship] of Object.entries(SHIPS)) {
        try {
            /* eslint-disable-next-line no-console */
            console.log(`Fetching buffs for ${ship.name}`);
            const buffs = await fetchBuffsFromRocky(ship.name);

            // Add each buff to the map (duplicates will be overwritten with same data)
            buffs.forEach((buff) => {
                buffsMap.set(buff.name, buff);
            });

            // Add a small delay to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error: unknown) {
            if (error instanceof Error) {
                console.error(`Error updating buffs for ${ship.name}:`, error);
                errors.push(`Error with ${ship.name}: ${error.message}`);
            } else {
                console.error(`Error updating buffs for ${ship.name}:`, error);
                errors.push(`Error with ${ship.name}: Unknown error occurred`);
            }
        }
    }

    // Convert map to array for easier handling
    const buffsArray = Array.from(buffsMap.values());

    // Generate the new buffs.ts file content
    const fileContent = `// Auto-generated on ${new Date().toISOString()}
export interface Buff {
    name: string;
    description: string;
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
