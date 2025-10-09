import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase
        .from('ship_templates')
        .select('id, name, definition_id')
        .limit(10);

    if (error) {
        console.error('Error:', error);
        process.exit(1);
    }

    console.log('Sample ship templates:');
    console.log(JSON.stringify(data, null, 2));

    const { count } = await supabase
        .from('ship_templates')
        .select('*', { count: 'exact', head: true })
        .not('definition_id', 'is', null);

    console.log(`\nShips with definition_id: ${count}`);
}

check();
