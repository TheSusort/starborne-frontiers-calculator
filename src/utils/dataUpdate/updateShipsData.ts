import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import { SHIPS } from '../../constants/ships';
import { fetchShipDataFromRocky } from './updateShipDataFetcher';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function updateShipsData(specificShip?: string) {
    const updatedShips: typeof SHIPS = { ...SHIPS };
    const errors: string[] = [];

    // Get the ships to process
    const shipsToProcess = specificShip
        ? Object.entries(SHIPS).filter(
              ([_, ship]) => ship.name.toLowerCase() === specificShip.toLowerCase()
          )
        : Object.entries(SHIPS);

    if (specificShip && shipsToProcess.length === 0) {
        console.error(`Ship "${specificShip}" not found in database`);
        process.exit(1);
    }

    // Process ships sequentially to avoid overwhelming the API
    for (const [key, ship] of shipsToProcess) {
        const typedShip = ship;

        try {
            // eslint-disable-next-line no-console
            console.log(`Fetching data for ${typedShip.name}`);
            const newData = await fetchShipDataFromRocky(typedShip.name);

            if (!newData) {
                console.error(`No data returned for ${typedShip.name}`);
                errors.push(`Failed to fetch: ${typedShip.name}`);
                continue;
            }

            // Update the ship data, only adding new fields
            updatedShips[key as keyof typeof SHIPS] = {
                ...typedShip, // Keep all existing data
                // Only set these if they don't exist in typedShip
            };

            // Add a small delay to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error: unknown) {
            if (error instanceof Error) {
                console.error(`Error updating ${typedShip.name}:`, error);
                errors.push(`Error with ${typedShip.name}: ${error.message}`);
            } else {
                console.error(`Error updating ${typedShip.name}:`, error);
                errors.push(`Error with ${typedShip.name}: Unknown error occurred`);
            }
        }
    }

    // Generate the new ships.ts file content
    const fileContent = `// Auto-generated on ${new Date().toISOString()}
export const SHIPS = ${JSON.stringify(updatedShips, null, 4)};
`;

    // Write the updated data
    const filePath = path.resolve(__dirname, '../../constants/ships.ts');
    fs.writeFileSync(filePath, fileContent);

    // Write error log if there were any errors
    if (errors.length > 0) {
        const errorLog = `Update Errors (${new Date().toISOString()}):\n${errors.join('\n')}`;
        fs.writeFileSync(path.resolve(__dirname, './update_errors.log'), errorLog);
    }
}

// Get ship name from command line arguments
const shipName = process.argv[2];

// Run the update
updateShipsData(shipName).catch(console.error);
