/**
 * Script to fetch skill texts from frontiers.cubedweb.net API and update ship_templates in Supabase
 *
 * Usage:
 *   DRY_RUN=true PHPSESSID=your_cookie npx tsx scripts/update-ship-skills.ts
 *   PHPSESSID=your_cookie npx tsx scripts/update-ship-skills.ts
 */

import { createClient } from '@supabase/supabase-js';

const API_BASE = 'https://frontiers.cubedweb.net';
const DELAY_MS = 150; // 150ms delay between API calls
const DRY_RUN = process.env.DRY_RUN === 'true';

// Initialize Supabase client with service role key (bypasses RLS)
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: Missing Supabase environment variables');
    console.error('Please set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface SkillData {
    id: string;
    typeId: number; // 1 = active, 2 = charged, 3 = passive
    icon: string;
    name: string;
    description: string;
    basePattern: string;
    overlayPattern: string;
    charge: number;
    rank: number;
}

interface ApiResponse {
    status: string;
    data: {
        message: string; // JSON string of SkillData[]
    };
}

interface ShipTemplate {
    id: string;
    name: string;
    definition_id: string | null;
}

/**
 * Fetches skill texts for a ship from the API
 */
async function fetchSkillTexts(definitionId: string, phpsessid: string): Promise<SkillData[]> {
    try {
        const response = await fetch(`${API_BASE}/rest/baseunit/skills`, {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': `PHPSESSID=${phpsessid}`,
            },
            body: `unit_id=${definitionId}`,
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as ApiResponse;

        if (data.status !== 'success') {
            throw new Error(`API returned non-success status: ${data.status}`);
        }

        // The message field contains a JSON string
        const skills = JSON.parse(data.data.message) as SkillData[];
        return skills;
    } catch (error) {
        throw new Error(
            `Failed to fetch skills for ${definitionId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

/**
 * Extracts skill texts for each skill type
 *
 * For all skills:
 * - Active: Get highest rank
 * - Charge: Get highest rank
 * - Passive: There is only ONE passive slot per ship
 *   - firstPassiveSkillText = rank 1 description
 *   - secondPassiveSkillText = rank 2 description
 *   - thirdPassiveSkillText = rank 3 description
 */
function extractSkillTexts(skills: SkillData[]): {
    activeSkillText: string | null;
    chargeSkillText: string | null;
    chargeSkillCharge: number | null;
    firstPassiveSkillText: string | null;
    secondPassiveSkillText: string | null;
    thirdPassiveSkillText: string | null;
} {
    // Get highest rank active and charged skills
    const activeSkills = skills.filter(s => s.typeId === 1).sort((a, b) => b.rank - a.rank);
    const chargedSkills = skills.filter(s => s.typeId === 2).sort((a, b) => b.rank - a.rank);

    // For passives: all ships have one passive slot with increasing ranks (e.g. 1, 2, 4)
    const passiveSkills = skills.filter(s => s.typeId === 3).sort((a, b) => a.rank - b.rank);

    return {
        activeSkillText: activeSkills[0]?.description || null,
        chargeSkillText: chargedSkills[0]?.description || null,
        chargeSkillCharge: chargedSkills[0]?.charge ?? null,
        firstPassiveSkillText: passiveSkills[0]?.description || null,
        secondPassiveSkillText: passiveSkills[1]?.description || null,
        thirdPassiveSkillText: passiveSkills[2]?.description || null,
    };
}

/**
 * Updates a ship template in Supabase with skill texts
 * Only updates fields that have non-empty values to avoid overwriting existing data with nulls
 */
async function updateShipTemplate(
    shipId: string,
    skillTexts: ReturnType<typeof extractSkillTexts>
): Promise<void> {
    // Build update object with only non-null/non-empty values
    const updates: Record<string, string | number> = {};

    if (skillTexts.activeSkillText) {
        updates.active_skill_text = skillTexts.activeSkillText;
    }
    if (skillTexts.chargeSkillText) {
        updates.charge_skill_text = skillTexts.chargeSkillText;
    }
    if (skillTexts.firstPassiveSkillText) {
        updates.first_passive_skill_text = skillTexts.firstPassiveSkillText;
    }
    if (skillTexts.secondPassiveSkillText) {
        updates.second_passive_skill_text = skillTexts.secondPassiveSkillText;
    }
    if (skillTexts.thirdPassiveSkillText) {
        updates.third_passive_skill_text = skillTexts.thirdPassiveSkillText;
    }
    if (skillTexts.chargeSkillCharge !== null) {
        updates.charge_skill_charge = skillTexts.chargeSkillCharge;
    }

    // Only update if we have at least one field to update
    if (Object.keys(updates).length === 0) {
        return;
    }

    const { error } = await supabase
        .from('ship_templates')
        .update(updates)
        .eq('id', shipId);

    if (error) {
        throw new Error(`Failed to update ship template: ${error.message}`);
    }
}

/**
 * Main function
 */
async function main() {
    const phpsessid = process.env.PHPSESSID;

    if (!phpsessid) {
        console.error('ERROR: PHPSESSID environment variable is required');
        console.error('\nUsage:');
        console.error('  PHPSESSID=your_cookie npx tsx scripts/update-ship-skills.ts');
        console.error('  DRY_RUN=true PHPSESSID=your_cookie npx tsx scripts/update-ship-skills.ts');
        process.exit(1);
    }

    console.log('🚀 Starting ship skill text update...\n');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no database changes)' : 'LIVE (will update database)'}`);
    console.log(`Delay between API calls: ${DELAY_MS}ms\n`);

    // Fetch all ship templates with definition_id
    console.log('📊 Fetching ship templates from Supabase...');
    const { data: ships, error: fetchError } = await supabase
        .from('ship_templates')
        .select('id, name, definition_id')
        .not('definition_id', 'is', null);

    if (fetchError) {
        console.error('❌ Failed to fetch ship templates:', fetchError.message);
        process.exit(1);
    }

    if (!ships || ships.length === 0) {
        console.log('⚠️  No ship templates with definition_id found');
        console.log('Please ensure the definition_id field is populated first');
        process.exit(0);
    }

    console.log(`✅ Found ${ships.length} ships with definition_id\n`);

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    const missingSkills = {
        active: [] as string[],
        charge: [] as string[],
        passive1: [] as string[],
        passive2: [] as string[],
        passive3: [] as string[],
    };

    // Process each ship
    for (let i = 0; i < ships.length; i++) {
        const ship = ships[i] as ShipTemplate;
        const progress = `[${i + 1}/${ships.length}]`;

        console.log(`${progress} Processing: ${ship.name} (${ship.definition_id})`);

        try {
            // Fetch skills from API
            const skills = await fetchSkillTexts(ship.definition_id!, phpsessid);

            if (skills.length === 0) {
                console.log(`  ⚠️  No skills found - skipping`);
                skipCount++;
                continue;
            }

            // Extract max rank skill texts
            const skillTexts = extractSkillTexts(skills);

            console.log(`  📝 Found skills:`);
            console.log(`     Active: ${skillTexts.activeSkillText ? '✓' : '✗'}`);
            console.log(`     Charge: ${skillTexts.chargeSkillText ? '✓' : '✗'}${skillTexts.chargeSkillCharge !== null ? ` (charge: ${skillTexts.chargeSkillCharge})` : ''}`);
            console.log(`     Passive 1: ${skillTexts.firstPassiveSkillText ? '✓' : '✗'}`);
            console.log(`     Passive 2: ${skillTexts.secondPassiveSkillText ? '✓' : '✗'}`);
            console.log(`     Passive 3: ${skillTexts.thirdPassiveSkillText ? '✓' : '✗'}`);

            // Track missing skills
            if (!skillTexts.activeSkillText) missingSkills.active.push(ship.name);
            if (!skillTexts.chargeSkillText) missingSkills.charge.push(ship.name);
            if (!skillTexts.firstPassiveSkillText) missingSkills.passive1.push(ship.name);
            if (!skillTexts.secondPassiveSkillText) missingSkills.passive2.push(ship.name);
            if (!skillTexts.thirdPassiveSkillText) missingSkills.passive3.push(ship.name);

            // In dry run mode, show the actual skill texts
            if (DRY_RUN) {
                console.log(`  📄 Skill Texts:`);
                if (skillTexts.activeSkillText) {
                    console.log(`     Active: ${skillTexts.activeSkillText}`);
                }
                if (skillTexts.chargeSkillText) {
                    console.log(`     Charge: ${skillTexts.chargeSkillText} (charge: ${skillTexts.chargeSkillCharge})`);
                }
                if (skillTexts.firstPassiveSkillText) {
                    console.log(`     Passive 1: ${skillTexts.firstPassiveSkillText}`);
                }
                if (skillTexts.secondPassiveSkillText) {
                    console.log(`     Passive 2: ${skillTexts.secondPassiveSkillText}`);
                }
                if (skillTexts.thirdPassiveSkillText) {
                    console.log(`     Passive 3: ${skillTexts.thirdPassiveSkillText}`);
                }
                console.log(`  ℹ️  DRY RUN - would update in database`);
            } else {
                // Update database
                await updateShipTemplate(ship.id, skillTexts);
                console.log(`  ✅ Updated in database`);
            }

            successCount++;

            // Add delay between API calls
            if (i < ships.length - 1) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        } catch (error) {
            console.log(`  ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            errorCount++;

            // Continue to next ship on error
            if (i < ships.length - 1) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }

        console.log(''); // Empty line for readability
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary:');
    console.log('='.repeat(60));
    console.log(`Total ships: ${ships.length}`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`⚠️  Skipped: ${skipCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log('='.repeat(60));

    // Show missing skills summary
    const totalMissing = missingSkills.active.length + missingSkills.charge.length +
                         missingSkills.passive1.length + missingSkills.passive2.length +
                         missingSkills.passive3.length;

    if (totalMissing > 0) {
        console.log('\n' + '='.repeat(60));
        console.log('⚠️  Missing Skills Summary:');
        console.log('='.repeat(60));

        if (missingSkills.active.length > 0) {
            console.log(`\nMissing Active Skills (${missingSkills.active.length} ships):`);
            missingSkills.active.forEach(name => console.log(`  - ${name}`));
        }

        if (missingSkills.charge.length > 0) {
            console.log(`\nMissing Charge Skills (${missingSkills.charge.length} ships):`);
            missingSkills.charge.forEach(name => console.log(`  - ${name}`));
        }

        if (missingSkills.passive1.length > 0) {
            console.log(`\nMissing First Passive (${missingSkills.passive1.length} ships):`);
            missingSkills.passive1.forEach(name => console.log(`  - ${name}`));
        }

        if (missingSkills.passive2.length > 0) {
            console.log(`\nMissing Second Passive (${missingSkills.passive2.length} ships):`);
            missingSkills.passive2.forEach(name => console.log(`  - ${name}`));
        }

        if (missingSkills.passive3.length > 0) {
            console.log(`\nMissing Third Passive (${missingSkills.passive3.length} ships):`);
            missingSkills.passive3.forEach(name => console.log(`  - ${name}`));
        }

        console.log('='.repeat(60));
    }

    if (DRY_RUN) {
        console.log('\n💡 This was a DRY RUN. No changes were made to the database.');
        console.log('   Run without DRY_RUN=true to apply changes.');
    }
}

// Run the script
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
