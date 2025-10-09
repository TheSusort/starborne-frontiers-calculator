/**
 * Script to populate definition_id field in ship_templates from game export data
 *
 * This needs to be run once with an export file that contains all ships at level 60
 * to establish the mapping between ship names and their DefinitionIds
 *
 * Usage:
 *   npx tsx scripts/populate-definition-ids.ts path/to/export.json
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: Missing Supabase environment variables');
    console.error('Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface ExportedPlayData {
    Units: Array<{
        Id: string;
        DefinitionId: string;
        Name: string;
        Faction: string;
        Rarity: string;
        ShipType: string;
        Level: number;
        Rank: number;
    }>;
}

interface ShipTemplate {
    id: string;
    name: string;
    rarity: string;
    faction: string;
    type: string;
}

/**
 * Extracts unique ship definitions from export data
 * Returns a map of ship name (lowercase) -> DefinitionId
 */
function extractDefinitionIds(data: ExportedPlayData): Map<string, string> {
    const definitionMap = new Map<string, string>();

    for (const unit of data.Units) {
        // Use just the name as the key (lowercase for case-insensitive matching)
        const key = unit.Name.toLowerCase();

        // Store the DefinitionId
        // If we see the same ship multiple times (different levels/ranks), they'll have the same DefinitionId
        if (!definitionMap.has(key)) {
            definitionMap.set(key, unit.DefinitionId);
        }
    }

    return definitionMap;
}

/**
 * Main function
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error('ERROR: Export file path required');
        console.error('\nUsage:');
        console.error('  npx tsx scripts/populate-definition-ids.ts path/to/export.json');
        console.error('\nExample:');
        console.error('  npx tsx scripts/populate-definition-ids.ts ~/Downloads/export.json');
        process.exit(1);
    }

    const exportFilePath = args[0];

    console.log('🚀 Starting definition_id population...\n');
    console.log(`Reading export file: ${exportFilePath}`);

    // Read and parse export file
    let exportData: ExportedPlayData;
    try {
        const fileContent = readFileSync(exportFilePath, 'utf-8');
        exportData = JSON.parse(fileContent);
    } catch (error) {
        console.error('❌ Failed to read export file:', error instanceof Error ? error.message : 'Unknown error');
        process.exit(1);
    }

    console.log(`✅ Found ${exportData.Units.length} units in export\n`);

    // Extract definition IDs
    const definitionMap = extractDefinitionIds(exportData);
    console.log(`✅ Extracted ${definitionMap.size} unique ship definitions\n`);

    // Fetch all ship templates from database
    console.log('📊 Fetching ship templates from Supabase...');
    const { data: templates, error: fetchError } = await supabase
        .from('ship_templates')
        .select('id, name, rarity, faction, type');

    if (fetchError) {
        console.error('❌ Failed to fetch ship templates:', fetchError.message);
        process.exit(1);
    }

    if (!templates || templates.length === 0) {
        console.log('⚠️  No ship templates found in database');
        process.exit(0);
    }

    console.log(`✅ Found ${templates.length} ship templates in database\n`);

    // Match templates to definitions and update
    let matchedCount = 0;
    let unmatchedCount = 0;
    const unmatched: string[] = [];

    for (const template of templates as ShipTemplate[]) {
        // Match by name only (case-insensitive)
        const key = template.name.toLowerCase();
        const definitionId = definitionMap.get(key);

        if (definitionId) {
            console.log(`✓ ${template.name} (${template.rarity}) -> ${definitionId}`);

            // Update the template
            const { error: updateError } = await supabase
                .from('ship_templates')
                .update({ definition_id: definitionId })
                .eq('id', template.id);

            if (updateError) {
                console.error(`  ❌ Failed to update: ${updateError.message}`);
            } else {
                matchedCount++;
            }
        } else {
            console.log(`✗ ${template.name} (${template.rarity}) - NO MATCH`);
            unmatched.push(`${template.name} (${template.rarity})`);
            unmatchedCount++;
        }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary:');
    console.log('='.repeat(60));
    console.log(`Total templates: ${templates.length}`);
    console.log(`✅ Matched and updated: ${matchedCount}`);
    console.log(`❌ Unmatched: ${unmatchedCount}`);

    if (unmatched.length > 0) {
        console.log('\nUnmatched ships:');
        unmatched.forEach(ship => console.log(`  - ${ship}`));
        console.log('\n💡 These ships may not be in your export file.');
        console.log('   You may need an export with more ships to populate all definitions.');
    }

    console.log('='.repeat(60));
}

// Run the script
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
