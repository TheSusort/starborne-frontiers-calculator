import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { importPlayerData } from '../src/utils/importPlayerData';
import { syncMigratedDataToSupabase } from '../src/utils/migratePlayerData';

const parseArgs = (): { file: string; email: string } => {
    const args = process.argv.slice(2);
    let file = '';
    let email = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--file' && args[i + 1]) {
            file = args[i + 1];
            i++;
        } else if (args[i] === '--email' && args[i + 1]) {
            email = args[i + 1];
            i++;
        }
    }

    if (!file || !email) {
        console.error('Usage: npm run admin:import -- --file <path> --email <user@example.com>');
        process.exit(1);
    }

    return { file, email };
};

const main = async () => {
    const { file, email } = parseArgs();

    // Validate env vars
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
        process.exit(1);
    }

    // Create service-role client (bypasses RLS)
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Look up user by email
    console.log(`Looking up user: ${email}`);
    const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, email')
        .eq('email', email)
        .single();

    if (userError || !user) {
        console.error(`User not found: ${email}`);
        process.exit(1);
    }

    console.log(`Found user: ${user.email} (${user.id})`);

    // Read and parse JSON file
    let rawData;
    try {
        const fileContent = readFileSync(file, 'utf-8');
        rawData = JSON.parse(fileContent);
    } catch (err) {
        console.error(`Failed to read/parse file: ${file}`);
        console.error(err);
        process.exit(1);
    }

    // Transform data using existing import pipeline
    console.log('Parsing game data...');
    const result = await importPlayerData(rawData);

    if (!result.success || !result.data) {
        console.error('Import failed:', result.error);
        process.exit(1);
    }

    const { ships, inventory, engineeringStats } = result.data;
    console.log(`Parsed: ${ships.length} ships, ${inventory.length} gear/implants, ${engineeringStats.stats.length} engineering entries`);

    // Sync to Supabase for target user
    console.log(`Syncing data to user ${user.email}...`);
    const syncResult = await syncMigratedDataToSupabase(
        user.id,
        {
            ships,
            inventory,
            encounters: [],
            loadouts: [],
            teamLoadouts: [],
            engineeringStats,
        },
        supabase
    );

    if (syncResult.success) {
        console.log('Import completed successfully!');
    } else {
        console.error('Sync failed:', syncResult.error);
        process.exit(1);
    }
};

main();
